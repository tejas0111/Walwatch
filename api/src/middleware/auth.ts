import { Context, Next } from 'hono';
import { verify } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { ErrorCodes } from '../lib/errors.js';

export interface AuthUser {
  userId: string;
  email: string;
}

type Variables = {
  userId: string;
};

// TODO: spec 06 granular capability system - requires architectural discussion

function getRequestId(c: any): string | undefined {
  return c.get('requestId');
}

export async function requireAuth(c: Context<{ Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: { message: 'Missing or invalid Authorization header', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'walwatch',
      audience: 'walwatch-api',
    }) as { userId: string };
    c.set('userId', payload.userId);
    await next();
  } catch {
    return c.json({ error: { message: 'Invalid or expired token', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
  }
}

export async function requireAuthOrApiKey(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const apiKey = c.req.header('X-API-Key');

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payload = verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'walwatch',
        audience: 'walwatch-api',
      }) as { userId: string };
      c.set('userId', payload.userId);
      await next();
      return;
    } catch {
      return c.json({ error: { message: 'Invalid or expired token', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
    }
  }

  if (apiKey) {
    const db = getDb();
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const [key] = await db.select({
      id: apiKeys.id,
      orgId: apiKeys.orgId,
      userId: apiKeys.userId,
      expiresAt: apiKeys.expiresAt,
      role: apiKeys.role,
      permissions: apiKeys.permissions,
      status: apiKeys.status,
    }).from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);

    if (!key) return c.json({ error: { message: 'Invalid API key', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
    if (key.status === 'revoked' || key.status === 'rotated') {
      return c.json({ error: { message: 'API key is no longer active', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
    }
    if (key.status !== 'active') return c.json({ error: { message: 'API key is not active', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      return c.json({ error: { message: 'API key expired', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
    }

    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => {});

    c.set('userId', key.userId);
    c.set('orgId', key.orgId);
    c.set('role', key.role ?? 'member');
    c.set('authMethod', 'api-key');
    await next();
    return;
  }

  return c.json({ error: { message: 'Missing Authorization header or X-API-Key', code: ErrorCodes.UNAUTHORIZED, failureClass: 'persistent', requestId: getRequestId(c) } }, 401);
}
