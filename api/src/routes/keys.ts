import { Hono } from 'hono';
import { requireAuth, requireReAuth } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from '../lib/encryption.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

const router = new Hono();

router.use('*', requireAuth);

/**
 * GET /keys/export — Export the current user's zkLogin key material.
 *
 * Returns the encrypted ephemeral key and zkLogin proof, decrypted for
 * the user to back up. Requires recent authentication (requireReAuth,
 * last auth within 15 min) to prevent token theft from exfiltrating keys.
 *
 * Rate-limited to 3 exports per 7 days per user to limit brute-force
 * exposure of the decrypted key material.
 */
router.get('/export',
  rateLimit({ windowMs: 7 * 24 * 60 * 60 * 1000, max: 3, keyFn: (c) => `key-export:${c.get('userId')}` }),
  requireReAuth,
  async (c) => {
    try {
      const userId = c.get('userId');
      const db = getDb();

      const [user] = await db.select({
        ephemeralKeyEncrypted: users.ephemeralKeyEncrypted,
        ephemeralKeyExpiry: users.ephemeralKeyExpiry,
        zkloginProofEncrypted: users.zkloginProofEncrypted,
        zkloginAddress: users.zkloginAddress,
        zkloginJwtRandomness: users.zkloginJwtRandomness,
        zkloginMaxEpoch: users.zkloginMaxEpoch,
        oauthProvider: users.oauthProvider,
        email: users.email,
      }).from(users).where(eq(users.id, userId)).limit(1);

      if (!user) {
        return c.json({ error: { message: 'User not found', code: ErrorCodes.NOT_FOUND } }, 404);
      }

      if (!user.zkloginAddress) {
        return c.json({ error: { message: 'No zkLogin keys available for this account. Complete OAuth login first.', code: ErrorCodes.NOT_FOUND } }, 404);
      }

      // Decrypt stored encrypted fields
      let ephemeralKeyPair: string | null = null;
      let zkProof: string | null = null;

      if (user.ephemeralKeyEncrypted) {
        try {
          ephemeralKeyPair = decrypt(user.ephemeralKeyEncrypted);
        } catch {
          // Decryption failure — key material may have been rotated
          ephemeralKeyPair = null;
        }
      }

      if (user.zkloginProofEncrypted) {
        try {
          zkProof = decrypt(user.zkloginProofEncrypted);
        } catch {
          zkProof = null;
        }
      }

      // Update lastKeyExportAt for audit tracking
      await db.update(users).set({ lastKeyExportAt: new Date() }).where(eq(users.id, userId));

      return c.json({
        keyExport: {
          zkloginAddress: user.zkloginAddress,
          ephemeralKeyPair,
          zkProof,
          jwtRandomness: user.zkloginJwtRandomness,
          maxEpoch: user.zkloginMaxEpoch,
          oauthProvider: user.oauthProvider,
          expiresAt: user.ephemeralKeyExpiry?.toISOString() || null,
        },
        warning: 'These keys grant access to your zkLogin wallet. Store them securely and never share them.',
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw error;
    }
  },
);

export { router as keyRoutes };
