import { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { eq, and, gt, lt } from 'drizzle-orm';
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import pino from 'pino';

const log = pino({ name: 'idempotency' });

const idempotencyCache = pgTable('idempotency_cache', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  responseStatus: integer('response_status').notNull(),
  responseBody: text('response_body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

function compositeKey(c: Context, rawKey: string): string {
  const actorId = c.get('userId') || 'anonymous';
  const orgId = c.get('orgId') || '';
  const hash = crypto.createHash('sha256').update(`${actorId}:${orgId}`).digest('hex');
  return `${hash}:${c.req.method}:${c.req.path}:${rawKey}`;
}

const TTL_MS = 24 * 60 * 60 * 1000;

setInterval(async () => {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - TTL_MS);
    await db.delete(idempotencyCache)
      .where(lt(idempotencyCache.createdAt, cutoff));
  } catch (err) {
    log.error({ err }, 'Idempotency cache cleanup failed');
  }
}, 60 * 60 * 1000);

export async function idempotencyMiddleware(c: Context, next: Next) {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    return next();
  }

  const rawKey = c.req.header('Idempotency-Key');
  if (!rawKey) {
    return next();
  }

  const cacheKey = compositeKey(c, rawKey);
  const db = getDb();

  const existing = await db.select().from(idempotencyCache)
    .where(and(
      eq(idempotencyCache.idempotencyKey, cacheKey),
      gt(idempotencyCache.createdAt, new Date(Date.now() - TTL_MS)),
    ))
    .then(r => r[0]);

  if (existing) {
    return c.json(JSON.parse(existing.responseBody), existing.responseStatus as any);
  }

  const originalJson = c.json.bind(c);
  let statusCode: number | undefined;
  let responseBody: any;
  c.json = ((body: any, status?: ContentfulStatusCode) => {
    statusCode = status || 200;
    responseBody = body;
    return originalJson(body, statusCode as any);
  }) as typeof c.json;

  await next();

  if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) {
    db.insert(idempotencyCache).values({
      idempotencyKey: cacheKey,
      responseStatus: statusCode,
      responseBody: JSON.stringify(responseBody),
    }).catch((err) => {
      log.error({ err }, 'Failed to cache idempotency response');
    });
  }
}
