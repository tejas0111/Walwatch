import { createMiddleware } from 'hono/factory';
import pino from 'pino';

const log = pino({ name: 'auto-renewal-api' });

export function requestLogger() {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    const requestId = c.get('requestId') || 'unknown';

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;
    const method = c.req.method;
    const path = c.req.path;

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

    log[level]({ requestId, method, path, status, duration, timestamp: new Date().toISOString() },
      `${method} ${path} ${status} ${duration}ms`,
    );
  });
}
