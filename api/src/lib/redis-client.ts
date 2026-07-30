/**
 * Shared Redis client singleton.
 *
 * Standardizes on ioredis across all consumers (vaultService, auth, etc.)
 * to avoid the dual-library problem where `redis` and `ioredis` were both
 * imported in different modules with incompatible APIs.
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

let client: Redis | null = null;
let initPromise: Promise<Redis> | null = null;

/**
 * Get the shared Redis client singleton.
 * Creates the connection on first call, then reuses it.
 * If the connection drops, resets and reconnects on the next call.
 */
export async function getRedisClient(): Promise<Redis> {
  if (client && client.status === 'ready') return client;
  if (client && (client.status === 'connecting' || client.status === 'reconnecting')) {
    // Wait for existing connection attempt
    if (initPromise) return initPromise;
  }
  // Reset if in a dead state
  if (client) {
    try { client.disconnect(); } catch { /* ignore */ }
    client = null;
    initPromise = null;
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
      // Exponential backoff: 100ms → 200ms → 400ms → ... → 5s max
      const delay = Math.min(100 * Math.pow(2, times), 5000);
      return delay;
    },
  });

  r.on('error', (err: Error) => {
    logger.error({ err }, 'Redis client error');
  });

  r.on('connect', () => {
    logger.info('Redis client connected');
  });

  r.on('close', () => {
    logger.warn('Redis client connection closed');
  });

  try {
    await r.connect();
    client = r;
    return r;
  } catch (err) {
    logger.error({ err }, 'Failed to connect Redis');
    r.disconnect();
    throw err; // Let caller decide fallback strategy
  }
}
