import postgres from 'postgres';
import { withRetry } from './retry.js';
import { logger as rootLogger } from './logger.js';
import type { MetricsCollector } from './metrics.js';

const logger = rootLogger.child({ component: 'db' });

let sql: postgres.Sql | null = null;
let metricsRef: MetricsCollector | undefined;

export function setMetricsCollector(m: MetricsCollector): void {
  metricsRef = m;
}

export function getDb(url?: string): postgres.Sql {
  if (!sql) {
    const connectionUrl = url || process.env.DATABASE_URL;
    if (!connectionUrl) {
      throw new Error(
        'DATABASE_URL is required. Set the DATABASE_URL environment variable or pass a URL to getDb().',
      );
    }
    sql = postgres(connectionUrl, {
      max: parseInt(process.env.DB_POOL_MAX || '10'),
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    try {
      await withRetry(
        async () => {
          await sql!.end();
        },
        {
          operationName: 'db.close',
          maxRetries: 2,
          onRetry: () => metricsRef?.recordRetryAttempt(),
        },
      );
      logger.info('Database connection closed');
    } catch (error) {
      logger.error({ error }, 'Failed to close database connection');
    }
    sql = null;
  }
}

export async function healthCheckDb(): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
