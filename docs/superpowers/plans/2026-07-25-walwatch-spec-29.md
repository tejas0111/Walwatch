# WalWatch — Complete Spec 29 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Align all WalWatch code with every requirement across all 29 numbered spec files (00–29), closing all gaps: Scheduler (10), Dashboard Rules (13), Admin Tools (29), Cost Engine enforcement (11), Policy Engine resolution (09), Notification delivery (12), invariant enforcement (05), queue-driven Renewal Engine (08), SDK/CLI sync, Edge Cases (27), Testing (21), and Non-Functional alignment (22).

**Architecture:** Event-driven Hono API + Drizzle ORM + PostgreSQL + Keeper background worker. All new behavior builds on the existing EventBus (spec 26), State Machine Engine (spec 25), and error-classification system (spec 20) already implemented in uncommitted working tree.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL 16, Sui SDK, node-cron, TypeScript strict mode

## Global Constraints

- Every event carries: `eventName`, `timestamp` (ISO 8601), `entityType`, `entityId`, `actor` (human|api_key|system), `orgId` — per spec 26
- Every API response uses standardized error shape: `{ error: { message, code, requestId? } }` — per spec 20
- Every DB table has `id` UUID PK, `created_at`, `updated_at`, soft-delete columns where applicable
- All routes use `requireAuth` + `requireOrg` + `requireRole` middleware
- All mutations log via existing `logAudit` / `eventBus.emit()`
- TypeScript strict mode; all 5 packages must compile with `npx tsc --noEmit` (or equivalent)
- Every state transition on a stateful entity uses `validateTransition()` from `state-machine.ts`
- Every state-changing action emits its spec-26 event via `eventBus.emit()`
- No Dashboard-only functionality — every capability also has an API endpoint (spec 01)
- Idempotency keys on all mutating endpoints (spec 14)
- Cursor-based pagination on all list endpoints (spec 14)
- SDK is a thin client — never embeds server-side business logic (spec 28)
- CLI is built on SDK, never on raw API calls (spec 28)

---

### Task 1: Scheduler Engine (spec 10)

**Files:**
- Create: `api/src/routes/schedules.ts`
- Create: `keeper/src/scheduler.ts`
- Modify: `keeper/src/index.ts` (integrate scheduler alongside scan cycle)
- Modify: `api/src/index.ts` (register `/api/schedules` route)
- Modify: `api/src/db/schema.ts` (add `schedules` table)
- Create: `api/src/db/migrations/0018_schedules.sql`
- Modify: `keeper/src/job-monitor.ts` (track scheduler jobs)

**Interfaces:**
- Consumes: `EventBus` (`initEventBus`, `subscribe`, `emit`, `EventNames`), `state-machine.ts` (`registerMachine`), `jobs` table in DB
- Produces: DB-backed declarative schedule definitions, missed-run tracking with catch-up, schedule events via EventBus

**Architecture:**
Two schedule categories per spec 10:
1. **System-defined** — expiry threshold checks, budget window rollovers. Not user-configurable, enforced frequency.
2. **User-configurable** — blob discovery scan frequency. Has system-enforced min interval.

Scheduler design:
- `schedules` table: `id UUID PK`, `org_id UUID FK`, `name TEXT NOT NULL`, `type TEXT NOT NULL` (`'system'` | `'user'`), `cron_expr TEXT NOT NULL`, `last_run_at TIMESTAMPTZ`, `last_completed_at TIMESTAMPTZ`, `enabled BOOLEAN DEFAULT true`, `min_interval_ms BIGINT`, `config JSONB`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`
- Keeper scheduler: evaluates which schedules are due, enqueues work as discrete job units
- Tracks `last_completed_at` per schedule — if a restart occurs, skips windows already processed
- Emits `schedule.missed`, `schedule.caught_up` events via EventBus
- Missed run catch-up: if a schedule was missed (system down), queues catch-up at appropriate priority per spec 10 and spec 16

**Step 1: Add schedules table to schema**

In `api/src/db/schema.ts`, add after the `notifications` table:

```typescript
export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('system'),
  cronExpr: text('cron_expr').notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
  enabled: boolean('enabled').default(true).notNull(),
  minIntervalMs: bigint('min_interval_ms', { mode: 'number' }),
  config: jsonb('config').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

**Step 2: Register schedule machine in state-machine.ts**

In `api/src/lib/state-machine.ts`, add to the `StateMachineName` type: `'schedule'`

Register:
```typescript
registerMachine({
  name: 'schedule',
  initial: 'active',
  states: ['active', 'paused', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('active', 'paused', 'manual'),
    t('paused', 'active', 'manual'),
    t('active', 'deleted', 'manual'),
    t('paused', 'deleted', 'manual'),
  ],
});
```

**Step 3: Create schedule route file**

File: `api/src/routes/schedules.ts`
- `GET /api/schedules` — list schedules, paginated, filterable by type
- `GET /api/schedules/:id` — get schedule details
- `POST /api/schedules` — create schedule (user only; system schedules are seeded)
- `PATCH /api/schedules/:id` — update schedule (cron_expr, enabled)
- `DELETE /api/schedules/:id` — soft-delete with state machine validation
- `GET /api/schedules/:id/runs` — history of runs for this schedule

Use existing `validateTransition`, `requireAuth`, `requireOrg`, `logAudit`.

**Step 4: Create keeper scheduler module**

File: `keeper/src/scheduler.ts`

```typescript
import { getDb } from './db.js';
import cron from 'node-cron';
import { logger } from './logger.js';

interface ScheduleConfig {
  id: string;
  orgId: string;
  name: string;
  cronExpr: string;
  lastRunAt: Date | null;
  lastCompletedAt: Date | null;
  enabled: boolean;
  minIntervalMs: number | null;
  config: Record<string, unknown>;
}

export class SchedulerEngine {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private running = false;

  async loadAndStart(): Promise<void> {
    this.running = true;
    const db = getDb();
    const activeSchedules: ScheduleConfig[] = await db.select('*').from('schedules')
      .where('enabled = true AND (deleted_at IS NULL)');
    
    for (const schedule of activeSchedules) {
      this.scheduleTask(schedule);
    }
    logger.info({ count: activeSchedules.length }, 'Scheduler loaded schedules');
  }

  private scheduleTask(schedule: ScheduleConfig): void {
    if (this.tasks.has(schedule.id)) {
      this.tasks.get(schedule.id)!.stop();
    }
    
    const task = cron.schedule(schedule.cronExpr, async () => {
      await this.executeSchedule(schedule);
    });
    this.tasks.set(schedule.id, task);
  }

  private async executeSchedule(schedule: ScheduleConfig): Promise<void> {
    // 1. Check last_run_at — if already completed for this window, skip
    // 2. Check min_interval_ms — if last_run was too recent, defer
    // 3. Mark schedule.lastRunning = now()
    // 4. Execute the job function based on schedule.config.type
    // 5. Mark schedule.lastCompletedAt = now()
    // 6. Emit job.completed or job.failed_final event
    logger.info({ scheduleId: schedule.id, name: schedule.name }, 'Executing schedule');
  }

  async reloadSchedule(scheduleId: string): Promise<void> {
    const db = getDb();
    const schedule: ScheduleConfig = await db.select('*').from('schedules')
      .where('id = ?', scheduleId).first();
    if (schedule) {
      this.scheduleTask(schedule);
    }
  }

  stop(): void {
    for (const [, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    this.running = false;
  }
}
```

**Step 5: Integrate scheduler into keeper/src/index.ts**

Add after existing cron scan schedule (around line 178):
```typescript
import { SchedulerEngine } from './scheduler.js';

const scheduler = new SchedulerEngine();
await scheduler.loadAndStart();
```

Add to shutdown handler:
```typescript
scheduler.stop();
```

**Step 6: Create migration 0018**

File: `api/src/db/migrations/0018_schedules.sql`
```sql
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'system',
  cron_expr TEXT NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  min_interval_ms BIGINT,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed system schedules
INSERT INTO schedules (org_id, name, type, cron_expr, enabled, config)
SELECT o.id, 'expiry-threshold-check', 'system', '*/5 * * * *', true, '{"type": "expiry_check", "description": "Check blobs approaching expiry threshold"}'::jsonb
FROM organizations o
ON CONFLICT DO NOTHING;

INSERT INTO schedules (org_id, name, type, cron_expr, enabled, config)
SELECT o.id, 'budget-window-rollover', 'system', '0 0 * * *', true, '{"type": "budget_rollover", "description": "Roll over budget windows"}'::jsonb
FROM organizations o
ON CONFLICT DO NOTHING;

CREATE INDEX idx_schedules_org ON schedules(org_id);
CREATE INDEX idx_schedules_enabled ON schedules(enabled);
```

**Step 7: Register route in api/src/index.ts**

Add:
```typescript
import { scheduleRoutes } from './routes/schedules.js';
app.route('/api/schedules', scheduleRoutes);
```

**Step 8: Seed system schedules on org creation**

In `api/src/routes/orgs.ts`, after org creation, insert default system schedules.

---

### Task 2: Dashboard "Needs Attention" Endpoint (spec 13)

**Files:**
- Create: `api/src/routes/dashboard.ts`
- Modify: `api/src/index.ts` (register dashboard route)

**Interfaces:**
- Consumes: `blobRegistrations`, `renewalJobs`, `budgets`, `alertEvents`, `notificationChannels` tables
- Produces: Aggregated dashboard summary JSON

**Architecture:**
A single `GET /api/dashboard/summary?orgId=X&projectId=Y` endpoint returning:
- `blobsByHealth`: counts per health category (healthy, at_risk, expiring, expired) — derived from blob status per spec 03 mapping table
- `storageUnderManagement`: total bytes, count
- `recentSpend`: sum of estimatedCost from last 30 days renewalJobs
- `budgetComparison`: budget totals, spent, remaining, threshold status
- `nextToExpire`: top 10 blobs with closest expiryEpoch
- `needsAttention`: renewalJobs with failed status, blocked_by_budget, alertEvents with escalated status
- All returned health values must be derived from lifecycle state per spec 03 mapping table:
  - `healthy`: discovered, verified, tracked, protected, renewed
  - `at_risk`: expiring
  - `expiring`: renewing
  - `expired`: expired
  - Archived/deleted excluded from health rollups

**Step 1: Create dashboard route file**

```typescript
import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { and, eq, sql, lt, gt, desc, gte, lte } from 'drizzle-orm';
import { blobRegistrations, renewalJobs, budgets, alertEvents } from '../db/schema.js';

const dashboardRoutes = new Hono();

dashboardRoutes.get('/summary', requireAuth, requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const projectId = c.req.query('projectId');

  // Build base filters
  const orgFilter = eq(blobRegistrations.orgId, orgId);
  const projectFilter = projectId ? eq(blobRegistrations.projectId, projectId) : undefined;
  const blobFilter = projectFilter ? and(orgFilter, projectFilter) : orgFilter;

  // 1. Blob counts by health (derived from lifecycle state per spec 03)
  const allBlobs = await getDb().select({
    status: blobRegistrations.status,
    count: sql<number>`count(*)`,
    totalBytes: sql<number>`coalesce(sum(size_bytes), 0)`,
  }).from(blobRegistrations)
    .where(and(blobFilter, sql`${blobRegistrations.status} NOT IN ('archived', 'deleted')`))
    .groupBy(blobRegistrations.status);

  // Derive health from lifecycle state
  const healthyStatuses = ['discovered', 'verified', 'tracked', 'protected', 'renewed'];
  const blobCounts = {
    healthy: 0,
    at_risk: 0,
    expiring: 0,
    expired: 0,
    totalBytes: 0,
    totalCount: 0,
  };

  for (const row of allBlobs) {
    blobCounts.totalCount += Number(row.count);
    blobCounts.totalBytes += Number(row.totalBytes);
    if (healthyStatuses.includes(row.status)) blobCounts.healthy += Number(row.count);
    else if (row.status === 'expiring') blobCounts.at_risk += Number(row.count);
    else if (row.status === 'renewing') blobCounts.expiring += Number(row.count);
    else if (row.status === 'expired') blobCounts.expired += Number(row.count);
  }

  // 2. Top 10 blobs expiring next
  const nextToExpire = await getDb().select({
    id: blobRegistrations.id,
    blobId: blobRegistrations.blobId,
    name: blobRegistrations.name,
    expiryEpoch: blobRegistrations.expiryEpoch,
    status: blobRegistrations.status,
  }).from(blobRegistrations)
    .where(and(blobFilter, sql`${blobRegistrations.expiryEpoch} IS NOT NULL`, sql`${blobRegistrations.status} NOT IN ('archived', 'deleted', 'expired')`))
    .orderBy(asc(blobRegistrations.expiryEpoch))
    .limit(10);

  // 3. Recent spend (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentRenewals = await getDb().select({
    totalCost: sql<number>`coalesce(sum(estimated_cost), 0)`,
    count: sql<number>`count(*)`,
    failedCount: sql<number>`sum(case when status = 'failed_final' then 1 else 0 end)`,
    blockedCount: sql<number>`sum(case when status = 'blocked_by_budget' then 1 else 0 end)`,
  }).from(renewalJobs)
    .where(and(
      eq(renewalJobs.orgId, orgId),
      gte(renewalJobs.createdAt, thirtyDaysAgo),
    ));

  // 4. Budget comparison
  const activeBudgets = await getDb().select().from(budgets)
    .where(and(
      eq(budgets.orgId, orgId),
      eq(budgets.status, 'active'),
    ));

  // 5. Needs attention items
  const needsAttention = await getDb().select({
    id: alertEvents.id,
    eventType: alertEvents.eventType,
    severity: alertEvents.severity,
    message: alertEvents.message,
    status: alertEvents.status,
    firedAt: alertEvents.firedAt,
  }).from(alertEvents)
    .where(and(
      eq(alertEvents.orgId, orgId),
      sql`${alertEvents.status} IN ('fired', 'delivery_failed', 'delivery_failed_final', 'escalated')`,
    ))
    .orderBy(desc(alertEvents.firedAt))
    .limit(20);

  return c.json({
    blobsByHealth: {
      healthy: blobCounts.healthy,
      atRisk: blobCounts.at_risk,
      expiring: blobCounts.expiring,
      expired: blobCounts.expired,
    },
    storageUnderManagement: {
      totalBytes: blobCounts.totalBytes,
      totalBlobs: blobCounts.totalCount,
    },
    recentSpend: {
      totalCost: Number(recentRenewals[0]?.totalCost ?? 0),
      renewalCount: Number(recentRenewals[0]?.count ?? 0),
      failedCount: Number(recentRenewals[0]?.failedCount ?? 0),
      blockedCount: Number(recentRenewals[0]?.blockedCount ?? 0),
    },
    budgetComparison: activeBudgets.map(b => ({
      id: b.id,
      name: b.name,
      amount: Number(b.amount),
      spent: Number(b.spent),
      remaining: Number(b.amount) - Number(b.spent),
      threshold: b.alertThreshold,
      crossed: Number(b.spent) >= (Number(b.amount) * (b.alertThreshold ?? 80) / 100),
    })),
    nextToExpire,
    needsAttention,
  });
});

export { dashboardRoutes };
```

**Step 2: Register in api/src/index.ts**

```typescript
import { dashboardRoutes } from './routes/dashboard.js';
app.route('/api/dashboard', dashboardRoutes);
```

---

### Task 3: Admin Tools + Feature Flags (spec 29)

**Files:**
- Create: `api/src/routes/admin.ts`
- Create: `api/src/routes/feature-flags.ts`
- Modify: `api/src/index.ts` (register admin routes)
- Modify: `api/src/db/schema.ts` (add `feature_flags` table)
- Create: `api/src/db/migrations/0019_feature_flags.sql`
- Create: `keeper/src/admin-scripts.ts`

**Interfaces:**
- Consumes: existing metrics, queue stats, EventBus
- Produces: Admin panel routes, feature flag system, experiment system

**Architecture:**

Admin routes (spec 29):
- All routes are accessible only to operator identities (separate from org RBAC)
- Read-mostly — mutations go through Public API
- All admin actions produce Audit Events with ticket/justification

Feature flags (spec 29):
- Flags govern availability, never correctness guarantees
- Flag state changes are Audit Events
- Feature flags vs tier gates: flags are transient rollout mechanisms, tiers are stable billing boundaries
- Flags removed after rollout completes
- Flag states: `on` | `off` | `org:scope` (per-org opt-in)

Experiments (spec 29):
- A/B tests on discretionary product decisions only
- Never on core guarantees (data safety, observability)
- Every experiment assignment is recorded

**Step 1: Add feature_flags table**

In schema:
```typescript
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  enabled: boolean('enabled').default(false).notNull(),
  orgIds: uuid('org_id').array().default([]), // explicit opt-in orgs
  type: text('type').default('release').notNull(), // release | experiment
  config: jsonb('config').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const experimentAssignments = pgTable('experiment_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  experimentName: text('experiment_name').notNull(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  variant: text('variant').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
});
```

**Step 2: Create admin routes**

File: `api/src/routes/admin.ts`:
- `GET /api/admin/health` — detailed system health (DB, Sui RPC, queue depth, metrics)
- `GET /api/admin/metrics` — operational metrics from MetricsCollector
- `GET /api/admin/queues` — job queue depth per type
- `POST /api/admin/trigger-scan` — manual scan cycle trigger
- `POST /api/admin/retry-job/:id` — manual job retry with justification
- `GET /api/admin/tenants/:orgId` — inspect tenant config (read-only)
- All require admin authentication header (separate from org auth)

```typescript
import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';
import { renewalJobs, alertEvents, schedules } from '../db/schema.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';

const adminRoutes = new Hono();

// Admin auth middleware — validates operator API key
async function requireAdmin(c: any, next: any) {
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return c.json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }
  await next();
}

adminRoutes.use('*', requireAdmin);

adminRoutes.get('/health', async (c) => {
  const [queueDepth, alertCount, scheduleCount] = await Promise.all([
    getDb().select({ count: sql<number>`count(*)` }).from(renewalJobs)
      .where(eq(renewalJobs.status, 'queued')),
    getDb().select({ count: sql<number>`count(*)` }).from(alertEvents)
      .where(sql`status IN ('fired', 'delivery_failed')`),
    getDb().select({ count: sql<number>`count(*)` }).from(schedules)
      .where(sql`enabled = true`),
  ]);
  return c.json({
    status: 'ok',
    queueDepth: Number(queueDepth[0]?.count ?? 0),
    pendingAlerts: Number(alertCount[0]?.count ?? 0),
    activeSchedules: Number(scheduleCount[0]?.count ?? 0),
    timestamp: new Date().toISOString(),
  });
});

adminRoutes.post('/trigger-scan', async (c) => {
  const { justification, orgId, actor } = await c.req.json();
  const event = createEvent(
    EventNames.JOB_COMPLETED, orgId || 'system', 'admin', 'trigger-scan',
    { type: 'system' },
    { justification },
  );
  await emit(event);
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

export { adminRoutes };
```

**Step 3: Create feature flag routes**

File: `api/src/routes/feature-flags.ts`:
- `GET /api/admin/flags` — list all flags
- `POST /api/admin/flags` — create flag
- `PATCH /api/admin/flags/:id` — update flag (toggle, add/remove org)
- `DELETE /api/admin/flags/:id` — remove flag
- `GET /api/admin/flags/:id/check?orgId=X` — check if flag is active for org

**Step 4: Register in api/src/index.ts**

```typescript
import { adminRoutes } from './routes/admin.js';
import { featureFlagRoutes } from './routes/feature-flags.js';
app.route('/api/admin', adminRoutes);
app.route('/api/admin/flags', featureFlagRoutes);
```

---

### Task 4: Cost Engine Enforcement in Renewal Path (spec 11)

**Files:**
- Create: `api/src/lib/cost-engine.ts`
- Modify: `keeper/src/executor.ts` (add budget check before execution)
- Modify: `keeper/src/db-writer.ts` (record estimates and actuals)
- Modify: `api/src/routes/renewal-jobs.ts` (estimate cost on creation)
- Modify: `api/src/routes/budgets.ts` (spent tracking)

**Interfaces:**
- Consumes: `budgets`, `spendingLimits`, `renewalJobs`, `blobRegistrations` tables, `EventBus`
- Produces: Cost estimate, budget check, spending limit enforcement

**Architecture per spec 11:**
1. Every spending operation has estimated cost **before** execution
2. Actual cost recorded separately and immutably after execution
3. Budget check before renewal execution (not after)
4. Spending Limit check: blocked before on-chain write if would exceed
5. Budget threshold crossing: alert fires but doesn't block
6. Cost estimation accounts for: blob size, duration, network conditions, publisher fee

**Step 1: Create cost-engine.ts**

```typescript
import { getDb } from '../db/index.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { budgets, spendingLimits, renewalJobs, blobRegistrations } from '../db/schema.js';
import { emit, EventNames, createEvent } from './event-bus.js';

interface CostEstimate {
  estimatedCost: number;
  estimatedAt: Date;
  stalenessMs: number;
  details: {
    blobSizeBytes: number;
    extensionEpochs: number;
    baseCost: number;
    publisherPremium: number;
  };
}

interface BudgetCheckResult {
  allowed: boolean;
  softThresholdCrossed: boolean;
  hardLimitBlocked: boolean;
  blockingLimitId?: string;
  message?: string;
}

export class CostEngine {
  /**
   * Estimate renewal cost for a blob.
   * Returns fresh estimate with staleness metadata.
   */
  async estimateRenewalCost(
    blobId: string,
    extensionEpochs: number,
    publisherEndpoint?: string,
  ): Promise<CostEstimate> {
    // 1. Look up blob size
    // 2. Compute base cost from size * epochs
    // 3. Apply publisher premium if applicable
    // 4. Return estimate + staleness info
    const estimatedCost = extensionEpochs * 1000; // placeholder formula
    return {
      estimatedCost,
      estimatedAt: new Date(),
      stalenessMs: 5 * 60 * 1000, // 5 minutes default max staleness
      details: {
        blobSizeBytes: 0,
        extensionEpochs,
        baseCost: estimatedCost,
        publisherPremium: 0,
      },
    };
  }

  /**
   * Check all applicable budgets and spending limits before execution.
   * Returns whether the renewal is allowed.
   */
  async checkBudgetBeforeExecution(
    orgId: string,
    projectId: string | null,
    walletId: string,
    policyId: string | null,
    estimatedCost: number,
  ): Promise<BudgetCheckResult> {
    // 1. Get active spending limits at scope (Wallet -> Project -> Org)
    const scopedLimits = await this.getEffectiveSpendingLimits(orgId, projectId, walletId, policyId);
    
    // 2. Check each spending limit — can any accommodate the cost?
    for (const limit of scopedLimits) {
      const wouldExceed = (Number(limit.spent) + estimatedCost) > Number(limit.amount);
      if (wouldExceed) {
        return {
          allowed: false,
          softThresholdCrossed: false,
          hardLimitBlocked: true,
          blockingLimitId: limit.id,
          message: `Would exceed spending limit '${limit.name}' (${limit.spent} + ${estimatedCost} > ${limit.amount})`,
        };
      }
    }

    // 3. Check soft budget thresholds
    const activeBudgets = await getDb().select().from(budgets)
      .where(and(
        eq(budgets.orgId, orgId),
        eq(budgets.status, 'active'),
      ));

    for (const budget of activeBudgets) {
      const projectedSpend = Number(budget.spent) + estimatedCost;
      const budgetAmount = Number(budget.amount);
      if (budget.alertThreshold && projectedSpend >= (budgetAmount * budget.alertThreshold / 100)) {
        // Crossed soft threshold — emit alert but don't block
        await emit(createEvent(
          EventNames.BUDGET_THRESHOLD_CROSSED,
          orgId, 'budget', budget.id,
          { type: 'system' },
          { projectedSpend, budgetAmount, threshold: budget.alertThreshold },
        ));
      }
    }

    return { allowed: true, softThresholdCrossed: false, hardLimitBlocked: false };
  }

  /**
   * Record actual cost after successful renewal.
   */
  async recordActualCost(
    renewalJobId: string,
    actualCost: number,
    txDigest: string,
  ): Promise<void> {
    await getDb().update(renewalJobs)
      .set({
        estimatedCost: actualCost, // actual replaces estimate as final record
        completedAt: new Date(),
      })
      .where(eq(renewalJobs.id, renewalJobId));

    // Update budget spent totals
    const job = await getDb().select().from(renewalJobs)
      .where(eq(renewalJobs.id, renewalJobId)).then(r => r[0]);
    if (job) {
      await getDb().update(budgets)
        .set({ spent: sql`${budgets.spent} + ${actualCost}` })
        .where(and(eq(budgets.orgId, job.orgId), eq(budgets.status, 'active')));
    }
  }

  private async getEffectiveSpendingLimits(
    orgId: string,
    projectId: string | null,
    walletId: string,
    policyId: string | null,
  ): Promise<any[]> {
    // Per spec 11: most specific scope applies (Wallet -> Project -> Org)
    // Wallet-level limit
    const walletLimits = await getDb().select().from(spendingLimits)
      .where(and(
        eq(spendingLimits.status, 'active'),
        eq(spendingLimits.walletId, walletId),
      ));
    
    if (walletLimits.length > 0) return walletLimits;

    // Project-level limit
    // Org-level limit
    return [];
  }
}

export const costEngine = new CostEngine();
```

**Step 2: Integrate into renewal-jobs.ts creation endpoint**

Add cost estimation when creating a renewal job:
```typescript
import { costEngine } from '../lib/cost-engine.js';

// In POST /renewal-jobs handler, after validation:
const estimate = await costEngine.estimateRenewalCost(
  body.blobId, body.extensionEpochs,
);
const budgetCheck = await costEngine.checkBudgetBeforeExecution(
  orgId, project?.id, walletId, null, estimate.estimatedCost,
);

if (!budgetCheck.allowed) {
  // Create job in 'blocked_by_budget' state
  return c.json({ error: { message: budgetCheck.message, code: 'BLOCKED_BY_BUDGET' } }, 422);
}
```

**Step 3: Integrate into keeper/src/executor.ts**

Before executing on-chain renewal, call costEngine:
```typescript
const budgetCheck = await costEngine.checkBudgetBeforeExecution(
  orgId, projectId, walletId, policyId, estimatedCost,
);
if (!budgetCheck.allowed) {
  // Skip execution, record blocked status
  await createRenewalJob({ ...params, status: 'blocked_by_budget', blockedByLimitId: budgetCheck.blockingLimitId });
  continue;
}
```

---

### Task 5: Policy Engine — Inheritance & Conflict Resolution (spec 09)

**Files:**
- Create: `api/src/lib/policy-engine.ts`
- Modify: `api/src/routes/policies.ts` (add policy resolution endpoints)
- Modify: `keeper/src/index.ts` (use policy engine before renewal)

**Interfaces:**
- Consumes: `policies`, `policyAssignments`, `blobRegistrations` tables
- Produces: Deterministic policy resolution, inheritance chain

**Architecture per spec 09:**
- Inheritance: Organization → Project → Wallet → Blob/Tag (lower scope overrides higher)
- A blob's effective policy is exactly one outcome — never a field-by-field merge
- Conflict resolution at same scope level: 1. Explicit Blob ID > 2. More specific tags > 3. Most recent > 4. System default (alert-only)
- Deterministic: same blob state + time + config → same result

**Step 1: Create policy-engine.ts**

```typescript
import { getDb } from '../db/index.js';
import { eq, and, or, sql, inArray } from 'drizzle-orm';
import { policies, policyAssignments, blobRegistrations, wallets, projects } from '../db/schema.js';

interface ResolvedPolicy {
  policyId: string | null;
  policyName: string | null;
  renewThreshold: number;
  renewExtension: number;
  maxTotalEpochs: number | null;
  autoRenewalEnabled: boolean;
  scope: string;
  resolutionPath: string[];
}

export class PolicyEngine {
  /**
   * Resolve the effective policy for a blob.
   * Per spec 09 inheritance:
   *   Blob/tag-based > Wallet > Project > Organization (default)
   *   At same scope: Explicit > Specific > Latest > Default
   */
  async resolveEffectivePolicy(blobId: string): Promise<ResolvedPolicy> {
    const blob = await getDb().select().from(blobRegistrations)
      .where(eq(blobRegistrations.id, blobId)).then(r => r[0]);
    if (!blob) throw new Error(`Blob ${blobId} not found`);

    // 1. Check blob-level explicit policy assignment
    const blobAssignment = await getDb().select()
      .from(policyAssignments)
      .where(eq(policyAssignments.blobRegistrationId, blobId))
      .leftJoin(policies, eq(policyAssignments.policyId, policies.id))
      .then(r => r[0]);
    if (blobAssignment?.policies) {
      return this.toResolvedPolicy(blobAssignment.policies, ['blob']);
    }

    // 2. Check wallet-level policies (by scope='wallet' and scopeTargetId matches wallet)
    // 3. Check project-level policies
    // 4. Check org-level default policy
    // 5. Fall back to system default

    const orgPolicies = await getDb().select().from(policies)
      .where(and(
        eq(policies.orgId, blob.orgId),
        eq(policies.status, 'active'),
        or(
          eq(policies.scope, 'organization'),
          eq(policies.scope, 'project'),
          eq(policies.scope, 'wallet'),
          eq(policies.scope, 'blob'),
        ),
      ))
      .orderBy(sql`CASE ${policies.scope}
        WHEN 'blob' THEN 1
        WHEN 'wallet' THEN 2
        WHEN 'project' THEN 3
        WHEN 'organization' THEN 4
        ELSE 5
      END`);

    // Follow inheritance order, most specific wins
    for (const pol of orgPolicies) {
      const matches = await this.policyMatchesScope(pol, blob);
      if (matches) {
        return this.toResolvedPolicy(pol, [pol.scope!]);
      }
    }

    // Fallback: system default (alert-only, no auto-renewal)
    return {
      policyId: null,
      policyName: null,
      renewThreshold: 7,
      renewExtension: 30,
      maxTotalEpochs: null,
      autoRenewalEnabled: false,
      scope: 'default',
      resolutionPath: ['default'],
    };
  }

  private async policyMatchesScope(policy: any, blob: any): Promise<boolean> {
    if (policy.scope === 'organization') return true;
    if (policy.scope === 'project') return policy.scopeTargetId === blob.projectId;
    if (policy.scope === 'wallet') {
      const wallet = await getDb().select().from(wallets)
        .where(eq(wallets.id, blob.walletId || '')).then(r => r[0]);
      return wallet ? policy.scopeTargetId === wallet.id : false;
    }
    if (policy.scope === 'blob') return policy.scopeTargetId === blob.id;
    return false;
  }

  private toResolvedPolicy(policy: any, path: string[]): ResolvedPolicy {
    return {
      policyId: policy.id,
      policyName: policy.name,
      renewThreshold: policy.renewThreshold,
      renewExtension: policy.renewExtension,
      maxTotalEpochs: policy.maxTotalEpochs,
      autoRenewalEnabled: policy.active,
      scope: policy.scope || 'unknown',
      resolutionPath: path,
    };
  }
}

export const policyEngine = new PolicyEngine();
```

**Step 2: Add policy resolution endpoint**

In `api/src/routes/policies.ts`:
```typescript
policiesRoutes.get('/resolve/:blobId', requireAuth, requireOrg, async (c) => {
  const { blobId } = c.req.param();
  const resolved = await policyEngine.resolveEffectivePolicy(blobId);
  return c.json(resolved);
});
```

**Step 3: Integrate into keeper renewal path**

In `keeper/src/index.ts`, before executing renewal:
```typescript
const effectivePolicy = await policyEngine.resolveEffectivePolicy(registration.id);
if (!effectivePolicy.autoRenewalEnabled) {
  logger.info({ blobId: vault.blobId }, 'Auto-renewal disabled by policy — skipping');
  continue;
}
```

---

### Task 6: Notification Engine Delivery (spec 12)

**Files:**
- Create: `keeper/src/notification-engine.ts`
- Create: `keeper/src/channels/` directory with channel implementations
- Create: `keeper/src/channels/email.ts`
- Create: `keeper/src/channels/discord.ts`
- Create: `keeper/src/channels/slack.ts`
- Create: `keeper/src/channels/webhook.ts`
- Modify: `keeper/src/notification.ts` (integrate DB-driven dispatch)
- Modify: `keeper/src/index.ts` (start notification engine)

**Interfaces:**
- Consumes: `alertEvents`, `notificationChannels`, `notifications`, `alertRules` tables, `EventBus`
- Produces: Channel-agnostic delivery, per-channel formatting, delivery tracking

**Architecture per spec 12:**
- Channels implement a common `NotificationChannel` interface
- Rate/noise control: deduplicate repeated firing of same condition for same entity within a short window
- At-least-once delivery with idempotent payload (stable notification ID)
- Failed delivery retries with exponential backoff (max 3 attempts)
- Exhausted retries escalate: event in Activity Feed, fallback to email if available
- Channel credentials are secrets per spec 17 — encrypted at rest, never returned by read endpoints

**Step 1: Define channel interface**

```typescript
interface NotificationPayload {
  id: string;
  alertEventId: string;
  orgId: string;
  eventType: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
  linkToEntity?: string;
}

interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

interface NotificationChannel {
  type: string;
  send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult>;
}
```

**Step 2: Create channel implementations**

File: `keeper/src/channels/email.ts`:
```typescript
import { NotificationChannel, NotificationPayload, DeliveryResult } from './types.js';

export class EmailChannel implements NotificationChannel {
  type = 'email';
  
  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    // Use Resend API for email delivery
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) return { success: false, error: 'RESEND_API_KEY not configured' };
      
      const to = config.to as string;
      const from = config.from as string || process.env.NOTIFICATION_FROM_EMAIL || 'alerts@walwatch.dev';
      
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          subject: `[${payload.severity.toUpperCase()}] ${payload.eventType} — ${payload.message.slice(0, 80)}`,
          html: this.buildEmailBody(payload),
        }),
      });
      
      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private buildEmailBody(payload: NotificationPayload): string {
    return `<h2>${payload.eventType}</h2>
<p>${payload.message}</p>
<pre>${JSON.stringify(payload.details, null, 2)}</pre>
${payload.linkToEntity ? `<p><a href="${payload.linkToEntity}">View in dashboard</a></p>` : ''}`;
  }
}
```

File: `keeper/src/channels/discord.ts`:
```typescript
export class DiscordChannel implements NotificationChannel {
  type = 'discord';

  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    const webhookUrl = config.webhookUrl as string;
    if (!webhookUrl) return { success: false, error: 'Discord webhook URL not configured' };

    const embedColor = payload.severity === 'error' ? 0xff0000 
      : payload.severity === 'warning' ? 0xffaa00 
      : 0x3498db;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: payload.eventType,
            description: payload.message,
            color: embedColor,
            fields: Object.entries(payload.details).map(([k, v]) => ({
              name: k,
              value: String(v).slice(0, 1024),
              inline: true,
            })),
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
```

File: `keeper/src/channels/slack.ts` — similar block-kit formatting.

File: `keeper/src/channels/webhook.ts` — generic webhook POST with optional HMAC signing.

**Step 3: Create notification engine**

File: `keeper/src/notification-engine.ts`:
```typescript
import { getDb } from './db.js';
import { eq, and, sql } from 'drizzle-orm';
import { alertEvents, notificationChannels, notifications, alertRules } from '../api/src/db/schema.js';
import { EmailChannel } from './channels/email.js';
import { DiscordChannel } from './channels/discord.js';
import { SlackChannel } from './channels/slack.js';
import { GenericWebhookChannel } from './channels/webhook.js';
import { NotificationChannel, NotificationPayload } from './channels/types.js';

export class NotificationEngine {
  private channels: Map<string, NotificationChannel> = new Map();

  constructor() {
    this.registerChannel(new EmailChannel());
    this.registerChannel(new DiscordChannel());
    this.registerChannel(new SlackChannel());
    this.registerChannel(new GenericWebhookChannel());
  }

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.type, channel);
  }

  async processAlertEvent(alertEventId: string): Promise<void> {
    const alertEvent = await getDb().select().from(alertEvents)
      .where(eq(alertEvents.id, alertEventId)).then(r => r[0]);
    if (!alertEvent) return;

    // Find matching alert rule to get configured channels
    const rule = alertEvent.alertRuleId 
      ? await getDb().select().from(alertRules)
          .where(eq(alertRules.id, alertEvent.alertRuleId)).then(r => r[0])
      : null;

    const channelIds = rule?.channelIds || [];
    for (const channelId of channelIds) {
      const channelRecord = await getDb().select().from(notificationChannels)
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.status, 'active')))
        .then(r => r[0]);
      if (!channelRecord) continue;

      const impl = this.channels.get(channelRecord.type);
      if (!impl) continue;

      const payload: NotificationPayload = {
        id: `${alertEvent.id}-${channelId}`,
        alertEventId: alertEvent.id,
        orgId: alertEvent.orgId,
        eventType: alertEvent.eventType,
        severity: alertEvent.severity,
        message: alertEvent.message,
        details: (alertEvent.details as Record<string, unknown>) || {},
      };

      // Create notification record
      const [notif] = await getDb().insert(notifications).values({
        orgId: alertEvent.orgId,
        alertEventId: alertEvent.id,
        channelId,
        status: 'queued',
      }).returning();

      // Attempt delivery with retry
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await impl.send(payload, channelRecord.config as Record<string, unknown>);
        if (result.success) {
          await getDb().update(notifications)
            .set({ status: 'sent', sentAt: new Date() })
            .where(eq(notifications.id, notif.id));
          
          await getDb().update(alertEvents)
            .set({ status: 'delivered', deliveredAt: new Date() })
            .where(eq(alertEvents.id, alertEvent.id));
          
          success = true;
          break;
        }
        
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }

      if (!success) {
        await getDb().update(notifications)
          .set({ status: 'failed', error: 'Max retries exceeded' })
          .where(eq(notifications.id, notif.id));
        
        // Escalate — update alert event
        await getDb().update(alertEvents)
          .set({ status: 'delivery_failed' })
          .where(eq(alertEvents.id, alertEvent.id));
      }
    }
  }
}
```

**Step 4: Subscribe to alert events**

In `keeper/src/index.ts`:
```typescript
const notificationEngine = new NotificationEngine();

// Subscribe to all alert events
eventBus.subscribe('alert_event.fired', async (event) => {
  await notificationEngine.processAlertEvent(event.entityId);
});
```

---

### Task 7: Data Model Invariant Enforcement (spec 05)

**Files:**
- Modify: `api/src/routes/wallets.ts` (enforce no duplicate address per project)
- Modify: `api/src/routes/renewal-jobs.ts` (at most one in_progress per blob)
- Modify: `api/src/routes/blobs.ts` (enforce no orphaned blob — transition on wallet disconnect)
- Create: `api/src/lib/invariant-check.ts` (centralized invariant checks)

**Interfaces:**
- Consumes: all schema tables, `state-machine.ts`
- Produces: Enforced invariants from spec 05 at the API layer

**Invariants from spec 05 to enforce:**
1. No orphaned Blob — if a Wallet is disconnected, its Blobs transition per spec 07 (Tracked, not deleted)
2. No duplicate active Wallet per address per Project
3. Renewal history is append-only — terminal renewal records never mutated
4. At most one in_progress Renewal per Blob at a time
5. Effective policy resolution is a pure function of stored data
6. AuditEvent rows are immutable and never deleted
7. Budget consumption is derived from Renewal cost records
8. Every entity can trace back to exactly one Organization

**Step 1: Create invariant-check.ts**

```typescript
import { getDb } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { wallets, renewalJobs, blobRegistrations } from '../db/schema.js';

export class InvariantChecker {
  /**
   * Invariant 2: No duplicate active wallet address per project
   */
  async ensureUniqueWalletAddress(orgId: string, projectId: string, address: string): Promise<void> {
    const existing = await getDb().select().from(wallets)
      .where(and(
        eq(wallets.orgId, orgId),
        eq(wallets.address, address),
        eq(wallets.projectId, projectId),
        sql`${wallets.status} IN ('active', 'connected')`,
        sql`${wallets.deletedAt} IS NULL`,
      )).then(r => r[0]);
    if (existing) {
      throw new Error(`Wallet with address ${address} already exists in this project`);
    }
  }

  /**
   * Invariant 4: At most one in_progress renewal per blob at a time
   */
  async ensureNoActiveRenewal(blobRegistrationId: string): Promise<void> {
    const active = await getDb().select().from(renewalJobs)
      .where(and(
        eq(renewalJobs.blobRegistrationId, blobRegistrationId),
        eq(renewalJobs.status, 'in_progress'),
      )).then(r => r[0]);
    if (active) {
      throw new Error(`Blob ${blobRegistrationId} already has an in_progress renewal`);
    }
  }

  /**
   * Invariant 8: Entity traces to exactly one org
   */
  verifyOrgChain(entity: { orgId?: string; projectId?: string }): string {
    if (!entity.orgId) throw new Error('Entity must have an orgId');
    return entity.orgId;
  }
}

export const invariantChecker = new InvariantChecker();
```

**Step 2: Apply invariants in route handlers**

In `api/src/routes/wallets.ts` — on wallet create:
```typescript
import { invariantChecker } from '../lib/invariant-check.js';

// Before insert:
await invariantChecker.ensureUniqueWalletAddress(orgId, projectId, body.address);
```

In `api/src/routes/renewal-jobs.ts` — on create/retry:
```typescript
await invariantChecker.ensureNoActiveRenewal(body.blobRegistrationId);
```

---

### Task 8: Queue-Driven Renewal Engine (spec 08)

**Files:**
- Modify: `keeper/src/index.ts` (read from renewal_jobs queue instead of chain-scan-only)
- Modify: `keeper/src/scanner.ts` (write due vaults as queued jobs)
- Modify: `keeper/src/executor.ts` (process jobs from queue, update status)
- Modify: `keeper/src/db-writer.ts` (createRenewalJob with full state machine)

**Interfaces:**
- Consumes: `renewalJobs` table, scanner output, policy engine, cost engine
- Produces: Queue-driven processing: queued → processing → succeeded/failed_final/blocked_by_budget

**Architecture per spec 08:**
- Keeper reads from `renewal_jobs WHERE status = 'pending'` ordered by `scheduledFor ASC`
- Scanner writes due vaults as queued jobs (status = 'estimated' → 'pending')
- Executor transitions: pending → in_progress → succeeded | retrying → failed_final
- Manual override: retry endpoint creates NEW job with `supersedes` link per spec 25
- Publisher selection with priority/fallback per spec 08

**Step 1: Modify keeper/src/index.ts — add queue reader alongside scan**

```typescript
// After scan cycle completes, process renewal jobs from queue
async function processRenewalQueue(): Promise<void> {
  const pendingJobs = await getDb().select().from(renewalJobs)
    .where(and(
      eq(renewalJobs.status, 'pending'),
      or(
        sql`${renewalJobs.scheduledFor} IS NULL`,
        lte(renewalJobs.scheduledFor, new Date()),
      ),
    ))
    .orderBy(asc(renewalJobs.createdAt))
    .limit(20);

  for (const job of pendingJobs) {
    // Transition to in_progress
    await getDb().update(renewalJobs)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(eq(renewalJobs.id, job.id));

    try {
      // 1. Resolve effective policy
      const policy = await policyEngine.resolveEffectivePolicy(job.blobRegistrationId);
      
      // 2. Check budget / spending limit
      const budgetCheck = await costEngine.checkBudgetBeforeExecution(
        job.orgId, null, '', job.policyId, Number(job.estimatedCost || 0),
      );
      if (!budgetCheck.allowed) {
        await getDb().update(renewalJobs)
          .set({ status: 'blocked_by_budget', blockedByLimitId: budgetCheck.blockingLimitId })
          .where(eq(renewalJobs.id, job.id));
        emit(createEvent(EventNames.RENEWAL_BLOCKED_BY_BUDGET, job.orgId, 'renewal_job', job.id, { type: 'system' }));
        continue;
      }

      // 3. Execute renewal
      const vault = await scanner.findVaultByBlobId(job.blobRegistrationId);
      if (!vault) {
        await getDb().update(renewalJobs)
          .set({ status: 'failed_final', lastError: 'Vault not found', completedAt: new Date() })
          .where(eq(renewalJobs.id, job.id));
        continue;
      }

      const result = await executor.executeRenewal(vault);
      
      // 4. Record success
      await getDb().update(renewalJobs)
        .set({ status: 'succeeded', completedAt: new Date() })
        .where(eq(renewalJobs.id, job.id));
      
      // 5. Record actual cost
      await costEngine.recordActualCost(job.id, result.actualCost || 0, result.digest);
      
      // 6. Update blob lifecycle
      await getDb().update(blobRegistrations)
        .set({ status: 'renewed', renewedAt: new Date(), updatedAt: new Date() })
        .where(eq(blobRegistrations.id, job.blobRegistrationId));

    } catch (error) {
      const attempt = job.attempt + 1;
      if (attempt < job.maxAttempts) {
        await getDb().update(renewalJobs)
          .set({ status: 'retrying', attempt, lastError: (error as Error).message })
          .where(eq(renewalJobs.id, job.id));
      } else {
        await getDb().update(renewalJobs)
          .set({ status: 'failed_final', attempt, lastError: (error as Error).message, completedAt: new Date() })
          .where(eq(renewalJobs.id, job.id));
      }
    }
  }
}

// Call after each scan cycle:
await processRenewalQueue();
```

**Step 2: Modify scanner to write queued jobs**

```typescript
// In scanner.ts findDueVaults result processing:
const dueVaults = await scanner.findDueVaults();
for (const vault of dueVaults) {
  const registration = await findBlobRegistrationByBlobId(vault.blobId);
  if (registration) {
    await createRenewalJob({
      orgId: registration.orgId,
      blobRegistrationId: registration.id,
      status: 'pending',
      attempt: 0,
      maxAttempts: 5,
      scheduledFor: new Date(),
    });
  }
}
```

---

### Task 9: SDK/CLI Sync With New Entities

**Files:**
- Modify: `sdk/src/types.ts` (add all missing entity type definitions)
- Modify: `sdk/src/client.ts` (add client methods for all entities)
- Modify: `cli/src/` (add commands for all entities)

**Step 1: Update SDK types**

```typescript
// Add missing types
export interface Schedule {
  id: string;
  orgId: string;
  name: string;
  type: 'system' | 'user';
  cronExpr: string;
  lastRunAt: string | null;
  lastCompletedAt: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  orgId: string;
  alertRuleId: string | null;
  eventType: string;
  severity: string;
  message: string;
  status: string;
  firedAt: string;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
}

export interface Webhook {
  id: string;
  orgId: string;
  name: string;
  url: string;
  events: string[];
  status: string;
  failureCount: number;
  createdAt: string;
}

export interface DashboardSummary {
  blobsByHealth: { healthy: number; atRisk: number; expiring: number; expired: number };
  storageUnderManagement: { totalBytes: number; totalBlobs: number };
  recentSpend: { totalCost: number; renewalCount: number; failedCount: number; blockedCount: number };
  budgetComparison: Array<{ id: string; name: string; amount: number; spent: number; remaining: number; crossed: boolean }>;
  nextToExpire: Array<{ id: string; blobId: string; name: string | null; expiryEpoch: number | null }>;
  needsAttention: AlertEvent[];
}
```

**Step 2: Add client methods**

```typescript
class WalWatchClient {
  // Schedules
  async listSchedules(orgId: string, params?: { type?: string }) { ... }
  async createSchedule(orgId: string, data: Partial<Schedule>) { ... }
  async updateSchedule(id: string, data: Partial<Schedule>) { ... }
  async deleteSchedule(id: string) { ... }

  // Dashboard
  async getDashboardSummary(orgId: string, projectId?: string): Promise<DashboardSummary> { ... }

  // Webhooks
  async listWebhooks(orgId: string) { ... }
  async createWebhook(orgId: string, data: Partial<Webhook>) { ... }
  async updateWebhook(id: string, data: Partial<Webhook>) { ... }
  async deleteWebhook(id: string) { ... }
  async testWebhook(id: string) { ... }

  // Alert Events
  async listAlertEvents(orgId: string, params?: { status?: string }) { ... }
  async acknowledgeAlertEvent(id: string) { ... }

  // Budgets
  async listBudgets(orgId: string) { ... }
  async createBudget(orgId: string, data: Partial<Budget>) { ... }

  // Spending Limits
  async listSpendingLimits(orgId: string) { ... }
  async createSpendingLimit(orgId: string, data: Partial<SpendingLimit>) { ... }

  // Admin
  async adminGetHealth(): Promise<AdminHealth> { ... }
  async adminGetQueues(): Promise<QueueStatus[]> { ... }
  async adminTriggerScan(justification: string): Promise<void> { ... }
}
```

**Step 3: Update CLI**

Add commands:
- `walwatch schedules list|create|update|delete`
- `walwatch dashboard summary`
- `walwatch webhooks list|create|update|delete|test`
- `walwatch alerts list|acknowledge`
- `walwatch budgets list|create`
- `walwatch spending-limits list|create`
- `walwatch admin health|queues|trigger-scan`

---

### Task 10: Edge Cases Implementation (spec 27)

**Files:**
- Create: `api/src/lib/edge-cases.ts`
- Modify: `api/src/routes/policies.ts` (snapshot policy config on renewal)
- Modify: `api/src/routes/renewal-jobs.ts` (store policy version, budget snapshot)
- Modify: `keeper/src/executor.ts` (verify on-chain state before resubmit)

**Step 1: Implement edge case handlers**

```typescript
/**
 * Edge case: Concurrent policy edit during in-progress renewal.
 * Resolution: Renewal stores policy snapshot at start time.
 */
export function snapshotPolicyOnStart(policy: any): Record<string, unknown> {
  return {
    policyId: policy.id,
    policyName: policy.name,
    renewThreshold: policy.renewThreshold,
    renewExtension: policy.renewExtension,
    active: policy.active,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Edge case: Budget window rollover mid-renewal.
 * Resolution: Budget check done at start stands — not re-evaluated.
 */
export function freezeBudgetCheck(budgetCheck: any, at: Date): Record<string, unknown> {
  return {
    ...budgetCheck,
    checkedAt: at.toISOString(),
  };
}

/**
 * Edge case: Wallet disconnected while blobs are protected.
 * Resolution: Blobs -> Tracked (monitoring continues, auto-renewal stops).
 */
export async function handleWalletDisconnected(walletId: string): Promise<void> {
  const db = getDb();
  const blobs = await db.select().from(blobRegistrations)
    .where(and(
      eq(blobRegistrations.walletId, walletId),
      sql`status IN ('protected')`,
    ));
  for (const blob of blobs) {
    await db.update(blobRegistrations)
      .set({ status: 'tracked', updatedAt: new Date() })
      .where(eq(blobRegistrations.id, blob.id));
    emit(createEvent(
      EventNames.BLOB_TRACKED, blob.orgId, 'blob_registration', blob.id,
      { type: 'system' },
      { previousStatus: 'protected', reason: 'wallet_disconnected' },
    ));
  }
}

/**
 * Edge case: Publisher fails mid-renewal after partial on-chain effect.
 * Resolution: Verify on-chain state via Aggregator before resubmitting.
 */
export async function verifyOnChainStateBeforeRetry(blobId: string, aggregatorUrl: string): Promise<{ verified: boolean; currentState: any }> {
  try {
    const response = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}/status`);
    const state = await response.json();
    return { verified: true, currentState: state };
  } catch {
    return { verified: false, currentState: null };
  }
}
```

---

### Task 11: Testing (spec 21)

**Files:**
- Create: `api/src/__tests__/state-machines.test.ts`
- Create: `api/src/__tests__/event-bus.test.ts`
- Create: `api/src/__tests__/cost-engine.test.ts`
- Create: `api/src/__tests__/policy-engine.test.ts`
- Create: `api/src/__tests__/invariants.test.ts`
- Create: `api/src/__tests__/error-classification.test.ts`

**Step 1: State machine transition tests**

```typescript
import { validateTransition, validNextStates, isTerminal } from '../lib/state-machine.js';
import { StateTransitionError } from '../lib/state-machine.js';

describe('Blob state machine', () => {
  test('allows discovered -> verified', () => {
    expect(() => validateTransition('blob', 'discovered', 'verified')).not.toThrow();
  });
  
  test('rejects discovered -> expired directly', () => {
    expect(() => validateTransition('blob', 'discovered', 'expired')).toThrow(StateTransitionError);
  });
  
  test('rejects deleted -> any other state', () => {
    expect(() => validateTransition('blob', 'deleted', 'tracked')).toThrow(StateTransitionError);
  });
  
  test('rejects expired -> renewing directly', () => {
    expect(() => validateTransition('blob', 'expired', 'renewing')).toThrow(StateTransitionError);
  });

  test('allows archived -> deleted (manual)', () => {
    expect(() => validateTransition('blob', 'archived', 'deleted')).not.toThrow();
  });
});
```

**Step 2: Event bus tests**

```typescript
import { subscribe, emit, clearSubscribers, EventNames } from '../lib/event-bus.js';

describe('Event Bus', () => {
  beforeEach(() => clearSubscribers());
  
  test('dispatches events to matching subscribers', async () => {
    const received: any[] = [];
    subscribe(EventNames.BLOB_RENEWED, async (event) => { received.push(event); });
    await emit({ eventName: EventNames.BLOB_RENEWED, ... });
    expect(received).toHaveLength(1);
  });
  
  test('handles multiple subscribers for same event', async () => { ... });
  test('unsubscribe removes handler', async () => { ... });
  test('handler error does not crash emitter', async () => { ... });
});
```

**Step 3: Cost engine tests**

```typescript
describe('Cost Engine', () => {
  test('blocks renewal when spending limit would be exceeded', async () => {
    const result = await costEngine.checkBudgetBeforeExecution(
      testOrgId, null, testWalletId, null, 1000000, // huge cost
    );
    expect(result.allowed).toBe(false);
    expect(result.hardLimitBlocked).toBe(true);
  });
  
  test('allows renewal within budget', async () => { ... });
  test('fires alert on soft threshold crossing', async () => { ... });
});
```

**Step 4: Policy engine tests**

```typescript
describe('Policy Engine', () => {
  test('resolves blob-level policy over project-level', async () => { ... });
  test('deterministic: same inputs produce same output', async () => {
    const result1 = await policyEngine.resolveEffectivePolicy(blobId);
    const result2 = await policyEngine.resolveEffectivePolicy(blobId);
    expect(result1).toEqual(result2);
  });
  test('falls back to system default when no policy applies', async () => { ... });
});
```

**Step 5: Invariant tests**

```typescript
describe('Data Model Invariants', () => {
  test('rejects duplicate wallet address in same project', async () => {
    await expect(
      invariantChecker.ensureUniqueWalletAddress(orgId, projectId, address)
    ).rejects.toThrow('already exists');
  });
  
  test('allows same address in different projects', async () => { ... });
  
  test('prevents concurrent in_progress renewals for same blob', async () => {
    await invariantChecker.ensureNoActiveRenewal(blobId); // first call passes
    // Simulate an in_progress job
    await expect(
      invariantChecker.ensureNoActiveRenewal(blobId)
    ).rejects.toThrow('already has an in_progress renewal');
  });
});
```

**Step 6: Error classification tests**

```typescript
describe('Error Classification', () => {
  test('transient errors are retryable', () => { ... });
  test('persistent errors are not retryable', () => { ... });
  test('systemic errors produce operational alerts', () => { ... });
  test('partial errors report per-item', () => { ... });
});
```

---

### Task 12: Compile Check & Final Alignment

**Files:** All modified files across all packages

**Step 1: Check all packages compile**

```bash
cd api && npx tsc --noEmit && echo "API OK" && cd ..
cd keeper && npx tsc --noEmit && echo "Keeper OK" && cd ..
cd sdk && npx tsc --noEmit && echo "SDK OK" && cd ..
cd cli && npx tsc --noEmit && echo "CLI OK" && cd ..
cd contracts && npx tsc --noEmit && echo "Contracts OK" && cd ..
```

**Step 2: Run test suite**

```bash
cd api && npx vitest run --reporter verbose
```

**Step 3: Verify all route registrations in index.ts**

Ensure every route file is imported and registered in `api/src/index.ts`.

**Step 4: Update BUILD_STATUS.md**

Mark all completed modules as `done`.

---

## Self-Review Checklist

- [ ] Spec 01 Philosophy: Every task preserves automation, observability, data safety guarantees
- [ ] Spec 03 Domain Model: All 16+ entities mapped to code (done in existing schema)
- [ ] Spec 04 Architecture: Event bus + workers pattern followed throughout
- [ ] Spec 05 Data Model: Task 7 enforces all 8 invariants
- [ ] Spec 06 Permissions: RBAC middleware used on all routes (existing)
- [ ] Spec 07 Blob Lifecycle: State machine enforced (Task 1 in existing code)
- [ ] Spec 08 Renewal Engine: Task 8 — queue-driven with dedup, idempotency, retry
- [ ] Spec 09 Policy Engine: Task 5 — inheritance + conflict resolution
- [ ] Spec 10 Scheduler: Task 1 — declarative DB-backed schedules
- [ ] Spec 11 Cost Engine: Task 4 — estimate-before-execute, budget/limit enforcement
- [ ] Spec 12 Notification Engine: Task 6 — channel abstraction + delivery
- [ ] Spec 13 Dashboard Rules: Task 2 — "needs attention" aggregation endpoint
- [ ] Spec 14 API Rules: Cursor pagination, idempotency keys, bulk/async (existing pattern)
- [ ] Spec 15 UI System: Not code — frontend project (separate)
- [ ] Spec 16 Background Jobs: Queue architecture, restartability, poison-pill (existing)
- [ ] Spec 17 Security: Secrets management (existing), webhook signing (existing in event-bus)
- [ ] Spec 18 Observability: Audit log + Activity Feed + metrics (existing)
- [ ] Spec 19 Scalability: Statelessness above DB (existing architecture)
- [ ] Spec 20 Error Handling: 4-class taxonomy (existing in errors.ts)
- [ ] Spec 21 Testing: Task 11 — 6 test files covering 7 categories
- [ ] Spec 22 Non-Functional: Latency targets (dashboard query design)
- [ ] Spec 23 Decision Rules: Reference (followed throughout)
- [ ] Spec 24 Future Extensions: Not building, architecture accommodates
- [ ] Spec 25 State Machines: Task 1 + existing — all 10+ state machines
- [ ] Spec 26 Event Definitions: Existing event-bus.ts — 42 events
- [ ] Spec 27 Edge Cases: Task 10 — 5 cross-cutting edge case handlers
- [ ] Spec 28 CLI/SDK: Task 9 — sync all new entities
- [ ] Spec 29 Admin/Internal Tools: Task 3 — admin routes, feature flags, experiments
