import { Context, Next } from 'hono';
import crypto from 'node:crypto';
import { runWithTraceId } from '../lib/trace-context.js';

export async function requestId(c: Context, next: Next) {
  const id = crypto.randomUUID();
  c.set('requestId', id);
  await runWithTraceId(id, next);
  c.res.headers.set('X-Request-Id', id);
}
