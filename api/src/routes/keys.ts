import { Hono } from 'hono';
import type { Context } from 'hono';
import pino from 'pino';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from '../lib/encryption.js';
import { ErrorCodes } from '../lib/errors.js';

const router = new Hono();
const log = pino({ name: 'keys-routes' });

router.use('*', requireAuth);

type Variables = {
  userId: string;
};

function getSessionAgeMs(c: Context): number {
  const authTime = c.get('authTime') as number | undefined;
  if (!authTime) return Infinity;
  return Date.now() - authTime * 1000;
}

router.get('/export', async (c: Context<{ Variables: Variables }>) => {
  try {
    const userId = c.get('userId');

    const sessionAgeMs = getSessionAgeMs(c);
    if (sessionAgeMs > 15 * 60 * 1000) {
      return c.json({ error: { message: 'Re-authentication required. Please login again.', code: 'REAUTH_REQUIRED' } }, 401);
    }

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return c.json({ error: { message: 'User not found', code: ErrorCodes.NOT_FOUND } }, 404);
    }

    if (!user.ephemeralKeyEncrypted) {
      return c.json({ error: { message: 'No zkLogin keys available. Complete OAuth login first.', code: 'NO_KEYS' } }, 404);
    }

    if (user.lastKeyExportAt) {
      const daysSinceLastExport = (Date.now() - new Date(user.lastKeyExportAt).getTime()) / 86400000;
      if (daysSinceLastExport < 7) {
        const daysRemaining = Math.ceil(7 - daysSinceLastExport);
        return c.json({
          error: { message: `Key export rate-limited. Try again in ${daysRemaining} days.`, code: ErrorCodes.RATE_LIMITED },
        }, 429);
      }
    }

    const ephemeralKey = decrypt(user.ephemeralKeyEncrypted);

    await db.update(users)
      .set({ lastKeyExportAt: new Date() })
      .where(eq(users.id, userId));

    await logAudit(c, 'keys.exported', 'user', userId, {});

    return c.json({
      key: ephemeralKey,
      address: user.zkloginAddress,
      expiresAt: user.ephemeralKeyExpiry,
      warning: 'This key grants full signing authority. Keep it secure and do not share it.',
    });
  } catch (error) {
    log.error({ error }, 'Key export failed');
    return c.json({ error: { message: 'Key export failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

export { router as keyRoutes };
