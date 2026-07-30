/**
 * Retry utility with exponential backoff and jitter.
 *
 * Retries only on transient/network errors. Business logic errors
 * (4xx HTTP responses, validation errors) are thrown immediately.
 */

import pino from 'pino';
import { isTransient, escalateTransientToPersistent } from './errors.js';

const log = pino({ name: 'retry' });

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelay?: number;
  /** Label for logging (default: 'operation') */
  label?: string;
  /** Callback invoked before each retry */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

function isRetryableError(error: unknown): boolean {
  // Spec 20: Check the AppError class hierarchy first — TransientError and its
  // subclasses (RateLimitError, ExternalServiceError) are retryable by definition.
  if (isTransient(error)) return true;

  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('fetch') || msg.includes('network') || msg.includes('aborted');
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const errWithCode = error as { code?: string; message?: string };
    const code = errWithCode.code?.toLowerCase?.() || '';

    // Network-level errors
    if (
      code === 'econnreset' ||
      code === 'etimedout' ||
      code === 'econnrefused' ||
      code === 'enotfound' ||
      code === 'eai_again' ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('socket hang up') ||
      msg.includes('request failed') ||
      msg.includes('circuit breaker is open')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @example
 * ```ts
 * const data = await withRetry(
 *   () => fetch('https://rpc.sui.io', { body: ... }),
 *   { maxRetries: 3, label: 'sui-rpc' }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30_000,
    label = 'operation',
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on non-retryable errors
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        log.error({ label, attempt, maxRetries, error: lastError }, 'Retry exhausted');
        // Spec 20: "Transient failures that exhaust retries become Persistent-class escalations"
        throw escalateTransientToPersistent(lastError, label);
      }

      // Exponential backoff with jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = exponentialDelay * (0.5 + Math.random() * 0.5);
      const delayMs = Math.round(jitter);

      log.warn({ label, attempt: attempt + 1, delayMs, error: lastError }, 'Retrying after transient error');

      if (onRetry) {
        onRetry(attempt + 1, lastError, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
