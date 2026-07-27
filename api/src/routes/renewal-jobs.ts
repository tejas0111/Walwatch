import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { renewalJobs, policies } from '../db/schema.js';
import { eq, and, sql, type SQL } from 'drizzle-orm';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { validateTransition, validNextStates, isTerminal } from '../lib/state-machine.js';
import { emitRenewalEvent } from '../lib/event-bus.js';
import { costEngine } from '../lib/cost-engine.js';
import { snapshotPolicyOnStart, freezeBudgetCheck } from '../lib/edge-cases.js';
import { invariantChecker } from '../lib/invariant-check.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const status = c.req.query('status');
    const includeDeleted = c.req.query('include_deleted') === 'true';

    // Cursor-based pagination (Spec 14) + filtering by status
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const conditions: SQL[] = [eq(renewalJobs.orgId, orgId)];
    if (status) conditions.push(eq(renewalJobs.status, status));
    if (!includeDeleted) conditions.push(sql`${renewalJobs.deletedAt} IS NULL`);

    const cursorWhere = buildCursorWhere(decodedCursor, renewalJobs.createdAt, renewalJobs.id, 'desc');
    if (cursorWhere) conditions.push(cursorWhere);

    const orderBy = buildCursorOrderBy(renewalJobs.createdAt, renewalJobs.id, 'desc');

    const list = await db.select().from(renewalJobs)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(fetchLimit);

    const paginated = wrapPaginatedResponse(list, limit, (j) => j.id, (j) => j.createdAt.toISOString());

    return c.json({
      renewalJobs: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/:id', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Renewal job ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [job] = await db.select().from(renewalJobs)
      .where(and(eq(renewalJobs.id, id!), eq(renewalJobs.orgId, orgId)))
      .limit(1);
    if (!job) return c.json({ error: { message: 'Renewal job not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(job);
  } catch (error) {
    throw error;
  }
});

const createRenewalJobSchema = z.object({
  blobRegistrationId: z.string().uuid(),
  walletId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  policyId: z.string().uuid().optional(),
  extensionEpochs: z.number().int().positive().optional().default(1),
  maxAttempts: z.number().int().positive().optional().default(5),
});

/**
 * POST / — create a renewal job with cost estimation and budget checking.
 */
router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createRenewalJobSchema), async (c) => {
  const orgId = c.get('orgId');
  invariantChecker.verifyOrgChain({ orgId });
  const userId = c.get('userId');
  const body = c.req.valid('json');

  await invariantChecker.ensureNoActiveRenewal(body.blobRegistrationId);

  const estimate = await costEngine.estimateRenewalCost(body.blobRegistrationId, body.extensionEpochs ?? 1);

  const budgetCheck = await costEngine.checkBudgetBeforeExecution(
    orgId,     body.projectId || null, body.walletId ?? '', body.policyId || null, estimate.estimatedCost,
  );

  let resolvedPolicy = null;
  if (body.policyId) {
    const db = getDb();
    const [policy] = await db.select().from(policies).where(eq(policies.id, body.policyId)).limit(1);
    resolvedPolicy = policy;
  }
  const policySnapshot = resolvedPolicy ? snapshotPolicyOnStart(resolvedPolicy) : undefined;
  const budgetSnapshot = freezeBudgetCheck(budgetCheck, new Date());
  const metadata: Record<string, unknown> = {};
  if (policySnapshot) metadata.policySnapshot = policySnapshot;
  metadata.budgetSnapshot = budgetSnapshot;
  metadata.estimateConfidence = estimate.confidence;

  const db = getDb();
  const [job] = await db.insert(renewalJobs).values({
    orgId,
    blobRegistrationId: body.blobRegistrationId,
    policyId: body.policyId,
    status: budgetCheck.allowed ? 'estimated' : 'blocked_by_budget',
    estimatedCost: Number(estimate.estimatedCost),
    attempt: 0,
    maxAttempts: body.maxAttempts ?? 5,
    estimatedAt: new Date(),
    blockedByLimitId: budgetCheck.blockingLimitId,
    metadata,
  }).returning();

  await logAudit(c, 'renewal_job.created', 'renewal_job', job.id, { estimatedCost: estimate.estimatedCost, budgetCheck });

  if (!budgetCheck.allowed) {
    return c.json({ error: { message: budgetCheck.message, code: 'BLOCKED_BY_BUDGET' } }, 422);
  }

  return c.json(job, 201);
});

/**
 * Retry a renewal job — manual override.
 * Spec 25: manual override creates a NEW Renewal record with supersedes link.
 * Only allowed from terminal states (failed_final, blocked_by_budget).
 * For non-terminal states, the job must progress through its normal state machine.
 */
router.post('/:id/retry', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Renewal job ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [job] = await db.select().from(renewalJobs)
      .where(and(eq(renewalJobs.id, id!), eq(renewalJobs.orgId, orgId)))
      .limit(1);
    if (!job) return c.json({ error: { message: 'Renewal job not found', code: ErrorCodes.NOT_FOUND } }, 404);

    // Spec 25: only terminal states (failed_final, blocked_by_budget) support manual override
    if (!isTerminal('renewal', job.status as any)) {
      return c.json({
        error: {
          message: `Cannot retry a job in state '${job.status}' — manual override only applies to terminal states (failed_final, blocked_by_budget). Let the job progress through its normal flow.`,
          code: ErrorCodes.VALIDATION_ERROR,
        },
      }, 400);
    }

    if (job.status === 'succeeded') {
      return c.json({ error: { message: 'Cannot retry a succeeded job', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    }

    await invariantChecker.ensureNoActiveRenewal(job.blobRegistrationId);

    // Check estimate freshness before retry (Spec 11: stale estimates must be recomputed)
    let recomputed = false;
    if (job.estimatedAt && !costEngine.isEstimateFresh(job.estimatedAt)) {
      const freshEstimate = await costEngine.estimateRenewalCost(job.blobRegistrationId, 1);
      job.estimatedCost = Number(freshEstimate.estimatedCost);
      job.estimatedAt = new Date();
      recomputed = true;
    }

    const estimateConfidence: 'fresh' | 'recomputed' = recomputed ? 'recomputed' : 'fresh';

    let policySnapshot: Record<string, unknown> | undefined;
    if (job.policyId) {
      const [policyRecord] = await db.select().from(policies).where(eq(policies.id, job.policyId)).limit(1);
      if (policyRecord) policySnapshot = snapshotPolicyOnStart(policyRecord);
    }

    // Manual override: create a NEW renewal job that supersedes this one (spec 25)
    const [newJob] = await db.insert(renewalJobs).values({
      orgId: job.orgId,
      blobRegistrationId: job.blobRegistrationId,
      policyId: job.policyId,
      status: 'estimated',
      attempt: 0,
      maxAttempts: job.maxAttempts,
      supersedes: job.id,
      estimatedCost: job.estimatedCost || undefined,
      estimatedAt: new Date(),
      blockedByLimitId: null, // Clear the block on the new job
      metadata: {
        ...(policySnapshot ? { policySnapshot } : {}),
        estimateConfidence,
      },
    }).returning();

    await logAudit(c, 'renewal_job.manual_override', 'renewal_job', newJob.id, {
      supersedes: job.id,
      previousStatus: job.status,
      blockedByLimitId: job.blockedByLimitId || undefined,
    });

    emitRenewalEvent('manual_override', orgId, newJob.id, { type: 'human', userId }, {
      supersedes: job.id,
      previousStatus: job.status,
      blockedByLimitId: job.blockedByLimitId || undefined,
    });

    return c.json({ message: 'Manual override created — new renewal job', job: newJob }, 201);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

/**
 * Cancel a renewal job (only pending state can be cancelled).
 * Spec 25: pending→blocked_by_budget is the only human-triggerable cancel transition.
 * Jobs in estimated, in_progress, or retrying must progress naturally through their state machine.
 * Manual override for terminal states is handled by the retry endpoint.
 */
router.post('/:id/cancel', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Renewal job ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [job] = await db.select().from(renewalJobs)
      .where(and(eq(renewalJobs.id, id!), eq(renewalJobs.orgId, orgId)))
      .limit(1);
    if (!job) return c.json({ error: { message: 'Renewal job not found', code: ErrorCodes.NOT_FOUND } }, 404);

    // Spec 25: only pending→blocked_by_budget allowed for cancellation
    validateTransition('renewal', job.status as any, 'blocked_by_budget' as any);

    await db.update(renewalJobs).set({ status: 'blocked_by_budget', updatedAt: new Date() })
      .where(eq(renewalJobs.id, id!));
    await logAudit(c, 'renewal_job.cancelled', 'renewal_job', id);
    emitRenewalEvent('blocked_by_budget', orgId, id, { type: 'human', userId });
    return c.json({ message: 'Renewal job cancelled' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

/**
 * Override spending limit — create a new renewal job that bypasses spending limits.
 * Records audit log with justification and emits renewal_job.override_created event.
 */
router.post('/:id/override', requireOrg, requireRole('owner', 'admin'), zValidator('json', z.object({
  reason: z.string().min(1).max(500),
})), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Renewal job ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const { reason } = c.req.valid('json');
    const db = getDb();
    const [job] = await db.select().from(renewalJobs)
      .where(and(eq(renewalJobs.id, id!), eq(renewalJobs.orgId, orgId)))
      .limit(1);
    if (!job) return c.json({ error: { message: 'Renewal job not found', code: ErrorCodes.NOT_FOUND } }, 404);

    // Recompute estimate
    const freshEstimate = await costEngine.estimateRenewalCost(job.blobRegistrationId, 1);

    // Create superseding renewal job with spending limit overridden
    const [newJob] = await db.insert(renewalJobs).values({
      orgId: job.orgId,
      blobRegistrationId: job.blobRegistrationId,
      policyId: job.policyId,
      status: 'estimated',
      attempt: 0,
      maxAttempts: job.maxAttempts,
      supersedes: job.id,
      estimatedCost: Number(freshEstimate.estimatedCost),
      estimatedAt: new Date(),
      blockedByLimitId: null,
      spendingLimitOverridden: true,
      metadata: {
        estimateConfidence: freshEstimate.confidence,
        overrideReason: reason,
      },
    }).returning();

    await logAudit(c, 'renewal_job.override_created', 'renewal_job', newJob.id, {
      supersedes: job.id,
      previousStatus: job.status,
      reason,
    });

    emitRenewalEvent('override_created', orgId, newJob.id, { type: 'human', userId }, {
      supersedes: job.id,
      previousStatus: job.status,
      reason,
    });

    return c.json({ message: 'Spending limit override created — new renewal job', job: newJob }, 201);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

// ── Helper: get available transitions ──────────────────────────
router.get('/:id/transitions', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = getDb();

  const [job] = await db.select().from(renewalJobs)
    .where(and(eq(renewalJobs.id, id!), eq(renewalJobs.orgId, orgId)))
    .limit(1);
  if (!job) return c.json({ error: { message: 'Renewal job not found', code: 'NOT_FOUND' } }, 404);

  const nextStates = validNextStates('renewal', job.status as any);
  return c.json({
    currentState: job.status,
    isTerminal: isTerminal('renewal', job.status as any),
    availableTransitions: nextStates,
  });
});

export { router as renewalJobRoutes };
