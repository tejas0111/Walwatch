import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  operationName?: string;
  context?: Record<string, unknown>;
  onRetry?: (attempt: number, delayMs: number) => void;
}

/**
 * Check if an error is a transient network/connection error.
 * Recognizes:
 *   - Standard Node.js system error codes (ECONNRESET, ETIMEDOUT, etc.)
 *   - Errors with code matching typical network errors
 *   - Errors with message containing network-related keywords
 *   - Spec 20 Transient errors (failureClass === 'transient') from the AppError hierarchy
 *
 * Returns true for transient errors that are safe to retry.
 */
export function isNetworkError(error: unknown): boolean {
  // Spec 20: Check for TransientError / AppError with transient failure class
  if (error && typeof error === 'object') {
    const maybeAppError = error as { failureClass?: string; name?: string };
    if (maybeAppError.failureClass === 'transient') return true;
    if (maybeAppError.name === 'TransientError' || maybeAppError.name === 'RateLimitError' || maybeAppError.name === 'ExternalServiceError') return true;
  }

  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error instanceof Error) {
    const err = error as Error & { code?: string };
    if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code)) return true;
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('etimedout')) return true;
    if (msg.includes('circuit breaker is open')) return true;
  }
  return false;
}

/**
 * Escalate a transient error that has exhausted retries to a persistent-class error.
 * Spec 20: "Transient failures that exhaust retries become Persistent-class escalations."
 */
export function escalateTransientToPersistent(
  originalError: unknown,
  operationName: string,
): Error {
  const message = originalError instanceof Error
    ? `${operationName}: ${originalError.message} (retries exhausted)`
    : `${operationName}: transient failure exhausted retries`;

  const err = new Error(message);
  (err as any).failureClass = 'persistent';
  (err as any).originalError = originalError instanceof Error ? originalError : undefined;
  return err;
}

/**
 * Classify a job-level error as retryable or non-retryable per Spec 16.
 *
 * Retryable: transient network issues, RPC timeouts, circuit breaker trips,
 *            temporary publisher unavailability, temporary DB contention.
 *
 * Non-retryable: entity not found, configuration errors, policy rejections,
 *                validation failures, budget blocks — anything that will fail
 *                identically on every retry.
 *
 * This is the job-level classification. Lower-level utilities like
 * withRetry() use isNetworkError() for their own narrower check.
 */
export function isRetryableJobError(error: unknown): boolean {
  // Network errors are always retryable
  if (isNetworkError(error)) return true;

  if (error instanceof Error) {
    const msg = error.message;

    // Non-retryable patterns (word-boundary matching)
    const NON_RETRYABLE_PATTERNS = [
      /\bvault\s+not\s+found\b/i,
      /\bblob\s+not\s+found\b/i,
      /\bdoes\s+not\s+exist\b/i,
      /\binvalid\s+(arguments|parameters|request)\b/i,
      /\binsufficient\s+balance\b/i,
      /\bunauthorized\b/i,
      /\bpermission\s+denied\b/i,
      /\bnot\s+supported\b/i,
      /\bmalformed\b/i,
      /\bexceeds\s+maximum\b/i,
    ];
    for (const pattern of NON_RETRYABLE_PATTERNS) {
      if (pattern.test(msg)) return false;
    }

    // Retryable patterns (word-boundary matching)
    const RETRYABLE_PATTERNS = [
      /\btimeout\b/i,
      /\btry\s+again\b/i,
      /\btemporarily\s+unavailable\b/i,
      /\btransient\b/i,
      /\brate\s+limit\b/i,
      /\btoo\s+many\s+requests\b/i,
      /\bnetwork\s+error\b/i,
      /\bconnection\s+refused\b/i,
      /\bservice\s+unavailable\b/i,
      /\bbusy\b/i,
    ];
    for (const pattern of RETRYABLE_PATTERNS) {
      if (pattern.test(msg)) return true;
    }
  }

  // Default: safe side — return true (retryable) so the job gets another chance
  // rather than silently dropping. Per-job handlers can override this default
  // with more specific classification before calling withRetry.
  return true;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 30000;
  const operationName = options.operationName || 'operation';
  const context = options.context || {};

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (!isNetworkError(error)) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
        const jitter = Math.round(delay * (0.5 + Math.random() * 0.5));

        logger.warn(
          {
            attempt,
            maxRetries,
            delayMs: jitter,
            operation: operationName,
            ...context,
          },
          `Retry ${operationName}: attempt ${attempt}/${maxRetries}, retrying in ${jitter}ms`,
        );

        options.onRetry?.(attempt, jitter);
        await new Promise((resolve) => setTimeout(resolve, jitter));
      }
    }
  }

  logger.error(
    { maxRetries, operation: operationName, ...context },
    `${operationName} failed after ${maxRetries} retries`,
  );
  // Spec 20: "Transient failures that exhaust retries become Persistent-class escalations"
  const errorToThrow = lastError || new Error(`${operationName} failed after ${maxRetries} retries`);
  throw escalateTransientToPersistent(errorToThrow, operationName);
}
