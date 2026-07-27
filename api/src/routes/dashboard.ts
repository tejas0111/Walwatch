import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { eq, and, sql, desc, asc, gte } from 'drizzle-orm';
import { blobRegistrations, renewalJobs, budgets, alertEvents, notifications } from '../db/schema.js';
import pino from 'pino';

const log = pino({ name: 'dashboard-routes' });
const router = new Hono();
router.use('*', requireAuth);

// ── Health-classification helpers ──────────────────────────────────
// Per spec 07 lifecycle: discovered → verified → tracked → protected →
//   expiring → renewing → renewed (back to tracked/protected)
//                       → expired → archived → deleted
//
// Dashboard breakdown per spec 13: healthy / at_risk / expiring / expired
const HEALTHY_STATUSES = ['discovered', 'verified', 'tracked', 'protected', 'renewed'];
const AT_RISK_STATUSES = ['expiring'];  // approaching expiry — needs attention
const EXPIRING_STATUSES = ['renewing'];  // renewal in progress — approaching deadline

/**
 * Safely execute a dashboard panel query. On failure, returns an error object
 * instead of throwing — this keeps one panel's failure from blanking the entire dashboard.
 */
async function panelQuery<T>(label: string, fn: () => Promise<T>): Promise<{ data: T | null; error: { message: string; code: string } | null }> {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err, panel: label }, `Dashboard panel "${label}" failed`);
    return { data: null, error: { message, code: 'PANEL_ERROR' } };
  }
}

// ── Empty-state guidance ───────────────────────────────────────────
// Each panel declares what the user should do when its data is empty.
const EMPTY_STATE_GUIDANCE: Record<string, { title: string; description: string; action: string; actionLink: string }> = {
  blobsByHealth: {
    title: 'No blobs tracked yet',
    description: 'Start by discovering or registering your first blob to begin tracking storage and renewals.',
    action: 'Add your first blob',
    actionLink: '/dashboard/blobs',
  },
  recentSpend: {
    title: 'No spending data yet',
    description: 'Spending data appears once renewal jobs start executing. No renewals have been processed yet.',
    action: 'View blobs',
    actionLink: '/dashboard/blobs',
  },
  budgetComparison: {
    title: 'No budgets configured',
    description: 'Set a budget to track spending and get notified when you approach your limit.',
    action: 'Create a budget',
    actionLink: '/dashboard/billing',
  },
  nextToExpire: {
    title: 'No expiring blobs',
    description: 'All tracked blobs have valid expiry dates with sufficient time remaining.',
    action: 'View all blobs',
    actionLink: '/dashboard/blobs',
  },
  needsAttention: {
    title: 'Everything looks good',
    description: 'No failed renewals, blocked spending, or undelivered notifications to address right now.',
    action: 'View all blobs',
    actionLink: '/dashboard/blobs',
  },
};

router.get('/summary', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const projectId = c.req.query('projectId');
  const db = getDb();
  const computedAt = new Date().toISOString();
  const computedAtMs = Date.now();

  const maxStalenessMs = parseInt(c.req.query('maxStalenessMs') || '', 10) || 30000;

  // ── 1. Blob counts by health + storage under management ────
  const [blobsPanel, storagePanel, budgetPanel, expiryPanel, attentionPanel] = await Promise.all([
    panelQuery('blobsByHealth', async () => {
      const conds = [eq(blobRegistrations.orgId, orgId)];
      if (projectId) conds.push(eq(blobRegistrations.projectId, projectId));

      const rows = await db
        .select({
          status: blobRegistrations.status,
          count: sql<number>`count(*)::int`,
          totalBytes: sql<number>`coalesce(sum(size_bytes), 0)`,
        })
        .from(blobRegistrations)
        .where(and(...conds, sql`${blobRegistrations.status} NOT IN ('archived', 'deleted')`))
        .groupBy(blobRegistrations.status);

      const byHealth = { healthy: 0, atRisk: 0, expiring: 0, expired: 0 };
      let totalBytes = 0;
      let totalBlobs = 0;

      for (const row of rows) {
        totalBlobs += row.count;
        totalBytes += Number(row.totalBytes);
        if (HEALTHY_STATUSES.includes(row.status)) {
          byHealth.healthy += row.count;
        } else if (AT_RISK_STATUSES.includes(row.status)) {
          byHealth.atRisk += row.count;
        } else if (EXPIRING_STATUSES.includes(row.status)) {
          byHealth.expiring += row.count;
        } else if (row.status === 'expired') {
          byHealth.expired += row.count;
        }
      }

      return {
        blobsByHealth: byHealth,
        storageUnderManagement: { totalBytes, totalBlobs },
      };
    }),

    // ── 2. Recent spend (last 30 days) ──────────────────────
    panelQuery('recentSpend', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const conds: ReturnType<typeof sql>[] = [
        eq(renewalJobs.orgId, orgId),
        gte(renewalJobs.createdAt, thirtyDaysAgo),
      ];
      if (projectId) {
        conds.push(
          sql`${renewalJobs.blobRegistrationId} IN (
            SELECT id FROM blob_registrations WHERE org_id = ${orgId} AND project_id = ${projectId}
          )`,
        );
      }

      const [spendRow] = await db
        .select({
          totalCost: sql<number>`coalesce(sum(estimated_cost), 0)`,
          renewalCount: sql<number>`count(*)::int`,
          succeededCount: sql<number>`coalesce(sum(case when ${renewalJobs.status} = 'succeeded' then 1 else 0 end), 0)::int`,
          failedCount: sql<number>`coalesce(sum(case when ${renewalJobs.status} = 'failed_final' then 1 else 0 end), 0)::int`,
          blockedCount: sql<number>`coalesce(sum(case when ${renewalJobs.status} = 'blocked_by_budget' then 1 else 0 end), 0)::int`,
        })
        .from(renewalJobs)
        .where(and(...conds));

      return {
        totalCost: Number(spendRow.totalCost),
        renewalCount: spendRow.renewalCount,
        succeededCount: spendRow.succeededCount,
        failedCount: spendRow.failedCount,
        blockedCount: spendRow.blockedCount,
        windowDays: 30,
        windowStart: thirtyDaysAgo.toISOString(),
      };
    }),

    // ── 3. Budget comparison ────────────────────────────────
    panelQuery('budgetComparison', async () => {
      const conds = [eq(budgets.orgId, orgId), eq(budgets.status, 'active')];
      if (projectId) conds.push(eq(budgets.projectId, projectId));

      const rows = await db
        .select({
          id: budgets.id,
          name: budgets.name,
          amount: budgets.amount,
          spent: budgets.spent,
          alertThreshold: budgets.alertThreshold,
          period: budgets.period,
        })
        .from(budgets)
        .where(and(...conds));

      return rows.map((b) => {
        const amount = Number(b.amount);
        const spent = Number(b.spent);
        const threshold = b.alertThreshold ?? 80;
        return {
          id: b.id,
          name: b.name,
          amount,
          spent,
          remaining: amount - spent,
          threshold,
          period: b.period,
          crossed: spent >= (amount * threshold) / 100,
        };
      });
    }),

    // ── 4. Next to expire ───────────────────────────────────
    panelQuery('nextToExpire', async () => {
      const conds: ReturnType<typeof sql>[] = [
        eq(blobRegistrations.orgId, orgId),
        sql`${blobRegistrations.expiryEpoch} IS NOT NULL`,
        sql`${blobRegistrations.status} NOT IN ('archived', 'deleted', 'expired')`,
      ];
      if (projectId) conds.push(eq(blobRegistrations.projectId, projectId));

      return await db
        .select({
          id: blobRegistrations.id,
          blobId: blobRegistrations.blobId,
          name: blobRegistrations.name,
          expiryEpoch: blobRegistrations.expiryEpoch,
          status: blobRegistrations.status,
        })
        .from(blobRegistrations)
        .where(and(...conds))
        .orderBy(asc(blobRegistrations.expiryEpoch))
        .limit(10);
    }),

    // ── 5. Needs attention — combine multiple sources ───────
    panelQuery('needsAttention', async () => {
      // Combine three sources of "needs attention" items:
      // a) Alert events with delivery failures or unacknowledged critical/warning events
      // b) Failed renewal jobs (status = 'failed_final')
      // c) Blocked-by-budget renewal jobs (status = 'blocked_by_budget')
      // d) Failed notification deliveries

      const [alertEventsList, failedRenewalJobs, blockedRenewalJobs, failedNotifications] = await Promise.all([
        // a) Unresolved alert events
        db
          .select({
            id: alertEvents.id,
            source: sql<string>`'alert_event'`,
            itemId: alertEvents.id,
            itemType: alertEvents.eventType,
            severity: alertEvents.severity,
            message: alertEvents.message,
            status: alertEvents.status,
            firedAt: alertEvents.firedAt,
          })
          .from(alertEvents)
          .where(and(
            eq(alertEvents.orgId, orgId),
            sql`${alertEvents.status} IN ('fired', 'delivery_failed', 'delivery_failed_final', 'escalated')`,
          ))
          .orderBy(desc(alertEvents.firedAt))
          .limit(10),

        // b) Failed renewal jobs (terminal failures)
        db
          .select({
            id: renewalJobs.id,
            source: sql<string>`'renewal_job'`,
            itemId: renewalJobs.id,
            itemType: sql<string>`'renewal_failed'`,
            severity: sql<string>`'error'`,
            message: sql<string>`${renewalJobs.lastError}`,
            status: renewalJobs.status,
            firedAt: renewalJobs.createdAt,
          })
          .from(renewalJobs)
          .where(and(
            eq(renewalJobs.orgId, orgId),
            eq(renewalJobs.status, 'failed_final'),
            sql`${renewalJobs.deletedAt} IS NULL`,
          ))
          .orderBy(desc(renewalJobs.createdAt))
          .limit(10),

        // c) Blocked-by-budget renewal jobs
        db
          .select({
            id: renewalJobs.id,
            source: sql<string>`'renewal_job'`,
            itemId: renewalJobs.id,
            itemType: sql<string>`'blocked_by_budget'`,
            severity: sql<string>`'warning'`,
            message: sql<string>`Renewal blocked by spending limit or budget`,
            status: renewalJobs.status,
            firedAt: renewalJobs.createdAt,
          })
          .from(renewalJobs)
          .where(and(
            eq(renewalJobs.orgId, orgId),
            eq(renewalJobs.status, 'blocked_by_budget'),
            sql`${renewalJobs.deletedAt} IS NULL`,
          ))
          .orderBy(desc(renewalJobs.createdAt))
          .limit(10),

        // d) Failed notification deliveries (where no alertEvent link exists)
        db
          .select({
            id: notifications.id,
            source: sql<string>`'notification'`,
            itemId: notifications.id,
            itemType: sql<string>`'notification_failed'`,
            severity: sql<string>`'warning'`,
            message: sql<string>`coalesce(${notifications.error}, 'Notification delivery failed')`,
            status: notifications.status,
            firedAt: notifications.createdAt,
          })
          .from(notifications)
          .where(and(
            eq(notifications.orgId, orgId),
            eq(notifications.status, 'failed'),
          ))
          .orderBy(desc(notifications.createdAt))
          .limit(10),
      ]);

      // Merge and sort by firedAt descending, limit to 25
      const merged = [...alertEventsList, ...failedRenewalJobs, ...blockedRenewalJobs, ...failedNotifications]
        .sort((a, b) => new Date(b.firedAt).getTime() - new Date(a.firedAt).getTime())
        .slice(0, 25);

      // Return with counts
      return {
        items: merged,
        summary: {
          total: merged.length,
          alertEvents: alertEventsList.length,
          failedRenewals: failedRenewalJobs.length,
          blockedRenewals: blockedRenewalJobs.length,
          failedNotifications: failedNotifications.length,
        },
      };
    }),
  ]);

  // ── Compute data freshness ─────────────────────────────────────
  const stalenessMs = Date.now() - computedAtMs;
  const isStale = stalenessMs > maxStalenessMs;

  // ── Build response with per-panel error isolation ───────────────
  const response: Record<string, unknown> = {
    scope: {
      orgId,
      projectId: projectId || null,
    },
    dataFreshness: {
      computedAt,
      stalenessMs,
      maxStalenessMs,
      stale: isStale,
    },
  };

  if (isStale) {
    c.header('Warning', '299 - "dashboard data is stale"');
  }

  // Panel 1: Blob health
  if (blobsPanel.data) {
    response.blobsByHealth = blobsPanel.data.blobsByHealth;
    response.storageUnderManagement = blobsPanel.data.storageUnderManagement;
  } else {
    response.blobsByHealth = null;
    response.storageUnderManagement = null;
    response._panelErrors = response._panelErrors || {};
    (response._panelErrors as Record<string, unknown>).blobsByHealth = blobsPanel.error;
  }

  // Panel 2: Recent spend
  if (storagePanel.data) {
    response.recentSpend = storagePanel.data;
  } else {
    response.recentSpend = null;
    response._panelErrors = response._panelErrors || {};
    (response._panelErrors as Record<string, unknown>).recentSpend = storagePanel.error;
  }

  // Panel 3: Budget comparison
  if (budgetPanel.data) {
    response.budgetComparison = budgetPanel.data;
  } else {
    response.budgetComparison = null;
    response._panelErrors = response._panelErrors || {};
    (response._panelErrors as Record<string, unknown>).budgetComparison = budgetPanel.error;
  }

  // Panel 4: Next to expire
  if (expiryPanel.data) {
    response.nextToExpire = expiryPanel.data;
  } else {
    response.nextToExpire = null;
    response._panelErrors = response._panelErrors || {};
    (response._panelErrors as Record<string, unknown>).nextToExpire = expiryPanel.error;
  }

  // Panel 5: Needs attention
  if (attentionPanel.data) {
    response.needsAttention = attentionPanel.data.items;
    response.attentionSummary = attentionPanel.data.summary;
  } else {
    response.needsAttention = null;
    response.attentionSummary = null;
    response._panelErrors = response._panelErrors || {};
    (response._panelErrors as Record<string, unknown>).needsAttention = attentionPanel.error;
  }

  // ── Empty-state guidance ─────────────────────────────────────────
  // Include guidance for empty panels — the frontend can use this to
  // show contextual empty states instead of blank panels.
  response.emptyStateGuidance = EMPTY_STATE_GUIDANCE;

  // Determine overall status based on whether any panels succeeded
  const allFailed = !blobsPanel.data && !storagePanel.data && !budgetPanel.data && !expiryPanel.data && !attentionPanel.data;
  response.status = allFailed ? 'error' : 'ok';

  return c.json(response);
});

export { router as dashboardRoutes };
