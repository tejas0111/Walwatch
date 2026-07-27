import type { RenewalResult } from './executor.js';
import { logger } from './logger.js';
import type { CircuitState } from './circuit-breaker.js';

export interface MetricsSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  totalGasUsed: bigint;
  avgLatencyMs: number;
  avgQueueLatencyMs: number;
  circuitBreakerTransitions: number;
  circuitBreakerState: number;
  retryCount: number;
  queueDepth: number;
  notificationsByType: Record<string, number>;
  renewalsAttempted: number;
  renewalsSucceeded: number;
  renewalsFailed: number;
  dbConnectionPoolSize: number;
  /** Estimate-vs-actual cost accuracy tracking (Spec 18) */
  estimateAccuracyRatios: number[];
  avgEstimateAccuracy: number;
}

export class MetricsCollector {
  private readonly maxResults = 1000;
  private results: RenewalResult[] = [];
  private errors: Map<string, Error> = new Map();
  private startTimes: Map<string, number> = new Map();
  private completedLatencies: number[] = [];
  private _circuitBreakerTransitions = 0;
  private _circuitBreakerState: number = 0;
  private _retryCount = 0;
  private _queueDepth = 0;
  private _notificationsByType: Record<string, number> = {};
  private _renewalsAttempted = 0;
  private _renewalsSucceeded = 0;
  private _renewalsFailed = 0;
  private _dbConnectionPoolSize = 0;
  private _queueProcessingLatencies: number[] = [];
  /** Estimate-vs-actual accuracy ratios (Spec 18: tracked as metric) */
  private _estimateAccuracyRatios: number[] = [];

  recordStart(vaultId: string): void {
    this.startTimes.set(vaultId, Date.now());
  }

  recordSuccess(result: RenewalResult): void {
    this.recordCompletion(result.vaultId);
    this.results.push(result);
    if (this.results.length > this.maxResults) {
      this.results.shift();
    }
  }

  recordFailure(vaultId: string, error: Error): void {
    this.recordCompletion(vaultId);
    this.errors.set(vaultId, error);
    if (this.errors.size > 1000) {
      const firstKey = this.errors.keys().next().value;
      if (firstKey !== undefined) this.errors.delete(firstKey);
    }
  }

  private recordCompletion(vaultId: string): void {
    const startTime = this.startTimes.get(vaultId);
    if (startTime !== undefined) {
      const elapsed = Date.now() - startTime;
      this.completedLatencies.push(elapsed);
      if (this.completedLatencies.length > 1000) {
        this.completedLatencies.shift();
      }
      this.startTimes.delete(vaultId);
    } else {
      logger.warn({ vaultId }, 'recordCompletion called without a matching recordStart');
    }
  }

  recordCircuitBreakerTransition(): void {
    this._circuitBreakerTransitions++;
  }

  setCircuitBreakerState(state: CircuitState): void {
    this._circuitBreakerState = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;
  }

  recordRetryAttempt(): void {
    this._retryCount++;
  }

  setQueueDepth(depth: number): void {
    this._queueDepth = depth;
  }

  recordNotificationSent(provider: string): void {
    this._notificationsByType[provider] = (this._notificationsByType[provider] || 0) + 1;
  }

  recordRenewalAttempted(): void {
    this._renewalsAttempted++;
  }

  recordRenewalSucceeded(): void {
    this._renewalsSucceeded++;
  }

  recordRenewalFailed(): void {
    this._renewalsFailed++;
  }

  /**
   * Record how long a job waited in the queue before being processed (Spec 16 observability).
   * @param latencyMs Time in ms between job creation and processing start.
   */
  recordQueueProcessingLatency(latencyMs: number): void {
    this._queueProcessingLatencies.push(latencyMs);
    if (this._queueProcessingLatencies.length > 1000) {
      this._queueProcessingLatencies.shift();
    }
  }

  /**
   * Record estimate-vs-actual cost accuracy ratio (Spec 18).
   * Ratio = actual / estimated, where 1.0 = perfect estimate.
   * Values > 1 mean actual cost exceeded estimate (under-estimated).
   * Values < 1 mean actual cost was less than estimate (over-estimated).
   */
  recordEstimateAccuracy(ratio: number): void {
    this._estimateAccuracyRatios.push(ratio);
    if (this._estimateAccuracyRatios.length > 1000) {
      this._estimateAccuracyRatios.shift();
    }
  }

  setDbConnectionPoolSize(size: number): void {
    this._dbConnectionPoolSize = size;
  }

  summarize(): MetricsSummary {
    const totalGasUsed = this.results.reduce(
      (sum, r) => sum + r.gasUsed,
      BigInt(0),
    );

    const avgLatencyMs =
      this.completedLatencies.length > 0
        ? Math.round(
            this.completedLatencies.reduce((a, b) => a + b, 0) /
              this.completedLatencies.length,
          )
        : 0;

    const avgQueueLatencyMs =
      this._queueProcessingLatencies.length > 0
        ? Math.round(
            this._queueProcessingLatencies.reduce((a, b) => a + b, 0) /
              this._queueProcessingLatencies.length,
          )
        : 0;

    const avgEstimateAccuracy =
      this._estimateAccuracyRatios.length > 0
        ? Math.round(
            (this._estimateAccuracyRatios.reduce((a, b) => a + b, 0) / this._estimateAccuracyRatios.length) * 1000,
          ) / 1000
        : 0;

    return {
      attempted: this.results.length + this.errors.size,
      succeeded: this.results.length,
      failed: this.errors.size,
      totalGasUsed,
      avgLatencyMs,
      avgQueueLatencyMs,
      circuitBreakerTransitions: this._circuitBreakerTransitions,
      circuitBreakerState: this._circuitBreakerState,
      retryCount: this._retryCount,
      queueDepth: this._queueDepth,
      notificationsByType: { ...this._notificationsByType },
      renewalsAttempted: this._renewalsAttempted,
      renewalsSucceeded: this._renewalsSucceeded,
      renewalsFailed: this._renewalsFailed,
      dbConnectionPoolSize: this._dbConnectionPoolSize,
      estimateAccuracyRatios: [...this._estimateAccuracyRatios],
      avgEstimateAccuracy,
    };
  }

  reset(): void {
    this.results = [];
    this.errors.clear();
    this.startTimes.clear();
    this.completedLatencies = [];
    this._circuitBreakerTransitions = 0;
    this._circuitBreakerState = 0;
    this._retryCount = 0;
    this._queueDepth = 0;
    this._notificationsByType = {};
    this._renewalsAttempted = 0;
    this._renewalsSucceeded = 0;
    this._renewalsFailed = 0;
    this._dbConnectionPoolSize = 0;
    this._queueProcessingLatencies = [];
    this._estimateAccuracyRatios = [];
  }
}
