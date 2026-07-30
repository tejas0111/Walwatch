import { logger as rootLogger } from './logger.js';

const logger = rootLogger.child({ component: 'latency-monitor' });

interface LatencyThresholds {
  interactiveReadMs: number;
  dashboardLoadMs: number;
  renewalExecutionMs: number;
}

const DEFAULT_THRESHOLDS: LatencyThresholds = {
  interactiveReadMs: 1000,
  dashboardLoadMs: 2000,
  renewalExecutionMs: 30000,
};

export function recordLatency(operation: string, durationMs: number, thresholds?: Partial<LatencyThresholds>): void {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const threshold = t[`${operation}Ms` as keyof LatencyThresholds] ?? t.interactiveReadMs;

  if (durationMs > threshold) {
    const pctOver = ((durationMs - threshold) / threshold * 100).toFixed(1);
    logger.warn({ operation, durationMs, threshold, pctOver }, 'Latency SLO violation');
  }
}

export function createLatencyTracker(operation: string, thresholds?: Partial<LatencyThresholds>) {
  const start = Date.now();
  return {
    finish: () => recordLatency(operation, Date.now() - start, thresholds),
  };
}
