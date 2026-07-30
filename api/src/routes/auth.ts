import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { register, login } from '../services/auth-service.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit, logAuditSystem } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { users, orgMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { AppError } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { computeSalt, deriveZkLoginAddress, getIssuer, generateEphemeralKeypair, generateJwtRandomness, generateZkProof, getEphemeralPublicKey } from '../services/zklogin-service.js';
import { encrypt } from '../lib/encryption.js';
import { config } from '../config.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

router.post('/register',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
  zValidator('json', registerSchema),
  async (c) => {
    try {
      const input = c.req.valid('json');
      const result = await register(input);
      await logAudit(c, 'auth.register', 'user', result.user.id, { email: input.email });
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof AppError) {
        return c.json({ error: { message: error.message, code: error.code || 'REGISTER_ERROR' } }, error.statusCode as ContentfulStatusCode);
      }
      throw error;
    }
  },
);

router.post('/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  zValidator('json', loginSchema),
  async (c) => {
    try {
      const input = c.req.valid('json');
      const result = await login(input);
      const db = getDb();
      const [membership] = await db.select({ orgId: orgMembers.orgId }).from(orgMembers).where(eq(orgMembers.userId, result.user.id)).limit(1);
      if (membership) {
        await logAuditSystem(membership.orgId, 'auth.login', 'user', result.user.id, { method: 'password' });
      }
      return c.json(result);
    } catch (error) {
      if (error instanceof AppError) {
        return c.json({ error: { message: error.message, code: error.code || 'LOGIN_ERROR' } }, error.statusCode as ContentfulStatusCode);
      }
      throw error;
    }
  },
);

router.post('/google',
  rateLimit({ windowMs: 60 * 1000, max: 10 }),
  zValidator('json', googleAuthSchema),
  async (c) => {
    try {
      const { idToken } = c.req.valid('json');

      if (!GOOGLE_CLIENT_ID) {
        return c.json({ error: { message: 'Google OAuth not configured', code: 'OAUTH_NOT_CONFIGURED' } }, 500);
      }

      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        return c.json({ error: { message: 'Invalid Google token payload', code: 'INVALID_TOKEN' } }, 400);
      }

      const subject = payload.sub;
      const email = payload.email;
      const name = payload.name;

      const db = getDb();

      let [user] = await db.select().from(users).where(
        and(eq(users.oauthProvider, 'google'), eq(users.oauthSubject, subject)),
      ).limit(1);

      if (!user) {
        const salt = computeSalt(subject);
        const aud = GOOGLE_CLIENT_ID;
        const iss = getIssuer('google');
        const zkloginAddress = deriveZkLoginAddress(iss, subject, aud, salt);

        const { keypair, secretKey } = generateEphemeralKeypair();
        const encryptedKeypair = encrypt(secretKey);

        const jwtRandomness = generateJwtRandomness();
        const ephemeralPublicKey = getEphemeralPublicKey(keypair);

        let zkProof: any = null;
        let maxEpoch = 0;
        try {
          const proofResult = await generateZkProof(
            idToken,
            ephemeralPublicKey,
            jwtRandomness,
            salt,
          );
          zkProof = proofResult.proof;
          maxEpoch = proofResult.maxEpoch;
        } catch (proofErr) {
          console.error('[auth] ZK proof generation failed (non-blocking):', proofErr);
        }

        const [newUser] = await db.insert(users).values({
          email,
          passwordHash: '',
          name: name || email,
          oauthProvider: 'google',
          oauthSubject: subject,
          oauthEmail: email,
          zkloginAddress,
          ephemeralKeyEncrypted: encryptedKeypair,
          ephemeralKeyExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          zkloginProofEncrypted: zkProof ? encrypt(JSON.stringify(zkProof)) : null,
          zkloginJwtRandomness: jwtRandomness,
          zkloginMaxEpoch: maxEpoch || null,
          lastKeyExportAt: null,
        }).returning();

        user = newUser;
      }

      const token = jwt.sign(
        {
          sub: user.id,
          auth_time: Math.floor(Date.now() / 1000),
          provider: 'google',
          userId: user.id,
        },
        config.jwtSecret,
        { expiresIn: '7d', issuer: 'walwatch', audience: 'walwatch-api', algorithm: 'HS256' },
      );

      await logAudit(c, 'auth.oauth_login', 'user', user.id, { provider: 'google', email });

      return c.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          zkloginAddress: user.zkloginAddress,
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      return c.json({ error: { message: 'Google authentication failed', code: 'OAUTH_ERROR' } }, 401);
    }
  },
);

router.get('/me', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const db = getDb();
    const [user] = await db.select({ id: users.id, email: users.email, name: users.name, zkloginAddress: users.zkloginAddress, oauthProvider: users.oauthProvider })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.json({ error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
    return c.json({ user });
  } catch (error) {
    throw error;
  }
});

router.post('/logout', requireAuth, async (c) => {
  return c.json({ message: 'Logged out' });
});

export { router as authRoutes };
