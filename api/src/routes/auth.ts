import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { register, login } from '../services/auth-service.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit, logAuditSystem } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { users, orgMembers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AppError } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

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

router.get('/me', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const db = getDb();
    const [user] = await db.select({ id: users.id, email: users.email, name: users.name })
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
