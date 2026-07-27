/**
 * Scheduler Engine (spec 10)
 *
 * Declarative scheduling model — schedules are first-class, inspectable
 * configurations. The engine provides:
 *   - Handler registry for extensibility (new work types register without
 *     modifying core mechanism)
 *   - Cross-instance safety via PostgreSQL advisory locks
 *   - Window-based tracking for deterministic restart behavior
 *   - Configurable missed-run detection with escalation
 *   - Run history recording for observability
 */

import { getDb } from './db.js';
import cron from 'node-cron';
import { logger as rootLogger } from './logger.js';
import { runCleanup } from './cleanup-jobs.js';
import { SuiClient } from '@mysten/sui/client';
import { validateTransition } from '../../api/src/lib/state-machine.js';
import { emit, createEvent, EventNames } from '../../api/src/lib/event-bus.js';
import { policyEngine } from '../../api/src/lib/policy-engine.js';
import { reconcilePolicies } from './policy-reconciler.js';
import { publishJob, completeJob, failJob } from '../../api/src/lib/queue.js';

const logger = rootLogger.child({ component: 'scheduler' });

// ── Handler Registry (spec 10 extensibility) ──────────────────────────
// New schedule work types register themselves here. The scheduler core
// dispatches solely through this registry — no hardcoded switch statement.

interface ScheduleHandler {
  /** Unique type identifier matching schedule config.type */
  type: string;
  /** Execute the handler. Return true on success, false on failure. */
  execute(schedule: ScheduleConfig, db: ReturnType<typeof getDb>): Promise<boolean>;
}

const handlerRegistry = new Map<string, ScheduleHandler>();

export function registerScheduleHandler(handler: ScheduleHandler): void {
  if (handlerRegistry.has(handler.type)) {
    logger.warn({ type: handler.type }, 'Overwriting existing schedule handler');
  }
  handlerRegistry.set(handler.type, handler);
  logger.info({ type: handler.type }, 'Schedule handler registered');
}

// ── Configuration ─────────────────────────────────────────────────────

interface ScheduleConfig {
  id: string;
  org_id: string;
  name: string;
  cron_expr: string;
  last_run_at: Date | null;
  last_completed_at: Date | null;
  enabled: boolean;
  status: string | null;
  min_interval_ms: number | null;
  max_staleness_ms: number | null;
  config: Record<string, unknown>;
  critical?: boolean;
}

// ── Epoch Helper ────────────────────────────────────────────────

let _epochClient: SuiClient | null = null;

function getSuiClient(): SuiClient {
  if (!_epochClient) {
    _epochClient = new SuiClient({
      url: process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443',
    });
  }
  return _epochClient;
}

async function getCurrentEpoch(): Promise<number> {
  const client = getSuiClient();
  const seq = await client.getLatestCheckpointSequenceNumber();
  const checkpoint = await client.getCheckpoint({ id: seq });
  return Number(checkpoint.epoch);
}

// ═══════════════════════════════════════════════════════════════════════
// Built-in Handlers
// ═══════════════════════════════════════════════════════════════════════

// ── Task 5.4: expiry_check uses policy engine inheritance ───────
registerScheduleHandler({
  type: 'expiry_check',
  async execute(schedule, db) {
    const currentEpoch = await getCurrentEpoch();
    // renewThreshold is in epochs (not seconds) — it represents the minimum
    // number of epochs remaining before expiry to trigger renewal
    const MIN_RENEW_THRESHOLD = 1;
    const candidates = await db`
      SELECT id, org_id, expiry_epoch FROM blob_registrations
      WHERE status IN ('tracked', 'protected') AND expiry_epoch IS NOT NULL
        AND org_id = ${schedule.org_id}
    `;
    const toExpire: string[] = [];
    for (const blob of candidates as any[]) {
      try {
        const resolved = await policyEngine.resolveEffectivePolicy(blob.id);
        const thresholdInEpochs = Math.max(MIN_RENEW_THRESHOLD, resolved.renewThreshold);
        if ((Number(blob.expiry_epoch) - currentEpoch) < thresholdInEpochs) {
          toExpire.push(blob.id);
        }
      } catch (err) {
        logger.warn({ blobId: blob.id, error: err }, 'Failed to resolve policy for expiry check');
      }
    }
    if (toExpire.length > 0) {
      await db`
        UPDATE blob_registrations SET status = 'expiring', expiring_at = now(), updated_at = now()
        WHERE id = ANY(${toExpire}) AND status IN ('tracked', 'protected')
      `;
    }
    logger.info({ candidates: candidates.length, markedExpiring: toExpire.length }, 'Expiry check completed');
    return true;
  },
});

// ── Task 5.1: Automated discovered→verified→tracked pipeline ───
registerScheduleHandler({
  type: 'blob_verification',
  async execute(_schedule, db) {
    const blobs = await db`
      SELECT * FROM blob_registrations WHERE status = 'discovered'
    `;
    let verified = 0;
    let archived = 0;
    for (const blob of blobs as any[]) {
      if (blob.blob_id && blob.blob_id.length > 0) {
        validateTransition('blob', 'discovered', 'verified');
        await db`
          UPDATE blob_registrations SET status = 'verified', verified_at = now(), updated_at = now()
          WHERE id = ${blob.id} AND status = 'discovered'
        `;
        await emit(createEvent('blob.verified', blob.org_id, 'blob_registration', blob.id, { type: 'system' }));
        validateTransition('blob', 'verified', 'tracked');
        await db`
          UPDATE blob_registrations SET status = 'tracked', tracked_at = now(), updated_at = now()
          WHERE id = ${blob.id} AND status = 'verified'
        `;
        await emit(createEvent('blob.tracked', blob.org_id, 'blob_registration', blob.id, { type: 'system' }));
        verified++;
      } else {
        validateTransition('blob', 'discovered', 'archived');
        await db`
          UPDATE blob_registrations SET status = 'archived', archived_at = now(), updated_at = now()
          WHERE id = ${blob.id} AND status = 'discovered'
        `;
        await emit(createEvent('blob.archived', blob.org_id, 'blob_registration', blob.id, { type: 'system' }, { reason: 'blob_not_found' }));
        archived++;
      }
    }
    logger.info({ verified, archived }, 'Blob verification completed');
    return true;
  },
});

registerScheduleHandler({
  type: 'budget_rollover',
  async execute(schedule) {
    const db = getDb();
    const expiredBudgets = await db`
      SELECT * FROM budgets
      WHERE org_id = ${schedule.org_id}
        AND status = 'active'
        AND window_end IS NOT NULL
        AND window_end <= now()
    `;
    for (const budget of expiredBudgets as any[]) {
      try {
        if (!budget.window_end) {
          logger.warn({ budgetId: budget.id }, 'Budget has no window_end — skipping');
          continue;
        }
        const windowDuration = new Date(budget.window_end).getTime() - new Date(budget.window_start).getTime();
        const newStart = new Date(budget.window_end);
        const newEnd = new Date(newStart.getTime() + windowDuration);

        await db.begin(async (tx) => {
          await tx`
            UPDATE budgets SET status = 'window_closed'
            WHERE id = ${budget.id}
          `;
          await tx`
            UPDATE budgets SET status = 'active', window_start = ${newStart}, window_end = ${newEnd}
            WHERE id = ${budget.id}
          `;
        });

        await emit(createEvent(
          EventNames.BUDGET_WINDOW_ROLLED_OVER,
          budget.org_id,
          'budget',
          budget.id,
          { type: 'system' },
          {
            budgetId: budget.id,
            previousWindowEnd: new Date(budget.window_end).toISOString(),
            newWindowStart: newStart.toISOString(),
            newWindowEnd: newEnd.toISOString(),
          },
        ));
      } catch (error) {
        logger.error({ budgetId: budget.id, error }, 'Failed to roll over budget window');
      }
    }
    return true;
  },
});

registerScheduleHandler({
  type: 'cleanup',
  async execute() {
    const results = await runCleanup();
    logger.info({ results }, 'Cleanup completed');
    return true;
  },
});

// ── Task 5.2: Automated tracked↔protected ─────────────────────
registerScheduleHandler({
  type: 'policy_reconciliation',
  async execute(schedule, db) {
    const result = await reconcilePolicies(db, schedule.org_id);
    logger.info(result, 'Policy reconciliation completed');
    return true;
  },
});

// ── Task 5.3: Automated expiring→expired transition ───────────
registerScheduleHandler({
  type: 'expire_blobs',
  async execute(schedule, db) {
    const currentEpoch = await getCurrentEpoch();
    const expiringBlobs = await db`
      SELECT id, org_id FROM blob_registrations
      WHERE status = 'expiring' AND expiry_epoch IS NOT NULL AND expiry_epoch < ${currentEpoch}
        AND org_id = ${schedule.org_id}
    `;
    for (const blob of expiringBlobs as any[]) {
      validateTransition('blob', 'expiring', 'expired');
      await db`
        UPDATE blob_registrations SET status = 'expired', expired_at = now(), updated_at = now()
        WHERE id = ${blob.id} AND status = 'expiring'
      `;
      await emit(createEvent('blob.expired', blob.org_id, 'blob_registration', blob.id, { type: 'system' }, { currentEpoch }));
    }
    logger.info({ count: expiringBlobs.length }, 'Blobs expired');
    return true;
  },
});

// ── Orphan check: archive blobs with missing wallets ──────────
registerScheduleHandler({
  type: 'orphan_check',
  async execute(_schedule, db) {
    const orphans = await db`
      SELECT br.id, br.org_id FROM blob_registrations br
      LEFT JOIN wallets w ON w.id = br.wallet_id
      WHERE w.id IS NULL AND br.deleted_at IS NULL AND br.status != 'archived'
    `;
    let resolved = 0;
    for (const blob of orphans as any[]) {
      await db`
        UPDATE blob_registrations SET status = 'archived', archived_at = now(), updated_at = now()
        WHERE id = ${blob.id} AND status != 'archived'
      `;
      await emit(createEvent('blob.archived', blob.org_id, 'blob_registration', blob.id, { type: 'system' }, { reason: 'orphaned_wallet' }));
      resolved++;
    }
    logger.info({ detected: orphans.length, resolved }, 'Orphan check completed');
    return true;
  },
});

// ═══════════════════════════════════════════════════════════════════════
// Event Emission
// ═══════════════════════════════════════════════════════════════════════

async function emitScheduleEvent(
  eventName: string,
  scheduleId: string,
  orgId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  logger.info({ eventName, scheduleId, orgId, details }, `Schedule event: ${eventName}`);
  try {
    await emit(createEvent(
      eventName as any,
      orgId,
      'schedule',
      scheduleId,
      { type: 'system' },
      details,
    ));
  } catch {
    // Best-effort — event bus persistence is optional
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Run History
// ═══════════════════════════════════════════════════════════════════════

interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  orgId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
}

async function recordRunStart(
  scheduleId: string,
  orgId: string,
  db: ReturnType<typeof getDb>,
): Promise<string> {
  const [row] = await db`
    INSERT INTO schedule_runs (schedule_id, org_id, status, started_at)
    VALUES (${scheduleId}, ${orgId}, 'running', now())
    RETURNING id
  `;
  return (row as { id: string }).id;
}

async function recordRunComplete(
  runId: string,
  status: 'completed' | 'failed',
  startedAt: Date,
  error?: string,
  db?: ReturnType<typeof getDb>,
): Promise<void> {
  const queryDb = db ?? getDb();
  try {
    await queryDb`
      UPDATE schedule_runs
      SET status = ${status},
          completed_at = now(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
          error = ${error ?? null}
      WHERE id = ${runId}
    `;
  } catch {
    // Best-effort logging — observability should not break scheduling
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Window Computation (Determinism — pure function of config + time +
// last-run record)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Minimum number of missed windows before triggering an operational alert
 * escalation (spec 10: "missed beyond a threshold that could risk a core
 * guarantee").
 */
const MISSED_WINDOW_ESCALATION_THRESHOLD = 3;
const MISSED_WINDOW_CATCHUP_BATCH_LIMIT = 50;
const NON_CRITICAL_ESCALATION_THRESHOLD = 10;
const CRITICAL_SCHEDULE_TYPES = new Set(['expiry_check', 'budget_rollover', 'expire_blobs']);
const CATCHUP_PRIORITY = 50;

/**
 * Compute the number of missed execution windows given a cron expression,
 * the last completed timestamp, and the current time.
 *
 * This is a simplified heuristic: for typical schedules (every N minutes,
 * every hour, daily), we approximate by dividing elapsed time by the
 * interval implied by the cron expression. For complex cron expressions
 * the approximation is conservative — it may over-count missed windows,
 * which is safe (prefer extra catch-up to silent skipping).
 */
function computeMissedWindows(
  cronExpr: string,
  lastCompletedAt: Date | null,
  now: Date,
): number {
  if (!lastCompletedAt) return 0;

  const elapsedMs = now.getTime() - new Date(lastCompletedAt).getTime();
  if (elapsedMs <= 0) return 0;

  // Parse common cron patterns to determine interval
  const intervalMs = parseCronInterval(cronExpr);
  if (intervalMs <= 0) return 1; // Unknown pattern — assume 1 missed

  const missed = Math.floor(elapsedMs / intervalMs);
  return Math.max(0, missed - 1); // Subtract 1 for the current window
}

/**
 * Parse a cron expression to estimate its interval in milliseconds.
 * Handles common patterns: star-slash-N, fixed intervals (0,5,10...), simple hourly/daily.
 * Returns 0 for unsupported expressions (will conservatively assume 1 missed).
 */
function parseCronInterval(cronExpr: string): number {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return 0;

  const minute = parts[0];
  const hour = parts[1];
  const dayOfMonth = parts[2];
  const month = parts[3];
  const dayOfWeek = parts[4];

  // */N pattern in minutes — interval = N * 60000
  const minMatch = minute.match(/^\*\/(\d+)$/);
  if (minMatch) return parseInt(minMatch[1], 10) * 60_000;

  // Every N hours: 0 */2 * * * → interval = N * 3600000
  const hourMatch = hour.match(/^\*\/(\d+)$/);
  if (hourMatch && minute === '0') return parseInt(hourMatch[1], 10) * 3_600_000;

  // Fixed minute intervals like "0,15,30,45"
  if (minute.includes(',')) {
    const parts = minute.split(',').map(Number).filter((n) => !isNaN(n));
    if (parts.length >= 2) {
      parts.sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        gaps.push(parts[i] - parts[i - 1]);
      }
      // Add wrap-around gap
      gaps.push(60 - parts[parts.length - 1] + parts[0]);
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      return avgGap * 60_000;
    }
  }

  // Every minute: * * * * *
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return 60_000;
  }

  // Every hour: 0 * * * *
  if (minute === '0' && hour === '*') return 3_600_000;

  // Once daily: 0 0 * * * or 0 5 * * * etc.
  if (minute === '0' && hour !== '*' && hour.indexOf('/') === -1) return 86_400_000;

  // Default: unknown pattern, return 0 (caller will assume 1 missed)
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Scheduler Engine
// ═══════════════════════════════════════════════════════════════════════

export class SchedulerEngine {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private running = false;

  async loadAndStart(): Promise<void> {
    this.running = true;
    const db = getDb();
    const activeSchedules: ScheduleConfig[] = await db`
      SELECT * FROM schedules WHERE enabled = true AND (status IS NULL OR status != 'deleted')
    `;

    for (const schedule of activeSchedules) {
      scheduleTaskSafe(this, schedule);
    }
    logger.info({ count: activeSchedules.length }, 'Scheduler loaded schedules');

    // ── Missed-run detection and catch-up ──────────────────────────
    // Spec 10: missed runs are caught up unless catching up would violate
    // guarantees. Catch-up runs are queued, not executed inline at full
    // priority (to avoid contending with time-critical renewal jobs).
    const now = new Date();
    for (const schedule of activeSchedules) {
      await this.handleMissedRuns(schedule, now);
    }

    // ── Start catch-up job consumer ───────────────────────────────
    this.startCatchupConsumer();
  }

  /**
   * Handle missed-run detection, catch-up, and escalation per spec 10.
   *
   * Strategy:
   *   1. Compute number of missed windows since last_completed_at
   *   2. If missed >= escalation threshold → emit operational alert
   *      (only critical schedules escalate; non-critical log a warning)
   *   3. Queue ALL missed windows (up to batch limit) via the job queue
   *      with lower priority (50) than real-time jobs (10), most recent
   *      first, so the most important catch-up runs first
   */
  private async handleMissedRuns(schedule: ScheduleConfig, now: Date): Promise<void> {
    if (!schedule.last_completed_at) return;

    const elapsedMs = now.getTime() - new Date(schedule.last_completed_at).getTime();
    const stalenessThreshold = schedule.max_staleness_ms ?? 300_000;
    const missedWindows = computeMissedWindows(schedule.cron_expr, schedule.last_completed_at, now);

    if (missedWindows <= 0 && elapsedMs < stalenessThreshold) return;

    // Log the miss
    logger.warn({
      scheduleId: schedule.id,
      name: schedule.name,
      elapsedMs,
      missedWindows,
    }, 'Schedule may have missed runs');

    await emitScheduleEvent('schedule.missed', schedule.id, schedule.org_id, {
      elapsedMs,
      missedWindows,
    });

    // ── Escalation — critical vs. non-critical ────────────────────
    const configType = (schedule.config as { type?: string })?.type || 'unknown';
    const isCritical = schedule.critical ?? CRITICAL_SCHEDULE_TYPES.has(configType);
    const escalationThreshold = isCritical ? MISSED_WINDOW_ESCALATION_THRESHOLD : NON_CRITICAL_ESCALATION_THRESHOLD;

    if (missedWindows >= escalationThreshold) {
      if (isCritical) {
        logger.error({
          scheduleId: schedule.id,
          name: schedule.name,
          missedWindows,
        }, 'Schedule missed critical threshold — escalating');
        await emitScheduleEvent('schedule.missed_critical', schedule.id, schedule.org_id, {
          elapsedMs,
          missedWindows,
          threshold: escalationThreshold,
        });
      } else {
        logger.warn({
          scheduleId: schedule.id,
          name: schedule.name,
          missedWindows,
        }, 'Non-critical schedule missed threshold — skipping escalation');
      }
    }

    // ── Catch-up: queue all missed windows (most recent first) ────
    const missedCount = Math.min(missedWindows, MISSED_WINDOW_CATCHUP_BATCH_LIMIT);
    logger.info({ scheduleId: schedule.id, missedCount }, 'Catching up missed windows');

    const intervalMs = parseCronInterval(schedule.cron_expr) || 60_000;
    for (let i = missedCount; i > 0; i--) {
      const missedAt = new Date(now.getTime() - (i - 1) * intervalMs);
      await publishJob({
        type: 'schedule_catchup',
        payload: { scheduleId: schedule.id, type: configType, orgId: schedule.org_id, missedAt: missedAt.toISOString() },
        entityType: 'schedule',
        entityId: schedule.id,
        priority: CATCHUP_PRIORITY,
        maxAttempts: 3,
        scheduledFor: new Date(),
      });
    }

    await emitScheduleEvent('schedule.caught_up', schedule.id, schedule.org_id, {
      elapsedMs,
      missedWindows,
      catchupCount: missedCount,
    });
  }

  scheduleTask(schedule: ScheduleConfig): void {
    if (this.tasks.has(schedule.id)) {
      this.tasks.get(schedule.id)!.stop();
    }

    const task = cron.schedule(schedule.cron_expr, async () => {
      await this.executeSchedule(schedule.id);
    });
    this.tasks.set(schedule.id, task);
  }

  /**
   * Execute a schedule with cross-instance safety via PostgreSQL
   * advisory lock. If another scheduler instance is already executing
   * this schedule, the call returns immediately (no double-trigger).
   *
   * Implements spec 10's determinism & idempotency requirement:
   * - Coordination to avoid duplicate triggers across instances
   * - Config + current time + last-run record as pure evaluation
   */
  private async executeSchedule(scheduleId: string): Promise<void> {
    const db = getDb();
    const now = new Date();

    // ── Cross-instance lock ───────────────────────────────────────
    // Use a PostgreSQL advisory lock keyed on a hash of the schedule ID.
    // If the lock cannot be acquired immediately, another instance is
    // already handling this schedule.
    const lockKey = this.hashScheduleId(scheduleId);
    const lockAcquired = await db`
      SELECT pg_try_advisory_lock(${lockKey}) AS locked
    `;
    const locked = (lockAcquired[0] as { locked: boolean }).locked;
    if (!locked) {
      logger.debug({ scheduleId }, 'Schedule locked by another instance — skipping');
      return;
    }

    try {
      // Re-fetch schedule from DB to avoid stale closure
      const rows = await db`
        SELECT * FROM schedules WHERE id = ${scheduleId}
      `;
      const schedule = rows[0] as unknown as ScheduleConfig | undefined;
      if (!schedule) {
        logger.warn({ scheduleId }, 'Schedule not found in DB — skipping');
        return;
      }

      // ── Min-interval guard ──────────────────────────────────────
      // Spec 10: user-configurable schedules have system-enforced
      // minimum interval.
      if (schedule.last_run_at && schedule.min_interval_ms) {
        const elapsed = now.getTime() - new Date(schedule.last_run_at).getTime();
        if (elapsed < schedule.min_interval_ms) {
          logger.debug({ scheduleId: schedule.id, name: schedule.name }, 'Schedule deferred — min interval not elapsed');
          return;
        }
      }

      // ── Atomic last_run_at update (idempotency guard) ───────────
      // Update last_run_at atomically. If another instance already
      // updated it (since our lock), the WHERE clause ensures we
      // don't double-execute.
      const [updatedResult] = await db`
        UPDATE schedules
        SET last_run_at = ${now}, updated_at = ${now}
        WHERE id = ${schedule.id}
          AND (last_run_at IS NULL OR last_run_at < ${now})
      `;
      if (updatedResult.count === 0) {
        logger.debug({ scheduleId }, 'Schedule already updated — skipping');
        return;
      }

      // ── Record run start ────────────────────────────────────────
      const runId = await recordRunStart(schedule.id, schedule.org_id, db);
      logger.info({ scheduleId: schedule.id, name: schedule.name }, 'Executing schedule');

      // ── Dispatch via handler registry (extensibility) ───────────
      const configType = (schedule.config as { type?: string })?.type || 'unknown';
      const handler = handlerRegistry.get(configType);
      let success = false;

      if (handler) {
        try {
          success = await handler.execute(schedule, db);
        } catch (error) {
          logger.error({ scheduleId: schedule.id, name: schedule.name, configType, error }, 'Handler execution failed');
          success = false;
        }
      } else {
        logger.warn({ scheduleId: schedule.id, configType }, 'Unknown schedule config type — no handler registered');
      }

      // ── Record completion ───────────────────────────────────────
      if (success) {
        await db`
          UPDATE schedules
          SET last_completed_at = ${now}, updated_at = ${now}
          WHERE id = ${schedule.id}
        `;
        await recordRunComplete(runId, 'completed', now, undefined, db);
        logger.info({ scheduleId: schedule.id, name: schedule.name }, 'Schedule completed');
      } else {
        await recordRunComplete(runId, 'failed', now, 'Handler returned false or threw', db);
        logger.error({ scheduleId: schedule.id, name: schedule.name }, 'Schedule execution failed');
      }
    } catch (error) {
      logger.error({ scheduleId, error }, 'Schedule execution error');
    } finally {
      // Release the advisory lock
      try {
        await db`SELECT pg_advisory_unlock(${lockKey})`;
      } catch {
        // Best-effort unlock
      }
    }
  }

  async reloadSchedule(scheduleId: string): Promise<void> {
    const db = getDb();
    const rows = await db`
      SELECT * FROM schedules WHERE id = ${scheduleId}
    `;
    if (rows.length > 0) {
      scheduleTaskSafe(this, rows[0] as unknown as ScheduleConfig);
    }
  }

  stop(): void {
    for (const [, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    this.running = false;
    logger.info('Scheduler stopped');
  }

  /**
   * Background consumer for catch-up jobs queued by handleMissedRuns.
   * Polls job_queue for 'schedule_catchup' entries, dispatches via the
   * handler registry, and acknowledges (completes) the job on success.
   */
  private startCatchupConsumer(): void {
    if (!this.running) return;

    const poll = async () => {
      while (this.running) {
        try {
          const db = getDb();
          const [job] = await db`
            SELECT * FROM job_queue
            WHERE status = 'queued' AND type = 'schedule_catchup'
            ORDER BY priority ASC, scheduled_for ASC
            LIMIT 1
          `;

          if (job) {
            const j = job as any;
            const payload = typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload;

            await db`
              UPDATE job_queue SET status = 'processing', started_at = now()
              WHERE id = ${j.id} AND status = 'queued'
            `;

            const [scheduleRow] = await db`
              SELECT * FROM schedules WHERE id = ${payload.scheduleId}
            `;

            if (scheduleRow) {
              const schedule = scheduleRow as unknown as ScheduleConfig;
              const handler = handlerRegistry.get(payload.type);
              if (handler) {
                try {
                  const success = await handler.execute(schedule, db);
                  if (success) {
                    await completeJob(j.id);
                    // Advance last_completed_at so missed detection makes progress
                    await db`
                      UPDATE schedules SET last_completed_at = now(), updated_at = now()
                      WHERE id = ${schedule.id}
                    `;
                  } else {
                    await failJob(j.id, 'Handler returned false');
                  }
                } catch (error) {
                  await failJob(j.id, String(error));
                }
              } else {
                await failJob(j.id, `No handler for type: ${payload.type}`);
              }
            } else {
              await failJob(j.id, 'Schedule not found');
            }
          }
        } catch (err) {
          logger.error({ error: err }, 'Catchup consumer error');
        }
        const jitter = Math.round(Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, 2000 + jitter));
      }
    };
    poll();
  }

  /**
   * Deterministic hash of schedule ID for advisory lock key.
   * Simple FNV-1a hash to convert UUID to int64-compatible number.
   */
  private hashScheduleId(id: string): number {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    // Ensure positive 32-bit integer
    return hash >>> 0;
  }
}

function scheduleTaskSafe(engine: SchedulerEngine, schedule: ScheduleConfig): void {
  try {
    engine.scheduleTask(schedule);
  } catch (error) {
    logger.error({
      scheduleId: schedule.id,
      name: schedule.name,
      cronExpr: schedule.cron_expr,
      error,
    }, 'Failed to schedule task — invalid cron expression');
  }
}
