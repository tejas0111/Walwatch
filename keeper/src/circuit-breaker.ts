import { logger } from './logger.js';
import type { MetricsCollector } from './metrics.js';

export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export interface CircuitBreakerConfig {
  threshold?: number;
  timeout?: number;
}

const STATE_TO_NUM: Record<CircuitState, 0 | 1 | 2> = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 };

export class CircuitBreaker {
  private _state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private probing = false;
  private threshold: number;
  private timeout: number;
  private metrics?: MetricsCollector;

  constructor(config?: CircuitBreakerConfig & { metrics?: MetricsCollector }) {
    this.threshold = config?.threshold ?? parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10);
    this.timeout = config?.timeout ?? parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000', 10);
    this.metrics = config?.metrics;
  }

  get state(): CircuitState {
    return this._state;
  }

  get consecutiveFailures(): number {
    return this.failureCount;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    let currentState = this._state;

    if (currentState === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.transitionTo('HALF_OPEN');
        currentState = 'HALF_OPEN';
      }
    }

    if (currentState === 'OPEN') {
      throw new Error(`Circuit breaker is OPEN (${this.failureCount} consecutive failures)`);
    }

    if (currentState === 'HALF_OPEN') {
      if (this.probing) {
        throw new Error('Circuit breaker is currently probing. Try again later.');
      }
      this.probing = true;
    }

    try {
      const result = await fn();
      if (this._state === 'HALF_OPEN') {
        this.transitionTo('CLOSED');
      }
      this.failureCount = 0;
      this.metrics?.setCircuitBreakerState(this._state);
      return result;
    } catch (error) {
      this.failureCount++;
      if (this.failureCount >= this.threshold && this._state !== 'OPEN') {
        this.lastFailureTime = Date.now();
        this.transitionTo('OPEN');
      }
      this.metrics?.setCircuitBreakerState(this._state);
      throw error;
    } finally {
      this.probing = false;
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this._state;
    this._state = newState;
    logger.warn(
      { oldState, newState, failureCount: this.failureCount },
      `Circuit breaker state transition: ${oldState} -> ${newState}`,
    );
    this.metrics?.recordCircuitBreakerTransition();
    this.metrics?.setCircuitBreakerState(newState);
  }

  reset(): void {
    this._state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.probing = false;
    logger.info('Circuit breaker manually reset to CLOSED');
    this.metrics?.recordCircuitBreakerTransition();
    this.metrics?.setCircuitBreakerState(this._state);
  }
}
