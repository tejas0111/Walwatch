import { getDb } from '../db/index.js';
import { eq, and, or, sql, gte, lte } from 'drizzle-orm';
import { budgets, spendingLimits, renewalJobs, blobRegistrations, publishers, costRecords, policyAssignments, auditLogs } from '../db/schema.js';
import { emit, EventNames, createEvent } from './event-bus.js';
import { AppError, ErrorCodes } from './errors.js';

import pino from 'pino';
const logger = pino({ name: 'cost-engine' });

/**
 * Default maximum staleness for cost estimates (5 minutes).
 * Override via MAX_ESTIMATE_STALENESS_MS env var.
 */
const DEFAULT_MAX_ESTIMATE_STALENESS_MS = 5 * 60 * 1000; // 5 minutes

interface CostEstimate {
  estimatedCost: number;
  estimatedAt: Date;
  stalenessMs: number;
  confidence: 'fresh' | 'stale' | 'recomputed';
  details: {
    blobSizeBytes: number;
    extensionEpochs: number;
    baseCost: number;
    publisherPremium: number;
  };
}

export interface BudgetCheckResult {
  allowed: boolean;
  softThresholdCrossed: boolean;
  hardLimitBlocked: boolean;
  blockingLimitId?: string;
  message?: string;
}

class CostEngine {
  async estimateRenewalCost(
    blobId: string,
    extensionEpochs: number,
    publisherEndpoint?: string,
  ): Promise<CostEstimate> {
    const db = getDb();
    const [blob] = await db.select().from(blobRegistrations)
      .where(eq(blobRegistrations.id, blobId))
      .limit(1);

    if (!blob) {
      throw new Error(`Blob registration not found: ${blobId}`);
    }

    const blobSizeBytes = blob.sizeBytes || 0;
    const baseCost = blobSizeBytes * extensionEpochs;
    const estimatedAt = new Date();
    const stalenessMs = 0;

    let publisherPremium = 0;
    if (publisherEndpoint) {
      const [publisher] = await db.select().from(publishers)
        .where(and(
          eq(publishers.orgId, blob.orgId),
          eq(publishers.endpoint, publisherEndpoint),
          eq(publishers.status, 'active'),
        ))
        .limit(1);
      if (publisher?.suiVaultId) {
        publisherPremium = Math.floor(baseCost * 0.1);
      }
    }

    const estimatedCost = baseCost + publisherPremium;

    const confidence = this.isEstimateFresh(estimatedAt) ? 'fresh' : 'stale';

    return {
      estimatedCost,
      estimatedAt,
      stalenessMs,
      confidence,
      details: {
        blobSizeBytes,
        extensionEpochs,
        baseCost,
        publisherPremium,
      },
    };
  }

  /**
   * Check if an estimate is too stale for use in budget decisions.
   * Spec 11: "Maximum estimate staleness must be enforced (configurable; system default applies if unset)"
   *
   * @param estimatedAt - The timestamp when the estimate was computed
   * @returns true if the estimate is still fresh enough to use
   */
  isEstimateFresh(estimatedAt: Date): boolean {
    const maxStalenessMs = parseInt(
      process.env.MAX_ESTIMATE_STALENESS_MS || String(DEFAULT_MAX_ESTIMATE_STALENESS_MS),
      10,
    );
    const age = Date.now() - estimatedAt.getTime();
    return age <= maxStalenessMs;
  }

  /**
   * Assert that an estimate is fresh enough to use. Throws if stale.
   */
  assertEstimateFresh(estimatedAt: Date): void {
    const maxStalenessMs = parseInt(
      process.env.MAX_ESTIMATE_STALENESS_MS || String(DEFAULT_MAX_ESTIMATE_STALENESS_MS),
      10,
    );
    const age = Date.now() - estimatedAt.getTime();
    if (age > maxStalenessMs) {
      throw new AppError(
        `Cost estimate is too stale (${age}ms old > max ${maxStalenessMs}ms). Re-estimate required.`,
        422,
        ErrorCodes.VALIDATION_ERROR,
      );
    }
  }

  async checkBudgetBeforeExecution(
    orgId: string,
    projectId: string | null,
    walletId: string | undefined,
    policyId: string | null,
    estimatedCost: number,
    spendingLimitOverridden?: boolean,
  ): Promise<BudgetCheckResult> {
    if (spendingLimitOverridden) {
      return { allowed: true, softThresholdCrossed: false, hardLimitBlocked: false };
    }

    const db = getDb();

    // Step 1: Check spending limits across all scopes (most specific wins — Wallet → Project → Org → Policy)
    const limits = await this.getEffectiveSpendingLimits(orgId, projectId, walletId, policyId);

    for (const limit of limits) {
      const currentSpent = await this.getSpendingLimitSpent(limit);
      const wouldExceed = (currentSpent + estimatedCost) > limit.amount;
      if (wouldExceed) {
        const event = createEvent(
          EventNames.SPENDING_LIMIT_BLOCKED,
          orgId,
          'spending_limit',
          limit.id,
          { type: 'system' },
          { estimatedCost, walletId, projectId, limitName: limit.name || 'Unnamed' },
        );
          emit(event).catch((e) => {
          logger.error('Failed to emit SPENDING_LIMIT_BLOCKED event:', e);
        });
        return {
          allowed: false,
          softThresholdCrossed: false,
          hardLimitBlocked: true,
          blockingLimitId: limit.id,
          message: `Would exceed ${limit.scope} spending limit '${limit.name || 'Unnamed'}'`,
        };
      }
    }

    // Step 3: Check budgets — these are SOFT ceilings (alert only, don't block)
    // Spec 11: "Budget — a soft ceiling... Crossing a threshold fires an Alert but does not by itself block"
    let softThresholdCrossed = false;

    if (projectId) {
      const projectBudgets = await db.select().from(budgets)
        .where(and(
          eq(budgets.orgId, orgId),
          eq(budgets.projectId, projectId),
          eq(budgets.status, 'active'),
        ));

      for (const budget of projectBudgets) {
        // Soft check: alert if exceeded but never block (Spec 11: budget is soft ceiling)
        if (budget.alertThreshold) {
          const spent = await this.getBudgetSpent(budget);
          const projectedPercent = ((spent + estimatedCost) / budget.amount) * 100;
          if (projectedPercent >= budget.alertThreshold) {
            softThresholdCrossed = true;
          }
        }
      }
    }

    const orgBudgets = await db.select().from(budgets)
      .where(and(
        eq(budgets.orgId, orgId),
        sql`${budgets.projectId} IS NULL`,
        eq(budgets.status, 'active'),
      ));

    for (const budget of orgBudgets) {
      // Soft check: alert if exceeded but never block
      if (budget.alertThreshold) {
        const spent = await this.getBudgetSpent(budget);
        const projectedPercent = ((spent + estimatedCost) / budget.amount) * 100;
        if (projectedPercent >= budget.alertThreshold) {
          softThresholdCrossed = true;
        }
      }
    }

    if (softThresholdCrossed) {
      const event = createEvent(
        EventNames.BUDGET_THRESHOLD_CROSSED,
        orgId,
        'budget',
        orgId,
        { type: 'system' },
        { estimatedCost, projectId, walletId },
      );
      emit(event).catch((e) => {
        logger.error('Failed to emit BUDGET_THRESHOLD_CROSSED event:', e);
      });

      // Also emit policy threshold breached event (Bug 6 fix)
      emit(createEvent(
        EventNames.POLICY_THRESHOLD_BREACHED,
        orgId,
        'budget',
        orgId,
        { type: 'system' },
        { estimatedCost, projectId, walletId },
      )).catch((e) => {
        logger.error('Failed to emit POLICY_THRESHOLD_BREACHED event:', e);
      });
    }

    return {
      allowed: true,
      softThresholdCrossed,
      hardLimitBlocked: false,
    };
  }

  async recordActualCost(
    renewalJobId: string,
    actualCost: number,
    txDigest: string,
    projectId: string | null,
  ): Promise<void> {
    const db = getDb();

    // Immutability check: actual cost must never be overwritten (Spec 11: "Historical cost records are immutable once written")
    const existing = await db.select({ actualCost: renewalJobs.actualCost })
      .from(renewalJobs).where(eq(renewalJobs.id, renewalJobId)).then(r => r[0]);
    if (existing?.actualCost !== null && existing?.actualCost !== undefined) {
      throw new AppError(
        `Actual cost already recorded for renewal job ${renewalJobId} (existing: ${existing.actualCost})`,
        409,
        ErrorCodes.CONFLICT,
      );
    }

    const [job] = await db.select().from(renewalJobs)
      .where(eq(renewalJobs.id, renewalJobId))
      .limit(1);

    if (!job) {
      throw new Error(`Renewal job not found: ${renewalJobId}`);
    }

    const now = new Date();

    // Record actual cost and write immutable cost record in a transaction (Spec 11)
    await db.transaction(async (tx) => {
      await tx.update(renewalJobs)
        .set({
          actualCost: String(actualCost),
          txDigest,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(renewalJobs.id, renewalJobId));

      await tx.insert(costRecords).values({
        blobRegistrationId: job.blobRegistrationId,
        renewalJobId: job.id,
        estimatedCost: job.estimatedCost?.toString(),
        actualCost: actualCost.toString(),
        orgId: job.orgId,
        projectId,
      });
    });

    // Spent is derived from cost_records at query time — no counter updates needed
  }

  private async getBudgetSpent(
    budget: Pick<typeof budgets.$inferSelect, 'orgId' | 'projectId' | 'windowStart' | 'windowEnd'>
  ): Promise<number> {
    const db = getDb();
    const conditions: any[] = [
      eq(costRecords.orgId, budget.orgId),
    ];
    if (budget.windowStart) {
      conditions.push(gte(costRecords.recordedAt, budget.windowStart));
    }
    if (budget.projectId) {
      conditions.push(eq(costRecords.projectId, budget.projectId));
    } else {
      conditions.push(sql`${costRecords.projectId} IS NULL`);
    }
    if (budget.windowEnd) {
      conditions.push(lte(costRecords.recordedAt, budget.windowEnd));
    }
    const [result] = await db
      .select({ total: sql<number>`CAST(COALESCE(SUM(actual_cost), 0) AS FLOAT8)` })
      .from(costRecords)
      .where(and(...conditions));
    return result?.total ?? 0;
  }

  private periodFilter(period: string | null | undefined): ReturnType<typeof gte> | undefined {
    if (!period) return undefined;
    switch (period) {
      case 'daily': return gte(costRecords.recordedAt, sql`NOW() - INTERVAL '1 day'`);
      case 'weekly': return gte(costRecords.recordedAt, sql`NOW() - INTERVAL '7 days'`);
      case 'monthly': return gte(costRecords.recordedAt, sql`NOW() - INTERVAL '30 days'`);
      default: return undefined;
    }
  }

  private async getSpendingLimitSpent(
    limit: { orgId: string; scope: string; scopeTargetId: string; period?: string | null }
  ): Promise<number> {
    const db = getDb();

    const pf = this.periodFilter(limit.period);

    if (limit.scope === 'wallet') {
      const conditions: any[] = [
        eq(blobRegistrations.walletId, limit.scopeTargetId),
        eq(costRecords.orgId, limit.orgId),
      ];
      if (pf) conditions.push(pf);
      const [result] = await db
        .select({ total: sql<number>`CAST(COALESCE(SUM(cr.actual_cost), 0) AS FLOAT8)` })
        .from(costRecords)
        .innerJoin(renewalJobs, eq(costRecords.renewalJobId, renewalJobs.id))
        .innerJoin(blobRegistrations, eq(renewalJobs.blobRegistrationId, blobRegistrations.id))
        .where(and(...conditions));
      return result?.total ?? 0;
    }

    if (limit.scope === 'project') {
      const conditions: any[] = [
        eq(costRecords.projectId, limit.scopeTargetId),
        eq(costRecords.orgId, limit.orgId),
      ];
      if (pf) conditions.push(pf);
      const [result] = await db
        .select({ total: sql<number>`CAST(COALESCE(SUM(cr.actual_cost), 0) AS FLOAT8)` })
        .from(costRecords)
        .where(and(...conditions));
      return result?.total ?? 0;
    }

    if (limit.scope === 'policy') {
      const conditions: any[] = [
        eq(policyAssignments.policyId, limit.scopeTargetId),
        eq(costRecords.orgId, limit.orgId),
      ];
      if (pf) conditions.push(pf);
      const [result] = await db
        .select({ total: sql<number>`CAST(COALESCE(SUM(cr.actual_cost), 0) AS FLOAT8)` })
        .from(costRecords)
        .innerJoin(renewalJobs, eq(costRecords.renewalJobId, renewalJobs.id))
        .innerJoin(policyAssignments, eq(renewalJobs.blobRegistrationId, policyAssignments.blobRegistrationId))
        .where(and(...conditions));
      return result?.total ?? 0;
    }

    // organization scope — all cost records for the org
    const conditions: any[] = [eq(costRecords.orgId, limit.scopeTargetId)];
    if (pf) conditions.push(pf);
    const [result] = await db
      .select({ total: sql<number>`CAST(COALESCE(SUM(cr.actual_cost), 0) AS FLOAT8)` })
      .from(costRecords)
      .where(and(...conditions));
    return result?.total ?? 0;
  }

  private async getEffectiveSpendingLimits(
    orgId: string,
    projectId: string | null,
    walletId: string | undefined,
    policyId: string | null,
  ): Promise<any[]> {
    const db = getDb();

    const scopeConditions: any[] = [];
    if (walletId) {
      scopeConditions.push(
        and(eq(spendingLimits.scope, 'wallet'), eq(spendingLimits.scopeTargetId, walletId)),
      );
    }
    if (projectId) {
      scopeConditions.push(
        and(eq(spendingLimits.scope, 'project'), eq(spendingLimits.scopeTargetId, projectId)),
      );
    }
    scopeConditions.push(
      and(eq(spendingLimits.scope, 'organization'), eq(spendingLimits.scopeTargetId, orgId)),
    );
    if (policyId) {
      scopeConditions.push(
        and(eq(spendingLimits.scope, 'policy'), eq(spendingLimits.scopeTargetId, policyId)),
      );
    }

    return await db.select().from(spendingLimits)
      .where(and(
        eq(spendingLimits.orgId, orgId),
        eq(spendingLimits.status, 'active'),
        or(...scopeConditions),
      ));
  }
}

export const costEngine = new CostEngine();

export async function rolloverBudgetWindow(budgetId: string): Promise<void> {
  const db = getDb();
  const [budget] = await db.select().from(budgets).where(eq(budgets.id, budgetId)).limit(1);
  if (!budget) throw new Error(`Budget ${budgetId} not found`);
  if (!budget.windowEnd) throw new Error(`Budget ${budgetId} has no windowEnd`);

  const windowDuration = budget.windowEnd.getTime() - budget.windowStart.getTime();
  const newStart = budget.windowEnd;
  const newEnd = new Date(newStart.getTime() + windowDuration);

  await db.transaction(async (tx) => {
    await tx.update(budgets)
      .set({ status: 'window_closed' })
      .where(eq(budgets.id, budgetId));

    await tx.update(budgets)
      .set({
        status: 'active',
        windowStart: newStart,
        windowEnd: newEnd,
      })
      .where(eq(budgets.id, budgetId));
  });

  await db.insert(auditLogs).values({
    orgId: budget.orgId,
    userId: null,
    action: 'budget.window_rolled_over',
    resourceType: 'budget',
    resourceId: budgetId,
    details: {
      previousWindowEnd: budget.windowEnd.toISOString(),
      newWindowStart: newStart.toISOString(),
      newWindowEnd: newEnd.toISOString(),
    },
  });

  await emit(createEvent(
    EventNames.BUDGET_WINDOW_ROLLED_OVER,
    budget.orgId,
    'budget',
    budgetId,
    { type: 'system' },
    {
      budgetId,
      previousWindowEnd: budget.windowEnd.toISOString(),
      newWindowStart: newStart.toISOString(),
      newWindowEnd: newEnd.toISOString(),
    },
  ));
}
