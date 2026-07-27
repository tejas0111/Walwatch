/**
 * Sui RPC Client Pool
 *
 * Provides multi-endpoint failover with per-URL circuit breakers.
 * Parses SUI_RPC_URLS (comma-separated) or falls back to SUI_RPC_URL / default.
 *
 * Each pool.call() tries endpoints in round-robin order, skipping
 * any whose circuit breaker is OPEN. On success, the circuit breaker
 * for that URL resets its failure count. On failure, it increments.
 *
 * Usage:
 *   const pool = createPoolFromEnv();
 *   const result = await pool.call((client) => client.getObject(...));
 */

import { SuiClient } from '@mysten/sui/client';
import { CircuitBreaker } from './circuit-breaker.js';
import { logger as rootLogger } from './logger.js';

const logger = rootLogger.child({ component: 'sui-pool' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolEntry {
  client: SuiClient;
  url: string;
  breaker: CircuitBreaker;
}

export interface SuiClientPoolConfig {
  /** Comma-separated list of RPC URLs */
  urls: string[];
  /** Circuit breaker threshold per URL (default: 5) */
  breakerThreshold?: number;
  /** Circuit breaker timeout in ms (default: 30_000) */
  breakerTimeout?: number;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

export class SuiClientPool {
  private entries: PoolEntry[] = [];
  private currentIndex = 0;

  constructor(config: SuiClientPoolConfig) {
    if (config.urls.length === 0) {
      throw new Error('At least one RPC URL is required');
    }

    this.entries = config.urls.map((url) => ({
      client: new SuiClient({ url }),
      url,
      breaker: new CircuitBreaker({
        threshold: config.breakerThreshold ?? 5,
        timeout: config.breakerTimeout ?? 30_000,
      }),
    }));

    logger.info(
      { count: this.entries.length, urls: config.urls },
      'Sui client pool initialized',
    );
  }

  /** Number of configured endpoints */
  get size(): number {
    return this.entries.length;
  }

  /** Primary (first) client — used for health checks */
  get primaryClient(): SuiClient {
    return this.entries[0].client;
  }

  /** Circuit breaker states for all endpoints (for metrics/logging) */
  get breakerStates(): Array<{ url: string; state: string }> {
    return this.entries.map((e) => ({
      url: e.url,
      state: e.breaker.state,
    }));
  }

  /**
   * Execute `fn` against the next healthy RPC endpoint.
   * Falls back to subsequent endpoints if one fails, wrapping each
   * attempt in the endpoint's circuit breaker. If ALL endpoints fail,
   * the last error is thrown.
   *
   * @param fn  Async function receiving a SuiClient
   * @returns   The result of fn
   */
  async call<T>(fn: (client: SuiClient) => Promise<T>): Promise<T> {
    const startIdx = this.currentIndex;
    let lastError: Error | null = null;

    for (let i = 0; i < this.entries.length; i++) {
      const idx = (startIdx + i) % this.entries.length;
      const entry = this.entries[idx];

      // Skip endpoints whose circuit breaker is OPEN (unless all are open)
      if (entry.breaker.state === 'OPEN') {
        lastError = new Error(
          `Circuit breaker OPEN for ${entry.url} (${entry.breaker.consecutiveFailures} failures)`,
        );
        continue;
      }

      try {
        const result = await entry.breaker.call(() => fn(entry.client));
        // Advance cursor for next call
        this.currentIndex = (idx + 1) % this.entries.length;
        return result;
      } catch (err) {
        lastError = err as Error;
        logger.warn(
          {
            url: entry.url,
            error: (err as Error).message,
            remainingEndpoints: this.entries.length - i - 1,
          },
          'RPC endpoint failed, trying next',
        );
        // entry.breaker.call() already tracked the failure — continue to next endpoint
      }
    }

    // All endpoints failed
    const errorSummary = this.entries
      .map((e) => `${e.url} (state=${e.breaker.state}, failures=${e.breaker.consecutiveFailures})`)
      .join(', ');

    logger.error(
      { endpoints: errorSummary, lastError: lastError?.message },
      'All RPC endpoints failed',
    );

    throw lastError || new Error('All Sui RPC endpoints failed');
  }

  /**
   * Reset all circuit breakers to CLOSED state.
   */
  resetAll(): void {
    for (const entry of this.entries) {
      entry.breaker.reset();
    }
    logger.info('All circuit breakers reset to CLOSED');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// URL Validation (SSRF Protection)
// ---------------------------------------------------------------------------

/** Private IPv4 ranges (CIDR start/end pairs). */
const PRIVATE_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff],   // 0.0.0.0/8       (current network, loopback emulation)
  [0x0a000000, 0x0affffff],   // 10.0.0.0/8       (RFC 1918)
  [0x12700000, 0x127fffff],   // 127.0.0.0/8      (loopback)
  [0x64400000, 0x647fffff],   // 100.64.0.0/10    (CGNAT)
  [0x7f000000, 0x7fffffff],   // 127.0.0.0/8      (duplicate, kept for clarity)
  [0xa9fe0000, 0xa9feffff],   // 169.254.0.0/16   (link-local)
  [0xac100000, 0xac1fffff],   // 172.16.0.0/12    (RFC 1918)
  [0xc0a80000, 0xc0a8ffff],   // 192.168.0.0/16   (RFC 1918)
  [0xffff0000, 0xffffffff],   // 255.255.0.0/16+  (broadcast / reserved)
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return false;
  const numeric = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  return PRIVATE_RANGES.some(([start, end]) => numeric >= start && numeric <= end);
}

/**
 * Validate a Sui RPC URL against SSRF risks.
 * Must be https and must not point to private/reserved IPs.
 * Throws on invalid URLs, warns on potential concerns.
 */
export function validateRpcUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid RPC URL: "${urlStr}" — not a valid URL`);
  }

  // Require HTTPS to prevent MITM on RPC traffic
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(
      `Insecure RPC URL scheme "${parsed.protocol}" for "${urlStr}". ` +
        'Only HTTPS is allowed (use localhost for local development).',
    );
  }

  // Block private / reserved IPs
  const hostname = parsed.hostname;
  const isIP = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (isIP && isPrivateIPv4(hostname)) {
    throw new Error(
      `RPC URL "${urlStr}" resolves to a private IP range — blocked for SSRF protection.`,
    );
  }

  // Warn on localhost HTTP (development)
  if (parsed.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    logger.warn({ url: urlStr }, 'RPC URL uses HTTP on localhost — only suitable for local development');
  }

  return parsed;
}

/**
 * Parse SUI_RPC_URLS (comma-separated) env var, falling back to
 * SUI_RPC_URL, then to the default testnet URL.
 *
 * Each URL is validated for SSRF protection (must be HTTPS, not private IP).
 *
 * Example:
 *   SUI_RPC_URLS="https://fullnode.testnet.sui.io:443,https://sui-testnet.nodeprovider.com:443"
 */
export function parseUrlsFromEnv(): string[] {
  const raw = process.env.SUI_RPC_URLS;
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url) => {
        validateRpcUrl(url);
        return url;
      });
  }

  const single = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';
  validateRpcUrl(single);
  return [single];
}

export function createPoolFromEnv(
  overrides?: Partial<SuiClientPoolConfig>,
): SuiClientPool {
  const urls = overrides?.urls ?? parseUrlsFromEnv();
  return new SuiClientPool({
    urls,
    breakerThreshold: overrides?.breakerThreshold,
    breakerTimeout: overrides?.breakerTimeout,
  });
}
