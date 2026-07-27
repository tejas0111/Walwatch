import { Context, Next } from 'hono';

export async function requireAdmin(c: Context, next: Next) {
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return c.json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }
  await next();
}
