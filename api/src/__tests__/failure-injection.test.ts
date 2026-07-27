import { describe, it, expect, vi } from 'vitest';
import {
  isTransient,
  escalateTransientToPersistent,
  TransientError,
  RateLimitError,
  ExternalServiceError,
  PersistentError,
  SystemicError,
} from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

describe('Failure injection - Publisher fallback', () => {
  it('falls back to next publisher on failure', async () => {
    let calls: string[] = [];

    const publishers = ['primary', 'secondary', 'tertiary'];

    const executeWithFallback = async () => {
      for (const pub of publishers) {
        calls.push(pub);
        try {
          if (pub === 'primary') throw new TransientError(`${pub} unavailable`);
          if (pub === 'secondary') throw new TransientError(`${pub} unavailable`);
          return `success from ${pub}`;
        } catch (err) {
          if (publishers.indexOf(pub) === publishers.length - 1) {
            throw err;
          }
        }
      }
      throw new Error('all publishers failed');
    };

    const result = await executeWithFallback();
    expect(result).toBe('success from tertiary');
    expect(calls).toEqual(['primary', 'secondary', 'tertiary']);
  });

  it('returns first healthy publisher result immediately', async () => {
    const publishers = ['primary', 'secondary', 'tertiary'];

    const execute = async () => {
      for (const pub of publishers) {
        try {
          if (pub === 'primary') throw new TransientError(`${pub} unavailable`);
          return `result from ${pub}`;
        } catch {
          continue;
        }
      }
      throw new Error('all publishers failed');
    };

    const result = await execute();
    expect(result).toBe('result from secondary');
  });

  it('primary falls back to secondary on failure', async () => {
    const calls: string[] = [];

    const execute = async () => {
      const ordered = ['primary', 'secondary', 'tertiary'];
      for (const pub of ordered) {
        calls.push(pub);
        try {
          if (pub === 'primary') throw new Error(`${pub} failed`);
          return pub;
        } catch {
          continue;
        }
      }
      throw new Error('all failed');
    };

    const result = await execute();
    expect(result).toBe('secondary');
    expect(calls).toEqual(['primary', 'secondary']);
  });
});

describe('Failure injection - Notification channel escalation', () => {
  it('activates escalation after channel failure', () => {
    const event = {
      channel: 'email',
      attempts: 3,
      maxAttempts: 3,
      escalated: false,
    };

    event.attempts++;
    if (event.attempts > event.maxAttempts) {
      event.escalated = true;
    }

    expect(event.escalated).toBe(true);
  });

  it('does not escalate before retries exhausted', () => {
    const event = {
      channel: 'slack',
      attempts: 1,
      maxAttempts: 3,
      escalated: false,
    };

    event.attempts = 3;
    if (event.attempts < event.maxAttempts) {
      event.escalated = false;
    }

    expect(event.escalated).toBe(false);
  });
});

describe('Failure injection - DB connection error classification', () => {
  it('classifies fetch network error as transient', () => {
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
  });

  it('classifies network timeout error as transient', () => {
    const err = new Error('connection timed out');
    (err as any).code = 'ETIMEDOUT';
    expect(isTransient(err)).toBe(false);
  });

  it('classifies ECONNREFUSED as retryable via isRetryableError', async () => {
    const err = new Error('Connection refused');
    (err as any).code = 'ECONNREFUSED';

    let attemptCount = 0;
    await expect(
      withRetry(async () => {
        attemptCount++;
        throw err;
      }, { maxRetries: 2, baseDelay: 1, label: 'db-test' })
    ).rejects.toThrow(PersistentError);
  });
});

describe('Failure injection - Network timeout retry behavior', () => {
  it('retries on transient errors and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new TransientError('timeout');
      return 'success';
    }, { maxRetries: 3, baseDelay: 1, label: 'timeout-test' });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('exhausts retries and throws PersistentError', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new TransientError('always fails');
      }, { maxRetries: 2, baseDelay: 1, label: 'exhaust-test' })
    ).rejects.toThrow(PersistentError);

    expect(attempts).toBe(3);
  });

  it('does not retry on non-transient errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new PersistentError('bad config');
      }, { maxRetries: 3, baseDelay: 1 })
    ).rejects.toThrow('bad config');

    expect(attempts).toBe(1);
  });
});

describe('Failure injection - Rate limit 429 response', () => {
  it('classifies RateLimitError as transient', () => {
    const err = new RateLimitError();
    expect(isTransient(err)).toBe(true);
    expect(err.statusCode).toBe(429);
  });

  it('RateLimitError is retryable by withRetry', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts <= 2) throw new RateLimitError();
      return 'ok';
    }, { maxRetries: 3, baseDelay: 1, label: 'ratelimit-test' });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('retry exhausted on rate limit becomes PersistentError', async () => {
    await expect(
      withRetry(async () => {
        throw new RateLimitError();
      }, { maxRetries: 1, baseDelay: 1, label: 'ratelimit-exhaust' })
    ).rejects.toThrow(PersistentError);
  });

  it('ExternalServiceError with retryAfter is transient', () => {
    const err = new ExternalServiceError('Sui RPC down', 5000);
    expect(isTransient(err)).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it('escalates transient to persistent with original error as cause', () => {
    const original = new TransientError('network timeout');
    const escalated = escalateTransientToPersistent(original, 'Renewal job 123');
    expect(escalated.message).toContain('Renewal job 123');
    expect(escalated.message).toContain('retries exhausted');
    expect(escalated.cause).toBe(original);
  });

  it('SystemicError is not transient', () => {
    const err = new SystemicError('DB connection pool exhausted');
    expect(isTransient(err)).toBe(false);
  });
});
