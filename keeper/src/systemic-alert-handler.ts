import { logger as rootLogger } from './logger.js';
import { getDb } from './db.js';

const logger = rootLogger.child({ component: 'systemic-alert-handler' });

interface SystemicAlertConfig {
  rateLimitWindowMs: number;
  maxAlertsPerWindow: number;
}

const DEFAULT_CONFIG: SystemicAlertConfig = {
  rateLimitWindowMs: 300000,
  maxAlertsPerWindow: 3,
};

const alertCounts = new Map<string, { count: number; windowStart: number }>();

export async function handleSystemicError(
  error: Error,
  context: { affectedOrgCount?: number; affectedTenantCount?: number; component: string; suggestedRemediation?: string; traceId?: string },
): Promise<void> {
  const rateLimitKey = `${context.component}:${error.name}`;
  const now = Date.now();
  const existing = alertCounts.get(rateLimitKey);

  if (existing && (now - existing.windowStart) < DEFAULT_CONFIG.rateLimitWindowMs) {
    existing.count++;
    if (existing.count > DEFAULT_CONFIG.maxAlertsPerWindow) {
      logger.warn({ rateLimitKey, count: existing.count }, 'Systemic alert rate-limited — skipping');
      return;
    }
  } else {
    alertCounts.set(rateLimitKey, { count: 1, windowStart: now });
  }

  const db = getDb();
  const eventType = error.name === 'SystemicError' || context.component === 'system' ? 'system.degraded' : 'system.error';

  await db`
    INSERT INTO alert_events (org_id, event_type, severity, message, details, status, fired_at)
    VALUES (${'system'}, ${eventType}, ${'error'}, ${context.component + ': ' + error.message}, ${db.json({
      component: context.component,
      affectedOrgCount: context.affectedOrgCount,
      affectedTenantCount: context.affectedTenantCount,
      suggestedRemediation: context.suggestedRemediation || 'Investigate logs',
      stack: error.stack?.substring(0, 1000),
      traceId: context.traceId,
    })}, 'fired', NOW())
  `;

  await db`
    INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details)
    VALUES (${'system'}, NULL, ${eventType}, 'systemic_error', NULL, ${db.json({
      component: context.component,
      message: error.message,
      traceId: context.traceId,
    })})
  `;

  await db`
    INSERT INTO activity_feed (org_id, actor_type, actor_id, action, resource_type, resource_id, summary, details, trace_id)
    VALUES (${'system'}, 'system', 'systemic-alert-handler', ${eventType}, 'system', NULL, ${context.component + ': ' + error.message}, ${db.json({ component: context.component, suggestedRemediation: context.suggestedRemediation })}, ${context.traceId || null})
  `;

  logger.error({ component: context.component, message: error.message, traceId: context.traceId }, 'Systemic error alerted');
}
