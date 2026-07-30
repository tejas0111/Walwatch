/**
 * Admin Actions (spec 29)
 *
 * Shared functions for admin operations that need the same state-machine validation,
 * audit logging, and event emission as the public API — preventing admin-only
 * bypass of business rules.
 *
 * Every function accepts an operator identity and justification for audit trail.
 */

import { getDb } from '../db/index.js';
import { renewalJobs, policies } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AppError, ErrorCodes } from './errors.js';
import { snapshotPolicyOnStart, freezeBudgetCheck } from './edge-cases.js';
import { invariantChecker } from './invariant-check.js';
import { costEngine } from './cost-engine.js';
import { logAuditSystem } from '../middleware/audit.js';
import { createEvent, EventNames, emit } from './event-bus.js';
import pino from 'pino';

const logger = pino({ name: 'admin-actions' });

export interface AdminOperator {
  adminId: string;
  justification: string;
  ticketId?: string;
}

/**
 * Retry a renewal job on behalf of an operator.
 *
 * Mirrors the public POST /renewal-jobs/:id/retry logic (spec 25), but with
 * admin attribution and justification recorded in the audit trail.
 *
 * @param jobId - ID of the renewal job to retry
 * @param operator - Admin identity and justification
 * @returns The newly created renewal job
 * @throws {AppError} If the job doesn't exist or can't be retried
 */
export async function adminRetryRenewalJob(
  jobId: string,
  operator: AdminOperator,
): Promise<typeof renewalJobs.$inferSelect> {
  const db = getDb();

  const [job] = await db.select().from(renewalJobs)
    .where(eq(renewalJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new AppError('Renewal job not found', 404, ErrorCodes.NOT_FOUND);
  }

  // State machine validation — same as public API (spec 25: only terminal states qualify)
  if (job.status === 'succeeded') {
    throw new AppError('Cannot retry a succeeded job', 400, ErrorCodes.VALIDATION_ERROR);
  }

  if (job.status !== 'failed_final' && job.status !== 'blocked_by_budget') {
    throw new AppError(
      `Cannot retry a job in status "${job.status}"`,
      400, ErrorCodes.STATE_TRANSITION_ERROR,
    );
  }

  await invariantChecker.ensureNoActiveRenewal(job.blobRegistrationId);

  // Check estimate freshness before retry (Spec 11)
  if (job.estimatedAt && !costEngine.isEstimateFresh(job.estimatedAt)) {
    const freshEstimate = await costEngine.estimateRenewalCost(job.blobRegistrationId, 1);
    job.estimatedCost = Number(freshEstimate.estimatedCost);
    job.estimatedAt = new Date();
  }

  let policySnapshot: Record<string, unknown> | undefined;
  if (job.policyId) {
    const [policyRecord] = await db.select().from(policies)
      .where(eq(policies.id, job.policyId)).limit(1);
    if (policyRecord) policySnapshot = snapshotPolicyOnStart(policyRecord);
  }

  const budgetCheck = await costEngine.checkBudgetBeforeExecution(
    job.orgId, null, '', job.policyId ?? '', job.estimatedCost ?? 0,
  );
  const budgetSnapshot = freezeBudgetCheck(budgetCheck, new Date());

  const metadata: Record<string, unknown> = {};
  if (policySnapshot) metadata.policySnapshot = policySnapshot;
  metadata.budgetSnapshot = budgetSnapshot;

  // Manual override: create a NEW renewal job that supersedes this one
  const [newJob] = await db.insert(renewalJobs).values({
    orgId: job.orgId,
    blobRegistrationId: job.blobRegistrationId,
    policyId: job.policyId,
    status: budgetCheck.allowed ? 'estimated' : 'blocked_by_budget',
    attempt: 0,
    maxAttempts: job.maxAttempts,
    supersedes: job.id,
    estimatedCost: job.estimatedCost || undefined,
    estimatedAt: new Date(),
    blockedByLimitId: budgetCheck.blockingLimitId,
    metadata,
  }).returning();

  // Audit trail with operator attribution (spec 29)
  await logAuditSystem(
    job.orgId,
    'renewal_job.admin_retry',
    'renewal_job',
    newJob.id,
    {
      supersedes: job.id,
      previousStatus: job.status,
      blockedByLimitId: job.blockedByLimitId || undefined,
      adminId: operator.adminId,
      justification: operator.justification,
      ticketId: operator.ticketId,
    },
  );

  // Event emission with admin actor
  const adminActor = { type: 'admin' as const, adminId: operator.adminId, reason: operator.justification };
  const event = createEvent(
    EventNames.RENEWAL_MANUAL_OVERRIDE,
    job.orgId,
    'renewal_job',
    newJob.id,
    adminActor,
    { supersedes: job.id, previousStatus: job.status, triggeredBy: 'admin' },
  );
  await emit(event);

  // Emit manual override event if the job was blocked by a limit (Spec 26: renewal.manual_override)
  if (job.blockedByLimitId) {
    const overrideEvent = createEvent(
      EventNames.RENEWAL_MANUAL_OVERRIDE,
      job.orgId,
      'renewal_job',
      newJob.id,
      adminActor,
      { supersededJobId: job.id, originalLimitId: job.blockedByLimitId, triggeredBy: 'admin' },
    );
    await emit(overrideEvent).catch((err) => {
      logger.error({ err }, 'Failed to emit override event');
    });
  }

  return newJob;
}
