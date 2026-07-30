/**
 * Sui RPC Client Pool
 *
 * Provides multi-endpoint failover with per-URL circuit breakers.
 * The API uses this instead of a raw SuiJsonRpcClient for RPC calls that
 * originate from the backend (health checks, vault queries, event
 * queries).
 *
 * Usage:
 *   const pool = createPoolFromEnv();
 *   const result = await pool.call((client) => client.getObject(...));
 *
 * Circuit breakers reset automatically after the configured timeout.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import pino from 'pino';

const logger = pino({ name: 'sui-pool' });

// ---------------------------------------------------------------------------
// URL Validation (SSRF Protection)
// ---------------------------------------------------------------------------

// RFC 1918 private IPv4 ranges and loopback
const PRIVATE_IP_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' }, // link-local
];

function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipToNum(ip);
  return PRIVATE_IP_RANGES.some((r) => num >= ipToNum(r.start) && num <= ipToNum(r.end));
}

function validateRpcUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid RPC URL: ${url} — must be a valid URL`);
  }

  // Only HTTPS is allowed (production Sui endpoints all use HTTPS)
  if (parsed.protocol !== 'https:') {
    throw new Error(`Invalid RPC URL: ${url} — only HTTPS URLs are allowed`);
  }

  // Block private IPs (SSRF protection)
  const hostname = parsed.hostname;
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new Error(`Invalid RPC URL: ${url} — localhost/private IPs are not allowed`);
  }

  // Check for IPv4 private ranges
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  if (isIPv4 && isPrivateIPv4(hostname)) {
    throw new Error(`Invalid RPC URL: ${url} — private IPs are not allowed`);
  }

  return url;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolEntry {
  client: SuiJsonRpcClient;
  url: string;
  state: 'CLOSED' | 'OPEN';
  failureCount: number;
  lastFailureTime: number;
}

interface SuiPoolOptions {
  /** Consecutive failures before tripping (default: 3) */
  threshold?: number;
  /** Cooldown in ms before retrying a tripped URL (default: 30_000) */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Client Pool
// ---------------------------------------------------------------------------

export class SuiClientPool {
  private readonly entries: PoolEntry[] = [];
  private readonly threshold: number;
  private readonly timeout: number;
  private roundRobinIndex = 0;

  constructor(urls: string[], options: SuiPoolOptions = {}) {
    this.threshold = options.threshold ?? 3;
    this.timeout = options.timeout ?? 30_000;

    for (const url of urls) {
      const trimmed = url.trim();
      if (trimmed) {
        const validated = validateRpcUrl(trimmed);
        this.entries.push({
          client: new SuiJsonRpcClient({ url: validated, network: 'testnet' }),
          url: validated,
          state: 'CLOSED',
          failureCount: 0,
          lastFailureTime: 0,
        });
      }
    }

    if (this.entries.length === 0) {
      const defaultUrl = 'https://fullnode.testnet.sui.io:443';
      logger.warn('No SUI_RPC_URLS configured — falling back to %s', defaultUrl);
      this.entries.push({
        client: new SuiJsonRpcClient({ url: defaultUrl, network: 'testnet' }),
        url: defaultUrl,
        state: 'CLOSED',
        failureCount: 0,
        lastFailureTime: 0,
      });
    }

    logger.info({ urlCount: this.entries.length, threshold: this.threshold }, 'SuiClientPool initialized');
  }

  /**
   * Return the number of configured endpoints.
   */
  get urlCount(): number {
    return this.entries.length;
  }

  /**
   * Return the list of endpoint URLs (for health check).
   */
  get urls(): string[] {
    return this.entries.map((e) => e.url);
  }

  /**
   * Return the state of each endpoint (for health check).
   */
  getEndpointStates(): Array<{ url: string; state: string; failureCount: number }> {
    return this.entries.map((e) => ({
      url: e.url,
      state: e.state,
      failureCount: e.failureCount,
    }));
  }

  /**
   * Execute a function against an available client from the pool.
   * Tries endpoints in round-robin order, skipping OPEN ones.
   * Throws if ALL endpoints are OPEN.
   */
  async call<T>(fn: (client: SuiJsonRpcClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const available = this.getAvailableEntries();
    if (available.length === 0) {
      throw new Error('All Sui RPC endpoints are circuit-broken');
    }

    // Try each available endpoint in round-robin order
    const errors: Array<{ url: string; error: Error }> = [];
    const startIndex = this.roundRobinIndex % available.length;

    for (let i = 0; i < available.length; i++) {
      const idx = (startIndex + i) % available.length;
      const entry = available[idx];

      try {
        const result = await fn(entry.client);
        // Success — reset failure count and update round-robin
        entry.failureCount = 0;
        entry.state = 'CLOSED';
        this.roundRobinIndex = (this.roundRobinIndex + 1) % this.entries.length;
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ url: entry.url, error: err });
        this.recordFailure(entry);

        // If this was a circuit-breaker tripped error from a previous call,
        // record it but don't check for abort
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        logger.warn({ url: entry.url, error: err.message }, 'RPC call failed, trying next endpoint');
      }
    }

    // All endpoints failed
    const error = new AggregateError(
      errors.map((e) => e.error),
      `All ${errors.length} Sui RPC endpoints failed`,
    );
    throw error;
  }

  private getAvailableEntries(): PoolEntry[] {
    const now = Date.now();
    return this.entries.filter((entry) => {
      if (entry.state === 'CLOSED') return true;
      // Check if OPEN but cooldown has expired
      if (now - entry.lastFailureTime >= this.timeout) {
        logger.info({ url: entry.url }, 'Circuit breaker reset — endpoint available for retry');
        entry.state = 'CLOSED';
        return true;
      }
      return false;
    });
  }

  private recordFailure(entry: PoolEntry): void {
    entry.failureCount++;
    entry.lastFailureTime = Date.now();

    if (entry.failureCount >= this.threshold) {
      entry.state = 'OPEN';
      logger.warn(
        { url: entry.url, failureCount: entry.failureCount },
        'Circuit breaker OPEN — skipping endpoint',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SuiClientPool from environment variables.
 * Reads SUI_RPC_URLS (comma-separated) or falls back to SUI_RPC_URL.
 */
export function createPoolFromEnv(options?: SuiPoolOptions): SuiClientPool {
  const urlsRaw = process.env.SUI_RPC_URLS || process.env.SUI_RPC_URL || '';
  const urls = urlsRaw.split(',').map((u) => u.trim()).filter(Boolean);
  return new SuiClientPool(urls, options);
}
