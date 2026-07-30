/**
 * In-memory rate limiter — works per-process only.
 *
 * IMPORTANT: In multi-instance / horizontal scaling deployments, rate limits are NOT
 * shared between instances. A client hitting different instances can exceed the intended
 * limit. For production multi-instance deployments, consider Redis-backed rate limiting.
 * This implementation is suitable for single-instance deployments or when rate limiting
 * is supplemented by infrastructure-level controls (e.g., cloud load balancer limits).
 *
 * Spec 14: Rate limits are enforced per API Key / per Organization.
 * The default key extraction prioritizes API Key over client IP.
 */
import crypto from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { ErrorCodes, FailureClasses } from '../lib/errors.js';
import pino from 'pino';

const log = pino({ name: 'rate-limit' });

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (c: Context) => string;
}

interface RateLimitStore {
  increment(key: string, windowMs: number, max: number): Promise<{ count: number; ttl: number }>;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

class InMemoryStore implements RateLimitStore {
  private stores = new Map<string, Map<string, RateLimitEntry>>();
  private cleanupIntervals = new Map<string, ReturnType<typeof setInterval>>();

  private getStore(name: string): Map<string, RateLimitEntry> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return this.stores.get(name)!;
  }

  async increment(key: string, windowMs: number, max: number): Promise<{ count: number; ttl: number }> {
    const name = `rl_${windowMs}_${max}`;
    const store = this.getStore(name);

    if (!this.cleanupIntervals.has(name)) {
      const interval = setInterval(() => {
        const s = this.getStore(name);
        const now = Date.now();
        for (const [k, entry] of s) {
          if (now - entry.windowStart > windowMs) {
            s.delete(k);
          }
        }
      }, windowMs);
      interval.unref();
      this.cleanupIntervals.set(name, interval);
    }

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return { count: 1, ttl: windowMs };
    }

    entry.count++;
    const elapsed = now - entry.windowStart;
    return { count: entry.count, ttl: Math.max(0, windowMs - elapsed) };
  }
}

const INCR_AND_SET_TTL_SCRIPT = `
  local c = redis.call('INCR', KEYS[1])
  if c == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return {c, redis.call('PTTL', KEYS[1])}
`;

class RedisStore implements RateLimitStore {
  private redisUrl: string;
  private client: any;
  private initPromise: Promise<void> | null;
  private initTime: number;
  private fallbackStore: InMemoryStore;
  private fallbackActive: boolean;

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
    this.client = null;
    this.initPromise = null;
    this.initTime = 0;
    this.fallbackStore = new InMemoryStore();
    this.fallbackActive = false;
  }

  private async ensureClient(): Promise<void> {
    // If client exists and is ready, use it
    if (this.client && this.client.status === 'ready') return;

    // If we're in fallback mode, periodically retry Redis connection
    if (this.fallbackActive) {
      // Only retry once every 30 seconds to avoid connection storms
      if (Date.now() - this.initTime < 30_000) {
        return; // Stay in fallback mode
      }
      // Reset so we try connecting again
      this.fallbackActive = false;
      this.initTime = 0;
    }

    // If a connection attempt is already in progress, wait for it
    if (this.initPromise) {
      try {
        await this.initPromise;
        return;
      } catch {
        // Previous attempt failed, will try again
        this.initPromise = null;
      }
    }

    this.initPromise = this.initClient();
    return this.initPromise;
  }

  private async initClient(): Promise<void> {
    try {
      const { default: Redis } = await import('ioredis');
      const r = new Redis(this.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 5) {
            log.error('Max Redis reconnection attempts reached');
            return null;
          }
          return Math.min(100 * Math.pow(2, times), 3000);
        },
      });

      r.on('error', (err: Error) => {
        log.error({ err: err.message }, 'Redis client error');
      });

      r.on('end', () => {
        log.warn('Redis connection permanently lost — falling back to in-memory');
        this.fallbackActive = true;
        this.initTime = Date.now();
        this.client = null;
      });

      await r.connect();
      this.client = r;
      this.fallbackActive = false;
      this.initTime = Date.now();
      log.info('Redis client connected');
    } catch (err) {
      log.error({ err }, 'Failed to initialize Redis client — falling back to in-memory store');
      this.client = null;
      this.fallbackActive = true;
      this.initTime = Date.now();
    } finally {
      this.initPromise = null;
    }
  }

  async increment(key: string, windowMs: number, max: number): Promise<{ count: number; ttl: number }> {
    await this.ensureClient();
    if (!this.client || this.client.status !== 'ready') {
      if (!this.fallbackActive) {
        this.fallbackActive = true;
        this.initTime = Date.now();
        log.warn('Redis unavailable — using in-memory fallback');
      }
      return this.fallbackStore.increment(key, windowMs, max);
    }
    try {
      const results = await this.client.eval(INCR_AND_SET_TTL_SCRIPT, 1, key, windowMs);
      const count = Number(results[0]);
      const ttl = Number(results[1]);
      return { count, ttl: Math.max(0, ttl) };
    } catch (err) {
      log.error({ err: (err as Error).message }, 'Redis eval failed — falling back to in-memory');
      this.fallbackActive = true;
      this.initTime = Date.now();
      this.client = null;
      return this.fallbackStore.increment(key, windowMs, max);
    }
  }
}

const storeType = process.env.RATE_LIMIT_STORE || 'memory';
let store: RateLimitStore;
if (storeType === 'redis') {
  store = new RedisStore(process.env.REDIS_URL || 'redis://localhost:6379');
} else {
  store = new InMemoryStore();
}

/**
 * Default key function: uses API Key first, then X-Org-Id, then client IP.
 * This ensures rate limits are scoped per API Key per Spec 14.
 */
function defaultKeyFn(c: Context): string {
  // Priority 1: API key (most specific per-actor scoping)
  const apiKey = c.req.header('X-API-Key');
  if (apiKey) return `apikey:${crypto.createHash('sha256').update(apiKey).digest('hex')}`;

  // Priority 2: Org ID (organization-level scoping)
  const orgId = c.get('orgId') as string | undefined;
  if (orgId) return `org:${orgId}`;

  // Priority 3: Authenticated user ID
  const userId = c.get('userId') as string | undefined;
  if (userId) return `user:${userId}`;

  // Priority 4: Client IP (fallback for unauthenticated requests like register/login)
  // Trust model: x-forwarded-for is set by the trusted reverse proxy / load balancer.
  // We use only the FIRST value to prevent clients from spoofing their IP.
  const forwardedFor = c.req.header('x-forwarded-for');
  const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : undefined;
  return clientIp || c.req.header('x-real-ip') || 'unknown';
}

export function rateLimit({ windowMs, max, keyFn }: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const key = keyFn ? keyFn(c) : defaultKeyFn(c);
    const { count, ttl } = await store.increment(key, windowMs, max);

    const remaining = Math.max(0, max - count);
    const reset = Math.ceil((Date.now() + ttl) / 1000);

    if (count > max) {
      const retryAfter = Math.ceil(ttl / 1000);
      return c.json(
        {
          error: {
            message: 'Too many requests. Please slow down and retry after the specified time.',
            code: ErrorCodes.RATE_LIMITED,
            failureClass: FailureClasses.TRANSIENT,
          },
        },
        429,
        { 'Retry-After': retryAfter.toString() },
      );
    }

    await next();

    // Set rate limit headers after response is available
    // Spec 14: Limits returned in response metadata (not just opaque rejection)
    c.res.headers.set('X-RateLimit-Limit', max.toString());
    c.res.headers.set('X-RateLimit-Remaining', remaining.toString());
    c.res.headers.set('X-RateLimit-Reset', reset.toString());
  });
}

export { defaultKeyFn };
