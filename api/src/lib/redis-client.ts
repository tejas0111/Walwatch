/**
 * Shared Redis client singleton.
 *
 * Standardizes on ioredis across all consumers (vaultService, auth, etc.)
 * to avoid the dual-library problem where `redis` and `ioredis` were both
 * imported in different modules with incompatible APIs.
 *
 * Implements robust reconnection:
 *   - Exponential backoff with max retry cap (10 retries, ~10s total)
 *   - PING health check before returning cached client
 *   - Proper event-driven state reset on 'end' / 'close'
 *   - Race-condition-free concurrent access via initPromise
 *
 * Usage:
 *   import { getRedisClient } from '../lib/redis-client.js';
 *   const r = await getRedisClient();
 *   await r.set('key', 'value');
 */
import Redis from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'redis-client' });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_RETRIES = 10;
const HEALTH_CHECK_TIMEOUT_MS = 2000;

let client: Redis | null = null;
let initPromise: Promise<Redis> | null = null;
let connectionAttempts = 0;

/**
 * Reset the global singleton state — used when a connection permanently fails.
 */
function resetClient(): void {
  client = null;
  initPromise = null;
  connectionAttempts = 0;
}

/**
 * Get the shared Redis client singleton.
 * Creates the connection on first call, then reuses it.
 * Performs a PING health check before returning a cached client.
 * If the connection drops, resets and reconnects on the next call.
 */
export async function getRedisClient(): Promise<Redis> {
  // Fast path — client is ready and healthy
  if (client) {
    if (client.status === 'ready') {
      // Verify the connection is actually alive with a lightweight PING
      try {
        const ping = await Promise.race([
          client.ping(),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('PING timeout')), HEALTH_CHECK_TIMEOUT_MS)
          ),
        ]);
        if (ping === 'PONG') return client;
      } catch {
        // Health check failed — connection is stale, fall through to reconnect
        logger.warn('Redis health check failed — reconnecting');
      }
    }

    // If we get here, the client is not healthy. Disconnect and reset.
    try {
      client.disconnect();
    } catch { /* ignore */ }
    resetClient();
  }

  // If client is null but initPromise exists, another caller is connecting
  if (initPromise) {
    try {
      return await initPromise;
    } catch {
      // Previous connection attempt failed — reset and try again
      resetClient();
    }
  }

  initPromise = createRedisClient();
  return initPromise;
}

/**
 * Create a new Redis connection. Exported for use cases that need
 * a dedicated client (e.g., rate-limit middleware with lazyConnect).
 */
export async function createRedisClient(): Promise<Redis> {
  const r = new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > MAX_RETRIES) {
        logger.error({ attempts: times }, 'Max Redis reconnection attempts reached — giving up');
        return null; // Stop retrying, will emit 'end'
      }
      // Exponential backoff: 100ms → 200ms → 400ms → ... → 5s max
      const delay = Math.min(100 * Math.pow(2, times), 5000);
      logger.info({ attempt: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
  });

  r.on('error', (err: Error) => {
    if (r.status === 'end' || r.status === 'close') {
      logger.error({ err, status: r.status }, 'Redis connection in dead state');
    } else {
      logger.error({ err }, 'Redis client error');
    }
  });

  r.on('connect', () => {
    logger.info('Redis client connected');
    connectionAttempts = 0;
  });

  r.on('close', () => {
    logger.warn('Redis client connection closed');
  });

  r.on('reconnecting', (delayMs: number) => {
    connectionAttempts++;
    logger.info({ attempt: connectionAttempts, delayMs }, 'Redis client reconnecting');
  });

  r.on('end', () => {
    // 'end' is emitted when retryStrategy returns null or maxRetriesPerRequest exhausted.
    // Reset the singleton immediately so the next getRedisClient() call doesn't
    // waste ~2s on a failed PING before reconnecting.
    logger.error('Redis client connection permanently ended — will reinitialize on next request');
    resetClient();
  });

  try {
    await r.connect();
    client = r;
    connectionAttempts = 0;
    return r;
  } catch (err) {
    logger.error({ err }, 'Failed to connect Redis');
    r.disconnect();
    resetClient();
    throw err; // Let caller decide fallback strategy
  }
}
