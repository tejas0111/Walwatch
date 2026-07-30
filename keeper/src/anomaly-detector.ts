import { logger as rootLogger } from './logger.js';
import { getDb } from './db.js';

const logger = rootLogger.child({ component: 'anomaly-detector' });

interface AnomalyThresholds {
  maxManualRenewalsPerMinute: number;
  maxBudgetOverridesPerHour: number;
  maxApiKeyCreationsPer5Min: number;
  maxFailedRenewalsPerHour: number;
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  maxManualRenewalsPerMinute: 10,
  maxBudgetOverridesPerHour: 3,
  maxApiKeyCreationsPer5Min: 5,
  maxFailedRenewalsPerHour: 20,
};

async function createAlertEvent(
  db: ReturnType<typeof getDb>,
  orgId: string,
  eventType: string,
  severity: 'info' | 'warning' | 'error' | 'critical',
  message: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const detailsWithCause = {
      ...details,
      triggeredBy: { cause: 'system:anomaly-detector' },
    };
    await db`
      INSERT INTO alert_events (org_id, event_type, severity, message, details, status, fired_at)
      VALUES (${orgId}, ${eventType}, ${severity}, ${message}, ${db.json(detailsWithCause)}, 'fired', NOW())
    `;
    await db`
      INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details)
      VALUES (${orgId}, NULL, ${eventType}, 'anomaly_detection', NULL, ${db.json(detailsWithCause)})
    `;
    await db`
      INSERT INTO activity_feed (org_id, action, resource_type, resource_id, actor_type, actor_id, summary, details)
      VALUES (
        ${orgId},
        ${eventType},
        'anomaly_detection',
        NULL,
        'system',
        NULL,
        ${`Anomaly detected: ${eventType} — ${message}`},
        ${db.json(detailsWithCause)}
      )
    `;
  } catch (err) {
    logger.warn({ orgId, eventType, error: err instanceof Error ? err.message : String(err) }, 'Failed to create anomaly alert event');
  }
}

async function checkExcessiveManualRenewals(db: ReturnType<typeof getDb>, orgId: string, threshold: number, windowSeconds: number): Promise<void> {
  const [{ cnt }] = await db`SELECT COUNT(*)::int AS cnt FROM renewal_jobs WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '1 second' * ${windowSeconds}`;
  if (cnt > threshold) {
    await createAlertEvent(db, orgId, 'anomaly.excessive_manual_renewals', 'warning', `Manual renewals: ${cnt} in ${windowSeconds}s (threshold: ${threshold})`, { actual: cnt, threshold, windowSeconds });
  }
}

async function checkExcessiveFailedRenewals(db: ReturnType<typeof getDb>, orgId: string, threshold: number, windowSeconds: number): Promise<void> {
  const [{ cnt }] = await db`SELECT COUNT(*)::int AS cnt FROM renewal_jobs WHERE org_id = ${orgId} AND status = 'failed_final' AND created_at > NOW() - INTERVAL '1 second' * ${windowSeconds}`;
  if (cnt > threshold) {
    await createAlertEvent(db, orgId, 'anomaly.excessive_failed_renewals', 'warning', `Failed renewals: ${cnt} in ${windowSeconds}s (threshold: ${threshold})`, { actual: cnt, threshold, windowSeconds });
  }
}

async function checkExcessiveApiKeyCreations(db: ReturnType<typeof getDb>, orgId: string, threshold: number, windowSeconds: number): Promise<void> {
  const [{ cnt }] = await db`SELECT COUNT(*)::int AS cnt FROM api_keys WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '1 second' * ${windowSeconds}`;
  if (cnt > threshold) {
    await createAlertEvent(db, orgId, 'anomaly.excessive_api_key_creations', 'warning', `API key creations: ${cnt} in ${windowSeconds}s (threshold: ${threshold})`, { actual: cnt, threshold, windowSeconds });
  }
}

export async function runAnomalyDetection(): Promise<void> {
  const db = getDb();
  const thresholds = { ...DEFAULT_THRESHOLDS };

  const activeOrgs = await db`
    SELECT DISTINCT org_id FROM renewal_jobs WHERE created_at > NOW() - INTERVAL '1 hour'
  `;

  const orgs = activeOrgs.length > 0
    ? (activeOrgs as any[]).map(r => r.org_id)
    : ['system'];

  for (const orgId of orgs) {
    await checkExcessiveManualRenewals(db, orgId, thresholds.maxManualRenewalsPerMinute, 60);
    await checkExcessiveFailedRenewals(db, orgId, thresholds.maxFailedRenewalsPerHour, 3600);
    await checkExcessiveApiKeyCreations(db, orgId, thresholds.maxApiKeyCreationsPer5Min, 300);
  }

  logger.info({ orgsChecked: orgs.length }, 'Anomaly detection cycle complete');
}
