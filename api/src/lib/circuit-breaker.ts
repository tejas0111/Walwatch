/**
 * Circuit breaker for external service calls.
 *
 * Prevents cascading failures by stopping calls to a failing service
 * and allowing periodic probe requests to detect recovery.
 *
 * States:
 *   CLOSED  — Normal operation. Failures increment counter.
 *   OPEN    — Service declared unhealthy. All calls fail immediately.
 *   HALF_OPEN — Probe allowed. Success → CLOSED, failure → OPEN.
 */

import pino from 'pino';

const log = pino({ name: 'circuit-breaker' });

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures to trip the breaker (default: 5) */
  threshold?: number;
  /** Time in ms to stay OPEN before trying HALF_OPEN (default: 30000) */
  timeout?: number;
  /** Label for logging */
  label?: string;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private probing = false;
  private readonly threshold: number;
  private readonly timeout: number;
  private readonly label: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.timeout = options.timeout ?? 30_000;
    this.label = options.label ?? 'default';
  }

  getState(): CircuitState {
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws immediately if the breaker is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = CircuitState.HALF_OPEN;
        log.info({ label: this.label }, 'Circuit breaker transitioning to HALF_OPEN');
      }
    }

    const currentState = this.state;

    if (currentState === CircuitState.OPEN) {
      const waitMs = this.timeout - (Date.now() - this.lastFailureTime);
      throw new Error(
        `Circuit breaker is open for "${this.label}". Retry in ${Math.max(0, waitMs)}ms`,
      );
    }

    if (currentState === CircuitState.HALF_OPEN && this.probing) {
      throw new Error(`Circuit breaker is probing for "${this.label}". Try again later.`);
    }

    if (currentState === CircuitState.HALF_OPEN) {
      this.probing = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      this.probing = false;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      log.info({ label: this.label }, 'Circuit breaker CLOSED (recovered)');
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      log.warn(
        { label: this.label },
        'Circuit breaker OPEN (half-open probe failed)',
      );
    } else if (this.failureCount >= this.threshold) {
      this.state = CircuitState.OPEN;
      log.warn(
        { label: this.label, failureCount: this.failureCount },
        'Circuit breaker OPEN (threshold reached)',
      );
    }
  }

  /** Reset the circuit breaker to CLOSED state. */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.probing = false;
  }
}
