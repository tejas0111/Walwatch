import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { OAuth2Client } from 'google-auth-library';
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { register, login } from '../services/auth-service.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit, logAuditSystem } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { users, orgMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { AppError } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { computeSalt, deriveZkLoginAddress, getIssuer, generateEphemeralKeypair, generateJwtRandomness, generateZkProof, getEphemeralPublicKey, computeNonce, generateNonceRandomness } from '../services/zklogin-service.js';
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

const suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: 'testnet' });

export async function getCurrentEpoch(): Promise<number> {
  const state = await suiClient.call('suix_getLatestSuiSystemState', []);
  return Number((state as any).epoch || 0);
}

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
  nonce: z.string().optional(),
  ephemeralPublicKey: z.string().optional(),
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

const zkloginPrepareSchema = z.object({
  ephemeralPublicKey: z.string().min(1),
  jwtRandomness: z.string().min(1),
});

router.post('/zklogin/prepare',
  rateLimit({ windowMs: 60 * 1000, max: 10 }),
  zValidator('json', zkloginPrepareSchema),
  async (c) => {
    try {
      const { ephemeralPublicKey: clientEphemeralPublicKeyHex, jwtRandomness } = c.req.valid('json');

      const currentEpoch = await getCurrentEpoch();
      const maxEpoch = currentEpoch + 2;

      const ephemeralPublicKeyBytes = Uint8Array.from(Buffer.from(clientEphemeralPublicKeyHex, 'hex'));
      const publicKey = new Ed25519PublicKey(ephemeralPublicKeyBytes);

      const nonce = computeNonce(publicKey, maxEpoch, jwtRandomness);

      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      await redis.hmset(`zklogin:session:${nonce}`, {
        ephemeralPublicKey: clientEphemeralPublicKeyHex,
        jwtRandomness,
        maxEpoch: maxEpoch.toString(),
        iat: Date.now().toString(),
      });
      await redis.expire(`zklogin:session:${nonce}`, 300);
      await redis.quit();

      return c.json({
        nonce,
        maxEpoch,
      });
    } catch (error) {
      throw error;
    }
  },
);

router.post('/google',
  rateLimit({ windowMs: 60 * 1000, max: 10 }),
  zValidator('json', googleAuthSchema),
  async (c) => {
    try {
      const { idToken, nonce: clientNonce, ephemeralPublicKey: clientEphemeralPublicKeyHex } = c.req.valid('json');

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

      let nonceFlowData: { ephemeralPublicKey: Uint8Array; jwtRandomness: string; maxEpoch: number } | null = null;

      if (clientNonce) {
        if (!clientEphemeralPublicKeyHex) {
          return c.json({ error: { message: 'ephemeralPublicKey required with nonce', code: 'MISSING_EPHEMERAL_KEY' } }, 400);
        }

        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        const session = await redis.hgetall(`zklogin:session:${clientNonce}`);

        if (!session || !session.ephemeralPublicKey || !session.jwtRandomness || !session.maxEpoch) {
          return c.json({ error: { message: 'Invalid or expired nonce', code: 'INVALID_NONCE' } }, 400);
        }

        const iat = parseInt(session.iat || '0');
        if (Date.now() - iat > 300000) {
          await redis.del(`zklogin:session:${clientNonce}`);
          return c.json({ error: { message: 'Nonce expired', code: 'NONCE_EXPIRED' } }, 400);
        }

        const storedPublicKeyBytes = Uint8Array.from(Buffer.from(session.ephemeralPublicKey, 'hex'));
        const storedPublicKey = new Ed25519PublicKey(storedPublicKeyBytes);
        const computedNonce = computeNonce(storedPublicKey, parseInt(session.maxEpoch), session.jwtRandomness);
        if (computedNonce !== clientNonce) {
          return c.json({ error: { message: 'Nonce mismatch', code: 'NONCE_MISMATCH' } }, 400);
        }

        if (payload.nonce !== clientNonce) {
          return c.json({ error: { message: 'Google token nonce mismatch', code: 'GOOGLE_NONCE_MISMATCH' } }, 400);
        }

        await redis.del(`zklogin:session:${clientNonce}`);
        await redis.quit();

        nonceFlowData = { ephemeralPublicKey: storedPublicKeyBytes, jwtRandomness: session.jwtRandomness, maxEpoch: parseInt(session.maxEpoch) };
      }

      const db = getDb();

      let [user] = await db.select().from(users).where(
        and(eq(users.oauthProvider, 'google'), eq(users.oauthSubject, subject)),
      ).limit(1);

      if (!user) {
        // New user creation requires the nonce-binding flow — without a nonce
        // the zkLogin proof cannot be valid (no JWT nonce claim to verify
        // against the ephemeral key).
        if (!nonceFlowData) {
          return c.json({ error: { message: 'New user registration requires nonce/zklogin/prepare flow', code: 'NONCE_REQUIRED' } }, 400);
        }

        const salt = computeSalt(subject);
        const aud = GOOGLE_CLIENT_ID;
        const iss = getIssuer('google');
        const zkloginAddress = deriveZkLoginAddress(iss, subject, aud, salt);

        const { ephemeralPublicKey, jwtRandomness, maxEpoch: userMaxEpoch } = nonceFlowData;

        let zkProof: any = null;
        try {
          const proofResult = await generateZkProof(
            idToken,
            ephemeralPublicKey,
            jwtRandomness,
            salt,
            userMaxEpoch,
          );
          zkProof = proofResult.proof;
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
          ephemeralKeyEncrypted: null,
          ephemeralKeyExpiry: null,
          zkloginProofEncrypted: zkProof ? encrypt(JSON.stringify(zkProof)) : null,
          zkloginJwtRandomness: jwtRandomness,
          zkloginMaxEpoch: userMaxEpoch || null,
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
        { expiresIn: '7d', issuer: 'walwatch', audience: 'walwatch-api', algorithm: 'HS256', ...(config.jwtKeyId ? { keyid: config.jwtKeyId } : {}) },
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

/**
 * NOTE: GitHub OAuth (plain OAuth 2.0) does not support OIDC nonce claims.
 * zkLogin requires a JWT id_token with a nonce claim bound to the ephemeral
 * keypair — GitHub's access_token flow cannot provide this. Therefore GitHub
 * is implemented as a standard OAuth login only, without zkLogin key derivation.
 * If MystenLabs adds GitHub as a supported zkLogin issuer in the future,
 * this flow will need to be updated to use the nonce-binding pattern from
 * POST /auth/zklogin/prepare + POST /auth/google.
 */

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/login';

// In-memory OAuth state store (short-lived, TTL 5 min).
const oauthStateStore = new Map<string, number>();
const OAUTH_STATE_TTL = 5 * 60 * 1000;

// Periodically purge expired states.
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of oauthStateStore) {
    if (now > expiresAt) oauthStateStore.delete(key);
  }
}, 60_000).unref();

const githubAuthSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

router.get('/github/url', (c) => {
  if (!GITHUB_CLIENT_ID) {
    return c.json({ error: { message: 'GitHub OAuth not configured', code: 'OAUTH_NOT_CONFIGURED' } }, 500);
  }
  const state = crypto.randomUUID();
  oauthStateStore.set(state, Date.now() + OAUTH_STATE_TTL);
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&state=${state}&scope=read:user+user:email`;
  return c.json({ url, state });
});

router.post('/github',
  rateLimit({ windowMs: 60 * 1000, max: 10 }),
  zValidator('json', githubAuthSchema),
  async (c) => {
    try {
      const { code, state } = c.req.valid('json');

      if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        return c.json({ error: { message: 'GitHub OAuth not configured', code: 'OAUTH_NOT_CONFIGURED' } }, 500);
      }

      // Validate OAuth state to prevent CSRF (RFC 6749 §10.12)
      const storedExpiry = oauthStateStore.get(state);
      oauthStateStore.delete(state); // single-use
      if (!storedExpiry || Date.now() > storedExpiry) {
        return c.json({ error: { message: 'Invalid or expired OAuth state', code: 'OAUTH_STATE_ERROR' } }, 401);
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: GITHUB_REDIRECT_URI,
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; error_description?: string };
      if (!tokenData.access_token) {
        return c.json({ error: { message: tokenData.error_description || 'Failed to exchange GitHub code', code: 'GITHUB_TOKEN_ERROR' } }, 400);
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
      });
      const githubUser = await userRes.json() as { id: number; login: string; email?: string; name?: string };
      if (!githubUser || !githubUser.id) {
        return c.json({ error: { message: 'Failed to fetch GitHub user', code: 'GITHUB_USER_ERROR' } }, 400);
      }

      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
      });
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primaryEmail = githubUser.email || emails.find((e) => e.primary)?.email || `${githubUser.login}@github.com`;

      const subject = String(githubUser.id);
      const email = primaryEmail;
      const name = githubUser.name || githubUser.login;

      const db = getDb();

      let [user] = await db.select().from(users).where(
        and(eq(users.oauthProvider, 'github'), eq(users.oauthSubject, subject)),
      ).limit(1);

      if (!user) {
        const [newUser] = await db.insert(users).values({
          email,
          passwordHash: '',
          name: name || email,
          oauthProvider: 'github',
          oauthSubject: subject,
          oauthEmail: email,
          zkloginAddress: null,
          ephemeralKeyEncrypted: null,
          ephemeralKeyExpiry: null,
          zkloginProofEncrypted: null,
          zkloginJwtRandomness: null,
          zkloginMaxEpoch: null,
          lastKeyExportAt: null,
        }).returning();

        user = newUser;
      }

      const token = jwt.sign(
        {
          sub: user.id,
          auth_time: Math.floor(Date.now() / 1000),
          provider: 'github',
          userId: user.id,
        },
        config.jwtSecret,
        { expiresIn: '7d', issuer: 'walwatch', audience: 'walwatch-api', algorithm: 'HS256', ...(config.jwtKeyId ? { keyid: config.jwtKeyId } : {}) },
      );

      await logAudit(c, 'auth.oauth_login', 'user', user.id, { provider: 'github', email });

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
      return c.json({ error: { message: 'GitHub authentication failed', code: 'OAUTH_ERROR' } }, 401);
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
