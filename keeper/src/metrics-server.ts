import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MetricsCollector } from './metrics.js';
import { JobMonitor } from './job-monitor.js';
import { logger as rootLogger } from './logger.js';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type postgres from 'postgres';
import type { SuiClientPool } from './sui-pool.js';
import { emit, createEvent } from '../../api/src/lib/event-bus.js';

const logger = rootLogger.child({ component: 'metrics-server' });

export interface HealthDependencies {
  suiClient?: SuiJsonRpcClient;
  suiPool?: SuiClientPool;
  sql?: postgres.Sql | null;
}

let lastHealthStatus: 'ok' | 'degraded' | null = null;

let packageVersion = '0.1.0';
try {
  const pkgPath = resolve(import.meta.dirname || process.cwd(), '..', 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.version) packageVersion = pkg.version;
  }
} catch {}

export function startMetricsServer(
  metrics: MetricsCollector,
  jobMonitor: JobMonitor,
  port = 9090,
  healthDeps?: HealthDependencies,
) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      let dbStatus = 'unknown';
      let suiRpcStatus = 'unknown';

      try {
        if (healthDeps?.sql) {
          await healthDeps.sql`SELECT 1`;
          dbStatus = 'connected';
        } else {
          dbStatus = 'disconnected';
        }
      } catch {
        dbStatus = 'error';
      }

      try {
        if (healthDeps?.suiPool) {
          await healthDeps.suiPool.call((c) => c.getLatestCheckpointSequenceNumber());
          suiRpcStatus = 'connected';
        } else if (healthDeps?.suiClient) {
          await healthDeps.suiClient.getLatestCheckpointSequenceNumber();
          suiRpcStatus = 'connected';
        } else {
          suiRpcStatus = 'disconnected';
        }
      } catch {
        suiRpcStatus = 'error';
      }

      const status: 'ok' | 'degraded' = dbStatus === 'connected' && suiRpcStatus === 'connected' ? 'ok' : 'degraded';

      if (lastHealthStatus !== null && lastHealthStatus !== status) {
        if (status === 'degraded') {
          emit(createEvent('system.degraded', 'system', 'system', 'health-check', { type: 'system' }, {
            component: 'keeper',
            db: dbStatus,
            suiRpc: suiRpcStatus,
            previousState: lastHealthStatus,
            newState: 'degraded',
          }));
        } else {
          emit(createEvent('system.recovered', 'system', 'system', 'health-check', { type: 'system' }, {
            component: 'keeper',
            db: dbStatus,
            suiRpc: suiRpcStatus,
            previousState: lastHealthStatus,
            newState: 'ok',
          }));
        }
      }
      lastHealthStatus = status;

      const healthBody = JSON.stringify({
        status,
        version: packageVersion,
        uptime: process.uptime(),
        db: dbStatus,
        suiRpc: suiRpcStatus,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(healthBody);
      return;
    }

    if (req.url === '/metrics') {
      const stats = jobMonitor.getStats();
      const summary = metrics.summarize();

      const body = [
        '# HELP walwatch_keeper_cycle_attempted Vaults attempted per cycle',
        '# TYPE walwatch_keeper_cycle_attempted gauge',
        `walwatch_keeper_cycle_attempted ${summary.attempted}`,
        '',
        '# HELP walwatch_keeper_cycle_succeeded Vaults renewed per cycle',
        `walwatch_keeper_cycle_succeeded ${summary.succeeded}`,
        '',
        '# HELP walwatch_keeper_cycle_failed Vaults failed per cycle',
        `walwatch_keeper_cycle_failed ${summary.failed}`,
        '',
        '# HELP walwatch_keeper_cycle_latency_ms Average cycle latency',
        `walwatch_keeper_cycle_latency_ms ${summary.avgLatencyMs}`,
        '',
        '# HELP walwatch_keeper_circuit_breaker_transitions Circuit breaker state transitions',
        '# TYPE walwatch_keeper_circuit_breaker_transitions counter',
        `walwatch_keeper_circuit_breaker_transitions ${summary.circuitBreakerTransitions}`,
        '',
        '# HELP walwatch_keeper_circuit_breaker_state Circuit breaker state (0=CLOSED 1=HALF_OPEN 2=OPEN)',
        '# TYPE walwatch_keeper_circuit_breaker_state gauge',
        `walwatch_keeper_circuit_breaker_state ${summary.circuitBreakerState}`,
        '',
        '# HELP walwatch_keeper_retry_count Total retry attempts',
        '# TYPE walwatch_keeper_retry_count counter',
        `walwatch_keeper_retry_count ${summary.retryCount}`,
        '',
        '# HELP walwatch_keeper_queue_depth Pending vault renewals',
        '# TYPE walwatch_keeper_queue_depth gauge',
        `walwatch_keeper_queue_depth ${summary.queueDepth}`,
        '',
        '# HELP walwatch_keeper_queue_latency_ms Average time jobs spend in queue before processing',
        '# TYPE walwatch_keeper_queue_latency_ms gauge',
        `walwatch_keeper_queue_latency_ms ${summary.avgQueueLatencyMs}`,
        '',
        '# HELP walwatch_keeper_renewals_attempted Total renewals attempted',
        '# TYPE walwatch_keeper_renewals_attempted counter',
        `walwatch_keeper_renewals_attempted ${summary.renewalsAttempted}`,
        '',
        '# HELP walwatch_keeper_renewals_succeeded Total renewals succeeded',
        '# TYPE walwatch_keeper_renewals_succeeded counter',
        `walwatch_keeper_renewals_succeeded ${summary.renewalsSucceeded}`,
        '',
        '# HELP walwatch_keeper_renewals_failed Total renewals failed',
        '# TYPE walwatch_keeper_renewals_failed counter',
        `walwatch_keeper_renewals_failed ${summary.renewalsFailed}`,
        '',
        '# HELP walwatch_keeper_db_connection_pool_size Current DB connection pool size',
        '# TYPE walwatch_keeper_db_connection_pool_size gauge',
        `walwatch_keeper_db_connection_pool_size ${summary.dbConnectionPoolSize}`,
        '',
        '# HELP walwatch_keeper_estimate_accuracy_ratio Running average of estimate-to-actual cost ratio (1.0 = perfect)',
        '# TYPE walwatch_keeper_estimate_accuracy_ratio gauge',
        `walwatch_keeper_estimate_accuracy_ratio ${summary.avgEstimateAccuracy}`,
        '',
        '# HELP walwatch_keeper_estimate_accuracy_samples Number of estimate accuracy samples recorded',
        '# TYPE walwatch_keeper_estimate_accuracy_samples gauge',
        `walwatch_keeper_estimate_accuracy_samples ${summary.estimateAccuracyRatios.length}`,
        '',
        '# HELP walwatch_keeper_notifications_total Notifications sent by type',
        '# TYPE walwatch_keeper_notifications_total counter',
        ...Object.entries(summary.notificationsByType).map(
          ([type, count]) => `walwatch_keeper_notifications_total{type="${type}"} ${count}`,
        ),
        '',
        '# HELP walwatch_jobs_total Total jobs tracked',
        `walwatch_jobs_total ${stats.total}`,
        '',
        '# HELP walwatch_jobs_succeeded Total successful jobs',
        `walwatch_jobs_succeeded ${stats.success}`,
        '',
        '# HELP walwatch_jobs_failed Total failed jobs',
        `walwatch_jobs_failed ${stats.failed}`,
        '',
        '# HELP walwatch_jobs_running Currently running jobs',
        `walwatch_jobs_running ${stats.running}`,
        '',
        '# HELP walwatch_jobs_avg_duration_ms Average job duration',
        `walwatch_jobs_avg_duration_ms ${Math.round(stats.avgDurationMs)}`,
        '',
        // Per-job-type metrics for observability (Spec 16)
        ...(() => {
          const typeStats = jobMonitor.getStatsByType();
          const lines: string[] = [];
          for (const [type, s] of Object.entries(typeStats)) {
            lines.push(`# HELP walwatch_jobs_by_type_total Job count by type and status`,
              `# TYPE walwatch_jobs_by_type_total counter`,
              `walwatch_jobs_by_type_total{type="${type}",status="success"} ${s.success}`,
              `walwatch_jobs_by_type_total{type="${type}",status="failed"} ${s.failed}`,
              `walwatch_jobs_by_type_total{type="${type}",status="running"} ${s.running}`,
              `walwatch_jobs_by_type_total{type="${type}",status="total"} ${s.total}`,
              '');
          }
          return lines.flat();
        })(),
      ].join('\n');

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    logger.info({ port }, 'Metrics server listening');
  });

  return server;
}
