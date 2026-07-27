import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';
import { renewalJobs, alertEvents, schedules, organizations, blobRegistrations, notificationChannels, webhooks } from '../db/schema.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { createPoolFromEnv } from '../lib/sui-pool.js';
import { withRetry } from '../lib/retry.js';
import { adminRetryRenewalJob, type AdminOperator } from '../lib/admin-actions.js';
import { logAuditSystem } from '../middleware/audit.js';
import { AppError } from '../lib/errors.js';
import { reEncrypt } from '../lib/encryption.js';

/**
 * Extract admin operator identity from the request context.
 * Uses the X-Admin-Key header prefix as the operator identifier for attribution (spec 29).
 */
function getAdminOperator(c: { req: { header: (name: string) => string | undefined } }): AdminOperator {
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  // Use the first 8 chars of the key as an identifier (never log full keys)
  const adminId = `admin:${adminKey.substring(0, 8)}`;
  // The justification comes from the request body for mutating actions
  return { adminId, justification: 'admin action' };
}

const adminRoutes = new Hono();

adminRoutes.use('*', requireAdmin);

adminRoutes.get('/health', async (c) => {
  const checks: Record<string, string> = {};
  const [queueDepth, alertCount, scheduleCount] = await Promise.all([
    getDb().select({ count: sql<number>`count(*)` }).from(renewalJobs)
      .where(eq(renewalJobs.status, 'queued')),
    getDb().select({ count: sql<number>`count(*)` }).from(alertEvents)
      .where(sql`status IN ('fired', 'delivery_failed')`),
    getDb().select({ count: sql<number>`count(*)` }).from(schedules)
      .where(sql`enabled = true`),
  ]);

  // Sui RPC check
  try {
    const pool = createPoolFromEnv({ threshold: 2, timeout: 10_000 });
    await pool.call(async (client) => {
      await withRetry(async () => {
        await client.getLatestCheckpointSequenceNumber();
      }, { maxRetries: 2, label: 'health-sui-rpc', baseDelay: 500 });
    });
    checks.suiRpc = 'connected';
    checks.suiEndpoints = pool.urls.join(', ');
  } catch {
    checks.suiRpc = 'error';
  }

  return c.json({
    status: 'ok',
    queueDepth: Number(queueDepth[0]?.count ?? 0),
    pendingAlerts: Number(alertCount[0]?.count ?? 0),
    activeSchedules: Number(scheduleCount[0]?.count ?? 0),
    ...checks,
    timestamp: new Date().toISOString(),
  });
});

adminRoutes.post('/trigger-scan', async (c) => {
  const { justification, orgId, ticketId } = await c.req.json();
  const operator = getAdminOperator(c);
  const adminActor = { type: 'admin' as const, adminId: operator.adminId, reason: justification || operator.justification };
  // JOB_COMPLETED is reused for scan triggers since it signals the system to check for pending work
  const event = createEvent(
    EventNames.JOB_COMPLETED, orgId || 'system', 'admin', 'trigger-scan',
    adminActor,
    { justification, ticketId, triggeredBy: 'admin' },
  );
  await emit(event);

  // Audit log the trigger-scan action (spec 29: every admin action is an Audit Event)
  await logAuditSystem(
    orgId || 'system',
    'admin.trigger_scan',
    'admin',
    undefined,
    { adminId: operator.adminId, justification: justification || operator.justification, ticketId },
  );

  return c.json({ status: 'accepted', message: 'Scan triggered' });
});

adminRoutes.get('/queues', async (c) => {
  const jobs = await getDb().select({
    status: renewalJobs.status,
    count: sql<number>`count(*)`,
  }).from(renewalJobs)
    .groupBy(renewalJobs.status);
  return c.json({ queues: jobs });
});

adminRoutes.get('/metrics', async (c) => {
  const [totalJobs, failedJobs, totalOrgs, activeOrgs, totalBlobs] = await Promise.all([
    getDb().select({ count: sql<number>`count(*)` }).from(renewalJobs),
    getDb().select({ count: sql<number>`count(*)` }).from(renewalJobs)
      .where(eq(renewalJobs.status, 'failed_final')),
    getDb().select({ count: sql<number>`count(*)` }).from(organizations),
    getDb().select({ count: sql<number>`count(*)` }).from(organizations)
      .where(eq(organizations.status, 'active')),
    getDb().select({ count: sql<number>`count(*)` }).from(blobRegistrations),
  ]);
  return c.json({
    totalJobs: Number(totalJobs[0]?.count ?? 0),
    failedJobs: Number(failedJobs[0]?.count ?? 0),
    totalOrgs: Number(totalOrgs[0]?.count ?? 0),
    activeOrgs: Number(activeOrgs[0]?.count ?? 0),
    totalBlobs: Number(totalBlobs[0]?.count ?? 0),
    timestamp: new Date().toISOString(),
  });
});

adminRoutes.post('/retry-job/:id', async (c) => {
  const { id } = c.req.param();
  const { justification, ticketId } = await c.req.json().catch(() => ({ justification: undefined, ticketId: undefined }));
  if (!justification) {
    return c.json({ error: { message: 'Justification is required for admin actions', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  }
  const operator = getAdminOperator(c);
  operator.justification = justification;

  try {
    const newJob = await adminRetryRenewalJob(id, operator);
    await logAuditSystem(
      newJob.orgId,
      'admin.retry_job',
      'renewal_job',
      newJob.id,
      { adminId: operator.adminId, justification, ticketId, supersedes: id },
    );
    return c.json({ message: 'Job retry enqueued', job: newJob });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as any);
    }
    throw error;
  }
});

adminRoutes.get('/tenants/:orgId', async (c) => {
  const { orgId } = c.req.param();
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return c.json({ error: { message: 'Organization not found', code: 'NOT_FOUND' } }, 404);

  const [jobCount, blobCount, scheduleCount, alertCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(renewalJobs).where(eq(renewalJobs.orgId, orgId)),
    db.select({ count: sql<number>`count(*)` }).from(blobRegistrations).where(eq(blobRegistrations.orgId, orgId)),
    db.select({ count: sql<number>`count(*)` }).from(schedules).where(eq(schedules.orgId, orgId)),
    db.select({ count: sql<number>`count(*)` }).from(alertEvents).where(eq(alertEvents.orgId, orgId)),
  ]);

  return c.json({
    organization: org,
    stats: {
      totalJobs: Number(jobCount[0]?.count ?? 0),
      totalBlobs: Number(blobCount[0]?.count ?? 0),
      activeSchedules: Number(scheduleCount[0]?.count ?? 0),
      totalAlerts: Number(alertCount[0]?.count ?? 0),
    },
  });
});

adminRoutes.post('/encryption/rotate-key', async (c) => {
  const { justification, ticketId } = await c.req.json().catch(() => ({ justification: undefined, ticketId: undefined }));
  if (!justification) {
    return c.json({ error: { message: 'Justification is required for key rotation', code: 'VALIDATION_ERROR' } }, 400);
  }
  const operator = getAdminOperator(c);

  const db = getDb();
  let reEncryptedCount = 0;
  const failedFields: string[] = [];

  const channels = await db.select().from(notificationChannels);
  for (const channel of channels) {
    const config = channel.config as Record<string, unknown>;
    const newConfig: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        try {
          newConfig[key] = reEncrypt(value);
          changed = true;
        } catch (err) {
          console.error(`[key-rotation] Failed to re-encrypt field "${key}" on notification channel ${channel.id}:`, err);
          failedFields.push(`${channel.id}.${key}`);
          newConfig[key] = value;
        }
      } else {
        newConfig[key] = value;
      }
    }
    if (changed) {
      await db.update(notificationChannels)
        .set({ config: newConfig as any, keyVersion: sql`key_version + 1` })
        .where(eq(notificationChannels.id, channel.id));
      reEncryptedCount++;
    }
  }

  const whList = await db.select().from(webhooks);
  for (const wh of whList) {
    if (wh.secret) {
      try {
        const newSecret = reEncrypt(wh.secret);
        await db.update(webhooks)
          .set({ secret: newSecret, updatedAt: new Date() })
          .where(eq(webhooks.id, wh.id));
        reEncryptedCount++;
      } catch (err) {
        console.error(`[key-rotation] Failed to re-encrypt webhook secret for webhook ${wh.id}:`, err);
        failedFields.push(`${wh.id}.secret`);
      }
    }
  }

  await logAuditSystem(
    'system',
    'encryption.rotate_key',
    'encryption_key',
    undefined,
    { adminId: operator.adminId, justification, ticketId, reEncryptedCount, failedFields },
  );

  return c.json({ status: 'ok', reEncryptedCount, failedFields: failedFields.length > 0 ? failedFields : undefined });
});

export { adminRoutes };
