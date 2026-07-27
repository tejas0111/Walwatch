import { getDb } from './db.js';
import { logger as rootLogger } from './logger.js';

const logger = rootLogger.child({ component: 'cleanup' });

const GRACE_PERIOD_DAYS = 30;

const CLEANUP_TABLES = [
  'blob_registrations',
  'wallets',
  'policies',
  'alert_rules',
  'notification_channels',
  'api_keys',
  'projects',
  'organizations',
] as const;

export async function runCleanup(): Promise<{ table: string; removed: number }[]> {
  const db = getDb();
  const results: { table: string; removed: number }[] = [];
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  for (const table of CLEANUP_TABLES) {
    try {
      const result = await db`
        DELETE FROM ${db(table)}
        WHERE deleted_at IS NOT NULL
          AND deleted_at < ${cutoff}
      `;
      const count = result.count || 0;
      results.push({ table, removed: count });
      if (count > 0) {
        logger.info({ table, count }, `Cleaned up ${count} soft-deleted records from ${table}`);
      }
    } catch (err) {
      logger.error({ table, err }, `Cleanup failed for ${table}`);
    }
  }

  return results;
}
