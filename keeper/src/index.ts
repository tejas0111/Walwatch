/**
 * Auto-Renewal Keeper Worker
 *
 * Background service that scans RenewalVault objects on Sui and executes
 * due renewals. Permissionless — any keeper can call execute_renewal,
 * but this worker provides reliable, low-latency execution.
 *
 * Architecture:
 *   1. Poll all vaults due for renewal (via on-chain query)
 *   2. Batch-build execute_renewal transactions
 *   3. Submit using a dedicated gas-funded hot wallet
 *   4. Emit metrics and forward alerts to notification service
 *
 * Environment variables:
 *   SUI_RPC_URL              Sui RPC endpoint (default: testnet)
 *   KEEPER_PRIVATE_KEY       Ed25519 private key as base64 string
 *   SCAN_SCHEDULE            Cron schedule (default: every 2 minutes)
 *   MAX_VAULTS_PER_CYCLE     Max vaults to scan per cycle (default: 50)
 *   RETRY_DELAY_MS           Delay between retries (default: 5000)
 *   PACKAGE_ID               Deployed Move package ID (required)
 *   SYSTEM_OBJECT_ID         Walrus System shared object ID (required)
 *   DATABASE_URL             PostgreSQL connection string (optional, for leader election)
 *   ENABLE_LEADER_ELECTION   Enable leader election via PG advisory locks (default: false)
 *
 *   NOTIFICATION_EMAIL       Email address for alerts (optional)
 *   NOTIFICATION_WEBHOOK_URL Webhook URL for alerts (optional)
 *   NOTIFICATION_WEBHOOK_SECRET HMAC secret for webhook signing (optional)
 *   NOTIFICATION_FROM_EMAIL  Sender email for Resend (optional)
 *   RESEND_API_KEY           Resend API key for email alerts (optional)
 *
 * See spec.md §5 for full details.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import cron from 'node-cron';
import { logger } from './logger.js';
import { VaultScanner } from './scanner.js';
import { RenewalExecutor } from './executor.js';
import { MetricsCollector } from './metrics.js';
import { startMetricsServer } from './metrics-server.js';
import { createNotificationServiceFromEnv, getNotificationEngine } from './notification.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { withRetry, isRetryableJobError } from './retry.js';
import { JobMonitor } from './job-monitor.js';
import { createPoolFromEnv } from './sui-pool.js';
import { createRenewalJob } from './db-writer.js';
import { findBlobRegistrationByBlobId } from './vault-mapper.js';
import { SchedulerEngine } from './scheduler.js';
import { getDb } from './db.js';
// ── Shared library imports ───────────────────────────────────────────
// These modules are imported from the API package to avoid code duplication.
// They reside in api/src/lib/ and are considered a shared dependency.
// The API must be built/deployed alongside the keeper.
// In future, these should be extracted into a separate @walwatch/shared package.
import { emit, createEvent } from '../../api/src/lib/event-bus.js';
import { validateTransition } from '../../api/src/lib/state-machine.js';
import { policyEngine, type ResolvedPolicy } from '../../api/src/lib/policy-engine.js';
import { costEngine } from '../../api/src/lib/cost-engine.js';
import crypto from 'node:crypto';

function generateTraceId(): string {
  return crypto.randomUUID();
}
import { handleSystemicError } from './systemic-alert-handler.js';

/**
 * Emit a renewal event to BOTH the alert_events table (for notification delivery)
 * AND the audit_logs table (for compliance/audit trail — Spec 18).
 *
 * The audit_log entry uses 'system' as the actor since the keeper operates
 * autonomously. The traceId is constructed from the job ID for traceability.
 */
async function emitRenewalEvent(
  sql: any,
  subState: 'estimated' | 'started' | 'succeeded' | 'retrying' | 'failed_final' | 'blocked_by_budget' | 'budget_soft_threshold_crossed',
  orgId: string,
  renewalJobId: string,
  details?: Record<string, unknown>,
  traceId?: string,
): Promise<void> {
  try {
    const severity = subState === 'failed_final' || subState === 'blocked_by_budget' ? 'error' : 'info';
    const linkToEntity = details?.blobRegistrationId
      ? `https://walwatch.app/dashboard/blobs/${details.blobRegistrationId}`
      : `https://walwatch.app/dashboard/renewals/${renewalJobId}`;
    const detailsWithTrace = traceId ? { ...(details ?? {}), traceId } : (details ?? {});
    await sql`
      INSERT INTO alert_events (org_id, event_type, severity, message, details, status, fired_at, link_to_entity)
      VALUES (${orgId}, ${'renewal.' + subState}, ${severity}, ${'renewal_job.' + renewalJobId + ': renewal.' + subState}, ${detailsWithTrace}, 'fired', NOW(), ${linkToEntity})
    `;
    // Also write to audit_logs for compliance trail (Spec 18)
    // Attribution: details include triggeredBy context (Spec 17: no anonymous entries)
    const detailsWithAttribution = {
      ...(details ?? {}),
      triggeredBy: {
        cause: 'system:renewal_engine',
        renewalJobId,
        state: subState,
      },
    };
    await sql`
      INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details, trace_id)
      VALUES (${orgId}, NULL, ${'renewal.' + subState}, 'renewal_job', ${renewalJobId}, ${sql.json(detailsWithAttribution)}, ${traceId ?? null})
    `;
    // Also write to activity_feed for human-readable surface (Spec 18)
    await sql`
      INSERT INTO activity_feed (org_id, action, resource_type, resource_id, actor_type, actor_id, summary, details, trace_id)
      VALUES (
        ${orgId},
        ${'renewal.' + subState},
        'renewal_job',
        ${renewalJobId},
        'system',
        NULL,
        ${`Renewal ${subState} for job ${renewalJobId}`},
        ${sql.json(detailsWithAttribution)},
        ${traceId ?? null}
      )
    `;
  } catch (err) {
    logger.warn({ renewalJobId, subState, error: err instanceof Error ? err.message : String(err), traceId }, 'Failed to emit renewal event');
  }
}

/**
 * Emit a blob lifecycle event to BOTH alert_events AND audit_logs (Spec 18).
 */
async function emitBlobEvent(
  sql: any,
  state: 'expiring' | 'renewing' | 'renewed' | 'expired' | 'archived' | 'tracked' | 'protected',
  orgId: string,
  blobId: string,
  details?: Record<string, unknown>,
  traceId?: string,
): Promise<void> {
  try {
    const linkToEntity = `https://walwatch.app/dashboard/blobs/${blobId}`;
    const detailsWithTrace = traceId ? { ...(details ?? {}), traceId } : (details ?? {});
    await sql`
      INSERT INTO alert_events (org_id, event_type, severity, message, details, status, fired_at, link_to_entity)
      VALUES (${orgId}, ${'blob.' + state}, 'info', ${'blob_registration.' + blobId + ': blob.' + state}, ${detailsWithTrace}, 'fired', NOW(), ${linkToEntity})
    `;
    // Also write to audit_logs for compliance trail (Spec 18)
    // Attribution: details include triggeredBy context (Spec 17: no anonymous entries)
    const blobDetailsWithAttribution = {
      ...(details ?? {}),
      triggeredBy: {
        cause: 'system:blob_lifecycle',
        blobRegistrationId: blobId,
        state,
      },
    };
    await sql`
      INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details, trace_id)
      VALUES (${orgId}, NULL, ${'blob.' + state}, 'blob_registration', ${blobId}, ${sql.json(blobDetailsWithAttribution)}, ${traceId ?? null})
    `;
    // Also write to activity_feed for human-readable surface (Spec 18)
    await sql`
      INSERT INTO activity_feed (org_id, action, resource_type, resource_id, actor_type, actor_id, summary, details, trace_id)
      VALUES (
        ${orgId},
        ${'blob.' + state},
        'blob_registration',
        ${blobId},
        'system',
        NULL,
        ${`Blob ${state}: ${blobId}`},
        ${sql.json(blobDetailsWithAttribution)},
        ${traceId ?? null}
      )
    `;
  } catch (err) {
    logger.warn({ blobId, state, error: err instanceof Error ? err.message : String(err), traceId }, 'Failed to emit blob event');
  }
}

async function resolvePolicyForBlob(blobId: string): Promise<ResolvedPolicy> {
  const sql = getDb();
  const [registration] = await sql`
    SELECT id FROM blob_registrations WHERE blob_id = ${blobId} LIMIT 1
  `;
  if (registration) {
    return await policyEngine.resolveEffectivePolicy(registration.id);
  }
  return {
    policyId: null,
    policyName: null,
    renewThreshold: 0,
    renewExtension: 0,
    maxTotalEpochs: null,
    autoRenewalEnabled: false,
    budgetId: null,
    spendingLimitId: null,
    publisherPriorityOverride: null,
    maxRetries: 5,
    scope: 'default',
    resolutionPath: ['default'],
  };
}

interface KeeperConfig {
  rpcUrl: string;
  keeperPrivateKey: string;
  scanSchedule: string;
  maxVaultsPerCycle: number;
  retryDelayMs: number;
  concurrentRenewals: number;
}
function loadConfig(): KeeperConfig {
  return {
    rpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443',
    keeperPrivateKey: process.env.KEEPER_PRIVATE_KEY || '',
    scanSchedule: process.env.SCAN_SCHEDULE || '*/2 * * * *',
    maxVaultsPerCycle: parseInt(process.env.MAX_VAULTS_PER_CYCLE || '50', 10),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '5000', 10),
    concurrentRenewals: parseInt(process.env.CONCURRENT_RENEWALS || '5', 10),
  };
}
/**
 * Run `fn` for each item with bounded concurrency.
 * Returns results in order, preserving item index.
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
/**
 * Recover jobs stuck in 'in_progress' for more than the stale threshold.
 * A job that's been in_progress for > 10 minutes is presumed to be from a
 * crashed worker. It gets reset to 'pending' so another worker can pick it up.
 *
 * This is the heartbeat/recovery mechanism required by Spec 16's restartability
 * requirement: a worker crash must never leave the system in a state that
 * requires manual cleanup.
 */
const STALE_JOB_THRESHOLD_MS = parseInt(process.env.STALE_JOB_THRESHOLD_MS || '600000', 10); // default 10 minutes

async function recoverStaleInProgressJobs(): Promise<void> {
  try {
    const sql = getDb();
    const staleThreshold = new Date(Date.now() - STALE_JOB_THRESHOLD_MS);
    const recovered = await sql`
      UPDATE renewal_jobs
      SET status = 'pending',
          last_error = 'Job recovered from stale in_progress status (worker may have crashed)',
          attempt = attempt + 1,
          updated_at = NOW()
      WHERE status = 'in_progress'
        AND (
          (heartbeat_at IS NOT NULL AND heartbeat_at < ${staleThreshold})
          OR
          (heartbeat_at IS NULL AND started_at IS NOT NULL AND started_at < ${staleThreshold})
        )
      RETURNING id, blob_registration_id
    `;
    if (recovered.length > 0) {
      logger.warn({ count: recovered.length, ids: recovered.map((r: any) => r.id) },
        'Recovered stale in_progress renewal jobs — worker may have crashed');
      // Roll back blob_registrations.status from renewing to expiring (Spec 07)
      for (const r of recovered) {
        await sql`
          UPDATE blob_registrations SET status = 'expiring', expiring_at = NOW(), updated_at = NOW()
          WHERE id = ${r.blob_registration_id} AND status = 'renewing'
        `;
      }
    }
  } catch (error) {
    await handleSystemicError(error instanceof Error ? error : new Error(String(error)), {
      component: 'keeper.stale-job-recovery',
      suggestedRemediation: 'Check database connectivity',
    }).catch(err => logger.warn({ err }, 'Failed to emit systemic alert for stale-job recovery failure'));
  }
}

async function processFiredAlerts(): Promise<void> {
  const notificationEngine = getNotificationEngine();
  try {
    const db = getDb();
    const fired = await db`
      SELECT id FROM alert_events WHERE status = 'fired' LIMIT 50
    `;
    for (const event of fired) {
      try {
        await notificationEngine.processAlertEvent(event.id);
      } catch (eventError) {
        logger.warn({ alertEventId: event.id, error: eventError }, 'Failed to process individual alert event');
      }
    }
  } catch (error) {
    await handleSystemicError(error instanceof Error ? error : new Error(String(error)), {
      component: 'keeper.alert-processor',
      suggestedRemediation: 'Check notification engine and database connectivity',
    }).catch(err => logger.warn({ err }, 'Failed to emit systemic alert for alert processor failure'));
  }
}

async function processRenewalQueue(
  executor: RenewalExecutor,
  scanner: VaultScanner,
  metrics?: MetricsCollector,
): Promise<void> {
  // Stale-job recovery: reset any job stuck in in_progress > 10 min (Spec 16 restartability)
  await recoverStaleInProgressJobs();

  try {
    const sql = getDb();
    const pendingJobs = await sql`
      SELECT * FROM renewal_jobs
      WHERE status IN ('estimated', 'pending', 'retrying')
      AND (scheduled_for IS NULL OR scheduled_for <= NOW())
      ORDER BY priority ASC, scheduled_for ASC NULLS FIRST, created_at ASC
      LIMIT 20
    `;

    for (const job of pendingJobs as any[]) {
      const jobTraceId = (job.metadata && typeof job.metadata === 'object' ? (job.metadata as Record<string, unknown>).traceId : undefined) as string | undefined || generateTraceId();
      // Handle estimated/pending → budget check → pending transition
      if (job.status === 'estimated' || job.status === 'pending') {
        const [registration] = await sql`
          SELECT * FROM blob_registrations WHERE id = ${job.blob_registration_id} LIMIT 1
        `;

        if (!registration) {
          await sql`
            UPDATE renewal_jobs SET status = 'failed_final', last_error = 'Blob registration not found', completed_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'failed_final', job.org_id, job.id, { error: 'Blob registration not found' }, jobTraceId);
          await emit(createEvent('renewal.failed_final', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: 'Blob registration not found' }, jobTraceId));
          continue;
        }

        // Check estimate freshness
        if (job.estimated_at) {
          if (!costEngine.isEstimateFresh(new Date(job.estimated_at))) {
            // Re-estimate
            const estimate = await costEngine.estimateRenewalCost(job.blob_registration_id, 1);
            job.estimated_cost = String(estimate.estimatedCost);
            await sql`UPDATE renewal_jobs SET estimated_cost = ${job.estimated_cost}, estimated_at = NOW() WHERE id = ${job.id}`;
          }
        }

        const budgetCheck = await costEngine.checkBudgetBeforeExecution(
          registration.org_id,
          registration.project_id,
          registration.wallet_id,
          null,
          Number(job.estimated_cost || '0'),
          job.spending_limit_overridden,
        );
        if (!budgetCheck.allowed) {
          validateTransition('renewal', job.status as string, 'blocked_by_budget');
          await sql`
            UPDATE renewal_jobs SET status = 'blocked_by_budget', last_error = ${budgetCheck.message ?? 'Budget check failed'}, completed_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'blocked_by_budget', job.org_id, job.id, { message: budgetCheck.message ?? 'Budget check failed', trigger: 'keeper' }, jobTraceId);
          await emit(createEvent('renewal.blocked_by_budget', job.org_id, 'renewal_job', job.id, { type: 'system' }, { message: budgetCheck.message }, jobTraceId));
          if (budgetCheck.blockingLimitId) {
            await emit(createEvent('spending_limit.blocked', job.org_id, 'spending_limit', budgetCheck.blockingLimitId, { type: 'system' }, { renewalJobId: job.id, blobId: job.blob_registration_id }, jobTraceId));
          }
          continue;
        }

        // Soft budget threshold — record crossing and alert (Spec 08)
        if (budgetCheck.softThresholdCrossed) {
          await emitRenewalEvent(sql, 'budget_soft_threshold_crossed', job.org_id, job.id, {
            trigger: 'keeper',
            estimatedCost: job.estimated_cost,
          }, jobTraceId);
        }

        // Transition estimated → pending (if not already pending)
        if (job.status === 'estimated') {
          validateTransition('renewal', 'estimated', 'pending');
          await sql`
            UPDATE renewal_jobs SET status = 'pending', updated_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'estimated', job.org_id, job.id, { trigger: 'keeper' }, jobTraceId);
        }
      }

      // Idempotency check: skip if blob already has a succeeded renewal (Spec 08)
      const [existingSucceeded] = await sql`
        SELECT id FROM renewal_jobs
        WHERE blob_registration_id = ${job.blob_registration_id}
          AND status = 'succeeded'
          AND id != ${job.id}
        LIMIT 1
      `;
      if (existingSucceeded) {
        await sql`
          UPDATE renewal_jobs SET status = 'succeeded', completed_at = NOW()
          WHERE id = ${job.id}
        `;
        await emit(createEvent('renewal.succeeded', job.org_id, 'renewal_job', job.id, { type: 'system' }, {}, jobTraceId));
        continue;
      }

      // Deduplication: ensure no other in_progress for same blob (Spec 08)
      const [activeDup] = await sql`
        SELECT id FROM renewal_jobs
        WHERE blob_registration_id = ${job.blob_registration_id}
          AND status = 'in_progress'
          AND id != ${job.id}
        LIMIT 1
      `;
      if (activeDup) {
        logger.warn({ jobId: job.id, blobId: job.blob_registration_id, activeId: activeDup.id },
          'Another in_progress renewal exists for this blob — attaching to existing attempt');
        await sql`
          UPDATE renewal_jobs SET status = 'in_progress', started_at = NOW()
          WHERE id = ${job.id}
        `;
        continue;
      }

      // Optimistic lock: only transition if still 'pending' (prevents double-pickup)
      validateTransition('renewal', 'pending', 'in_progress');
      const [updated] = await sql`
        UPDATE renewal_jobs SET status = 'in_progress', started_at = NOW()
        WHERE id = ${job.id} AND status = 'pending'
        RETURNING id
      `;
      if (!updated) {
        logger.warn({ jobId: job.id }, 'Job was already picked up by another worker — skipping');
        continue;
      }
      await emitRenewalEvent(sql, 'started', job.org_id, job.id, { trigger: 'keeper' }, jobTraceId);
      // Record initial heartbeat for stale-job recovery
      await sql`UPDATE renewal_jobs SET heartbeat_at = NOW() WHERE id = ${job.id}`;

      // Track queue processing latency (Spec 16 observability)
      if (metrics && job.created_at) {
        const createdAt = new Date(job.created_at).getTime();
        const latency = Date.now() - createdAt;
        metrics.recordQueueProcessingLatency(latency);
      }

      // Blob lifecycle: expiring → renewing
      validateTransition('blob', 'expiring', 'renewing');
      await sql`
        UPDATE blob_registrations SET status = 'renewing', renewing_at = NOW(), updated_at = NOW()
        WHERE id = ${job.blob_registration_id} AND status = 'expiring'
      `;
      await emitBlobEvent(sql, 'renewing', job.org_id, job.blob_registration_id, undefined, jobTraceId);

      // ── Rollback helper: renewing -> expiring on terminal failure ──
      // Spec 07: "Renewing -> Expiring (system, automatic, only when the underlying
      // Renewal reaches a terminal failure state — failed_final or blocked_by_budget)"
      async function rollbackBlobToExpiring(): Promise<void> {
        validateTransition('blob', 'renewing', 'expiring');
        await sql`
          UPDATE blob_registrations SET status = 'expiring', expiring_at = NOW(), updated_at = NOW()
          WHERE id = ${job.blob_registration_id} AND status = 'renewing'
        `;
        await emitBlobEvent(sql, 'expiring', job.org_id, job.blob_registration_id, { reason: 'renewal_failed' }, jobTraceId);
      }

      // ── Renewed -> Tracked|Protected helper ───────────────────────
      // Spec 07: "Renewed -> Tracked | Protected (system, automatic)
      // blob returns to Tracked or Protected depending on whether a Policy still applies"
      async function transitionRenewedBlob(blobId: string): Promise<void> {
        const renewedPolicy = await resolvePolicyForBlob(blobId);
        if (renewedPolicy.autoRenewalEnabled && renewedPolicy.policyId) {
          validateTransition('blob', 'renewed', 'protected');
          await sql`
            UPDATE blob_registrations SET status = 'protected', protected_at = NOW(), updated_at = NOW()
            WHERE id = ${job.blob_registration_id} AND status = 'renewed'
          `;
          await emitBlobEvent(sql, 'protected', job.org_id, job.blob_registration_id, { policyId: renewedPolicy.policyId }, jobTraceId);
        } else {
          validateTransition('blob', 'renewed', 'tracked');
          await sql`
            UPDATE blob_registrations SET status = 'tracked', tracked_at = NOW(), updated_at = NOW()
            WHERE id = ${job.blob_registration_id} AND status = 'renewed'
          `;
          await emitBlobEvent(sql, 'tracked', job.org_id, job.blob_registration_id, undefined, jobTraceId);
        }
      }

      try {
        const [registration] = await sql`
          SELECT * FROM blob_registrations WHERE id = ${job.blob_registration_id} LIMIT 1
        `;

        if (!registration) {
          validateTransition('renewal', 'in_progress', 'failed_final');
          await rollbackBlobToExpiring();
          await sql`
            UPDATE renewal_jobs SET status = 'failed_final', last_error = 'Blob registration not found', completed_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'failed_final', job.org_id, job.id, { error: 'Blob registration not found' }, jobTraceId);
          await emit(createEvent('renewal.failed_final', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: 'Blob registration not found' }, jobTraceId));
          continue;
        }

        const policy = await resolvePolicyForBlob(registration.blob_id as string);
        if (!policy.autoRenewalEnabled) {
          await rollbackBlobToExpiring();
          await sql`
            UPDATE renewal_jobs SET status = 'blocked_by_budget', last_error = 'Auto-renewal disabled by policy', completed_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'blocked_by_budget', job.org_id, job.id, { error: 'Auto-renewal disabled by policy' }, jobTraceId);
          await emit(createEvent('renewal.blocked_by_budget', job.org_id, 'renewal_job', job.id, { type: 'system' }, { message: 'Auto-renewal disabled by policy' }, jobTraceId));
          continue;
        }

        const vault = await scanner.findVaultByObjectId(registration.sui_vault_id as string);
        if (!vault) {
          validateTransition('renewal', 'in_progress', 'failed_final');
          await rollbackBlobToExpiring();
          await sql`
            UPDATE renewal_jobs SET status = 'failed_final', last_error = 'Vault not found on chain', completed_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'failed_final', job.org_id, job.id, { error: 'Vault not found on chain' }, jobTraceId);
          await emit(createEvent('renewal.failed_final', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: 'Vault not found on chain' }, jobTraceId));
          continue;
        }

        const publisherAvailable = await executor.resolvePublisherForRenewal(
          registration.project_id || null,
          registration.org_id,
        );
        if (!publisherAvailable) {
          await rollbackBlobToExpiring();
          await sql`
            UPDATE renewal_jobs SET status = 'failed_final', last_error = 'No available publisher', completed_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'failed_final', job.org_id, job.id, { error: 'No available publisher' }, jobTraceId);
          await emit(createEvent('renewal.failed_final', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: 'No available publisher' }, jobTraceId));
          continue;
        }

        const result = await executor.executeRenewal(vault);

        // Heartbeat before transitioning to succeeded
        await sql`UPDATE renewal_jobs SET heartbeat_at = NOW() WHERE id = ${job.id}`;
        validateTransition('renewal', 'in_progress', 'succeeded');
        await sql`
          UPDATE renewal_jobs SET status = 'succeeded', completed_at = NOW(), tx_digest = ${result.digest}
          WHERE id = ${job.id}
        `;
        await emitRenewalEvent(sql, 'succeeded', job.org_id, job.id, { txDigest: result.digest, trigger: 'keeper' }, jobTraceId);
        await emit(createEvent('renewal.succeeded', job.org_id, 'renewal_job', job.id, { type: 'system' }, {}, jobTraceId));

        // Track estimate-vs-actual cost accuracy (Spec 18)
        if (metrics && job.estimated_cost) {
          const estimatedCost = Number(job.estimated_cost);
          const actualGas = Number(result.gasUsed);
          if (estimatedCost > 0 && actualGas > 0) {
            metrics.recordEstimateAccuracy(actualGas / estimatedCost);
          }
        }

        // Blob lifecycle: renewing → renewed
        validateTransition('blob', 'renewing', 'renewed');
        await sql`
          UPDATE blob_registrations SET status = 'renewed', renewed_at = NOW(), updated_at = NOW()
          WHERE id = ${job.blob_registration_id} AND status = 'renewing'
        `;
        await emitBlobEvent(sql, 'renewed', job.org_id, job.blob_registration_id, undefined, jobTraceId);

        // Immediately transition renewed -> tracked|protected (spec: automatic)
        await transitionRenewedBlob(registration.blob_id as string);
      } catch (error) {
        const attempt = (Number(job.attempt) || 0) + 1;

        // Classify error: non-retryable errors skip retry and go directly to failed_final (Spec 16)
        const isRetryable = isRetryableJobError(error);
        if (!isRetryable) {
          validateTransition('renewal', 'in_progress', 'failed_final');
          await rollbackBlobToExpiring();
          const existingMetadata = (job.metadata && typeof job.metadata === 'object' ? job.metadata : {}) as Record<string, unknown>;
          const attemptsHistory = Array.isArray(existingMetadata.attempts)
            ? [...existingMetadata.attempts, { attempt, timestamp: new Date().toISOString(), error: (error as Error).message, final: true, nonRetryable: true }]
            : [{ attempt, timestamp: new Date().toISOString(), error: (error as Error).message, final: true, nonRetryable: true }];
          await sql`
            UPDATE renewal_jobs SET
              status = 'failed_final',
              attempt = ${attempt},
              last_error = ${`[non-retryable] ${(error as Error).message}`},
              completed_at = NOW(),
              metadata = ${sql.json({ ...existingMetadata, attempts: attemptsHistory })}
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'failed_final', job.org_id, job.id, { attempt, error: (error as Error).message, trigger: 'keeper', nonRetryable: true }, jobTraceId);
          await emit(createEvent('renewal.failed_final', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: (error as Error).message }, jobTraceId));
          logger.error({ jobId: job.id, blobId: job.blob_registration_id, error: (error as Error).message, traceId: jobTraceId }, 'Renewal failed — non-retryable error');
          continue;
        }

        if (attempt < (Number(job.max_attempts) || 5)) {
          validateTransition('renewal', 'in_progress', 'retrying');
          // Blob stays in renewing during retry loop (Spec 07: "doesn't bounce back to Expiring between retries")
          // Exponential backoff for retry scheduling (Spec 08)
          const baseDelayMs = 5000;
          const maxDelayMs = 60000;
          const jitter = Math.round(Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs) * (0.5 + Math.random() * 0.5));
          const scheduledFor = new Date(Date.now() + jitter);
          // Record individual attempt in metadata history (Spec 08: each retry recorded)
          const attemptEntry = {
            attempt,
            timestamp: new Date().toISOString(),
            error: (error as Error).message,
            scheduledFor: scheduledFor.toISOString(),
          };
          const existingMetadata = (job.metadata && typeof job.metadata === 'object' ? job.metadata : {}) as Record<string, unknown>;
          const attemptsHistory = Array.isArray(existingMetadata.attempts)
            ? [...existingMetadata.attempts, attemptEntry]
            : [attemptEntry];
          await sql`
            UPDATE renewal_jobs SET
              status = 'retrying',
              attempt = ${attempt},
              last_error = ${(error as Error).message},
              scheduled_for = ${scheduledFor},
              metadata = ${sql.json({ ...existingMetadata, attempts: attemptsHistory })},
              updated_at = NOW()
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'retrying', job.org_id, job.id, { attempt, error: (error as Error).message, scheduledFor: scheduledFor.toISOString(), trigger: 'keeper' }, jobTraceId);
          await emit(createEvent('renewal.retrying', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: (error as Error).message }, jobTraceId));
        } else {
          validateTransition('renewal', 'in_progress', 'failed_final');
          await rollbackBlobToExpiring();
          // Record final failed attempt in metadata (Spec 08: each retry recorded)
          const existingMetadata = (job.metadata && typeof job.metadata === 'object' ? job.metadata : {}) as Record<string, unknown>;
          const attemptsHistory = Array.isArray(existingMetadata.attempts)
            ? [...existingMetadata.attempts, { attempt, timestamp: new Date().toISOString(), error: (error as Error).message, final: true }]
            : [{ attempt, timestamp: new Date().toISOString(), error: (error as Error).message, final: true }];
          await sql`
            UPDATE renewal_jobs SET
              status = 'failed_final',
              attempt = ${attempt},
              last_error = ${(error as Error).message},
              completed_at = NOW(),
              metadata = ${sql.json({ ...existingMetadata, attempts: attemptsHistory })}
            WHERE id = ${job.id}
          `;
          await emitRenewalEvent(sql, 'failed_final', job.org_id, job.id, { attempt, error: (error as Error).message, trigger: 'keeper', maxAttemptsExhausted: true }, jobTraceId);
          await emit(createEvent('renewal.failed_final', job.org_id, 'renewal_job', job.id, { type: 'system' }, { error: (error as Error).message }, jobTraceId));
          logger.error({ jobId: job.id, blobId: job.blob_registration_id, attempt, maxAttempts: job.max_attempts, traceId: jobTraceId }, 'Renewal failed — max retries exhausted');
        }
      }
    }
  } catch (error) {
    await handleSystemicError(error instanceof Error ? error : new Error(String(error)), {
      component: 'keeper.renewal-queue',
      suggestedRemediation: 'Check database connectivity and renewal job integrity',
    }).catch(err => logger.warn({ err }, 'Failed to emit systemic alert for renewal queue failure'));
  }
}

async function main() {
  const config = loadConfig();
  if (!config.keeperPrivateKey) {
    logger.error(
      'KEEPER_PRIVATE_KEY environment variable is required.\n' +
        'Generate an Ed25519 keypair and export the base64-encoded secret key.\n' +
        'Example: export KEEPER_PRIVATE_KEY="$(sui keytool generate ed25519 | grep secret | cut -d: -f2)"',
    );
    process.exit(1);
  }
  const packageIds = (process.env.PACKAGE_IDS || process.env.PACKAGE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (packageIds.length === 0) {
    logger.error('PACKAGE_IDS or PACKAGE_ID environment variable is required (comma-separated contract package IDs)');
    process.exit(1);
  }
  if (!process.env.SYSTEM_OBJECT_ID) {
    logger.error('SYSTEM_OBJECT_ID environment variable is required (the Walrus System object ID)');
    process.exit(1);
  }
  const keypair = Ed25519Keypair.fromSecretKey(config.keeperPrivateKey);
  // Redact private key from config immediately — prevents accidental logging
  (config as unknown as Record<string, unknown>).keeperPrivateKey = '[redacted]';
  // Delete private key from env to prevent /proc/self/environ exposure
  // Note: the key material still lives in V8 heap until GC; no way to zero
  // strings in JavaScript. For production, isolate the keeper process.
  if (process.env.KEEPER_PRIVATE_KEY) {
    delete process.env.KEEPER_PRIVATE_KEY;
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  // Initialize RPC client pool with multi-endpoint failover
  const suiPool = createPoolFromEnv();
  const client = suiPool.primaryClient;
  // Initialize services
  const notifications = createNotificationServiceFromEnv();
  const jobMonitor = new JobMonitor();
  // Circuit breaker for Sui RPC calls (used at the cycle level)
  const suiCircuitBreaker = new CircuitBreaker({
    threshold: 5,
    timeout: 30_000,
  });
  if (notifications.hasExternalProviders) {
    logger.info('Notification service configured with external providers');
  } else {
    logger.info(
      'No external notification providers configured. ' +
        'Set NOTIFICATION_EMAIL, NOTIFICATION_WEBHOOK_URL, or RESEND_API_KEY to enable alerts.',
    );
  }
  logger.info({ keeperAddress, rpcUrl: config.rpcUrl, packageIds }, 'Keeper worker starting');
  const scanners = packageIds.map(pkgId => new VaultScanner(
    suiPool,
    config.maxVaultsPerCycle,
    process.env.ENABLE_EVENT_FALLBACK === 'true',
    pkgId,
  ));
  const executors = packageIds.map(pkgId => new RenewalExecutor(
    suiPool,
    keypair,
    config.retryDelayMs,
    pkgId,
  ));
  const metrics = new MetricsCollector();
  // Start metrics/health server
  const metricsServerInstance = startMetricsServer(metrics, jobMonitor, 9090, {
    suiClient: suiPool.primaryClient,
    suiPool,
  });
  logger.info('Metrics server started on port 9090');
  // Leader election (optional, requires DATABASE_URL)
  let isLeader = true;
  if (process.env.ENABLE_LEADER_ELECTION === 'true' && process.env.DATABASE_URL) {
    try {
      const { LeaderElector, createInstanceId } = await import('./leader.js');
      const leader = new LeaderElector({
        instanceId: createInstanceId(),
        databaseUrl: process.env.DATABASE_URL!,
        onLeadershipGained: () => {
          isLeader = true;
          logger.info('Gained leadership — this instance is the active keeper');
        },
        onLeadershipLost: () => {
          isLeader = false;
          logger.warn('Lost leadership — this instance is now standby');
        },
      });
      await leader.start();
      logger.info('Leader election initialized');
    } catch (error) {
      logger.warn({ error }, 'Failed to initialize leader election — running as sole keeper');
    }
  }
  // Track alerts collected during a cycle for digest
  let pendingAlerts: Awaited<ReturnType<typeof notifications.sendAlert>> = [];
  // Scheduled vault scanning and renewal execution
  cron.schedule(config.scanSchedule, async () => {
    if (!isLeader) {
      logger.debug('Not leader — skipping scan cycle');
      return;
    }
    const cycleTraceId = generateTraceId();
    const cycleJobId = await jobMonitor.startJob('scan', 'cycle', config.scanSchedule, undefined, cycleTraceId);
    logger.info({ traceId: cycleTraceId }, 'Starting scan cycle');
    const cycleStart = Date.now();
    try {
      // Scan with circuit breaker + retry over all package IDs
      const dueVaults = await suiCircuitBreaker.call(async () => {
        const allVaults = [];
        for (let i = 0; i < scanners.length; i++) {
          const vaults = await withRetry(async () => {
            return await scanners[i].findDueVaults();
          }, { maxRetries: 2, operationName: `scan-${i}`, baseDelay: 2000 });
          // Tag each vault with its packageId for executor routing
          for (const v of vaults) {
            (v as unknown as Record<string, number>).__packageIndex = i;
          }
          allVaults.push(...vaults);
        }
        return allVaults;
      });
      if (dueVaults.length === 0) {
        logger.debug('No due vaults found');
        await jobMonitor.completeJob(cycleJobId);
        return;
      }
      logger.info({ count: dueVaults.length, traceId: cycleTraceId }, 'Due vaults found, executing renewals');
      metrics.setQueueDepth(dueVaults.length);
      // Write due vaults as queued jobs for queue-driven processing
      if (process.env.DATABASE_URL) {
        for (const vault of dueVaults) {
          try {
            const registration = await findBlobRegistrationByBlobId(vault.blobId);
            if (registration) {
              const policy = await resolvePolicyForBlob(vault.blobId);
              await createRenewalJob({
                orgId: registration.orgId,
                blobRegistrationId: registration.id,
                policyId: policy.policyId,
                status: 'estimated',
                attempt: 0,
                maxAttempts: policy.maxRetries,
                estimatedAt: new Date(),
                priority: 10,
              });
            }
          } catch (dbError) {
            logger.warn({ vaultId: vault.id, error: dbError }, 'Failed to write queued job');
          }
        }
      }
      // Execute renewals concurrently with bounded parallelism
      const concurrency = Math.max(1, config.concurrentRenewals);
      const renewalResults = await mapConcurrent(dueVaults, concurrency, async (vault) => {
        // Mid-cycle leader check — skip if leadership was lost
        if (!isLeader) {
          logger.debug({ vaultId: vault.id }, 'Leadership lost mid-cycle — skipping remaining vaults');
          return { skipped: true as const, vault };
        }
        const renewalJobId = await jobMonitor.startJob('renewal', 'blob', vault.blobId, undefined, cycleTraceId);
        metrics.recordStart(vault.id);
        try {
          // Resolve policy BEFORE executing renewal
          let resolvedPolicy: ResolvedPolicy | null = null;
          if (process.env.DATABASE_URL) {
            resolvedPolicy = await resolvePolicyForBlob(vault.blobId);
            if (!resolvedPolicy.autoRenewalEnabled) {
              await jobMonitor.completeJob(renewalJobId);
              logger.info({ vaultId: vault.id, blobId: vault.blobId, policyId: resolvedPolicy.policyId, traceId: cycleTraceId }, 'Auto-renewal disabled by policy — skipping vault');
              return { skipped: false as const, vaultId: vault.id };
            }
          }

          // Fetch registration once for budget check + publisher resolution
          if (process.env.DATABASE_URL) {
            const sql = getDb();
            const registration = await findBlobRegistrationByBlobId(vault.blobId);
            if (registration) {
              // Check budget BEFORE any on-chain write (Spec 11: step 3 — check against Spending Limits)
              // Query the latest estimated cost from the most recent renewal job for this blob
              let estimatedCost = BigInt(0);
              const [latestJob] = await sql`
                  SELECT estimated_cost FROM renewal_jobs
                  WHERE blob_registration_id = ${registration.id}
                  ORDER BY created_at DESC LIMIT 1
                `;
                if (latestJob?.estimated_cost) {
                  estimatedCost = BigInt(latestJob.estimated_cost);
                }
              const budgetCheck = await costEngine.checkBudgetBeforeExecution(
                registration.orgId,
                registration.projectId || null,
                registration.walletId ?? undefined,
                resolvedPolicy?.policyId || null,
                Number(estimatedCost),
              );
              if (!budgetCheck.allowed) {
                await emitRenewalEvent(sql, 'blocked_by_budget', registration.orgId, renewalJobId, {
                  message: budgetCheck.message ?? 'Budget check failed',
                  trigger: 'keeper',
                }, cycleTraceId);
                await jobMonitor.completeJob(renewalJobId);
                logger.warn(
                  { vaultId: vault.id, blobId: vault.blobId, message: budgetCheck.message, traceId: cycleTraceId },
                  'Renewal blocked by budget check',
                );
                return { skipped: false as const, vaultId: vault.id };
              }

              // Resolve publisher for this renewal (Spec 08: publisher priority/fallback)
              const pkgIdx = (vault as unknown as Record<string, number>).__packageIndex || 0;
              const execForVault = executors[pkgIdx] || executors[0];
              (vault as unknown as Record<string, unknown>).__executor = execForVault;
              const publisherAvailable = await execForVault.resolvePublisherForRenewal(
                registration.projectId || null,
                registration.orgId,
                resolvedPolicy?.publisherPriorityOverride ?? undefined,
              );
              if (!publisherAvailable) {
                await jobMonitor.completeJob(renewalJobId);
                logger.warn(
                  { vaultId: vault.id, blobId: vault.blobId },
                  'No healthy publisher available — skipping renewal',
                );
                return { skipped: false as const, vaultId: vault.id };
              }
            }
          }

          const execForVault = (vault as unknown as Record<string, RenewalExecutor>).__executor || executors[0];
          const result = await suiCircuitBreaker.call(async () => {
            return await execForVault.executeRenewal(vault);
          });
          metrics.recordSuccess(result);
          await jobMonitor.completeJob(renewalJobId);
          logger.info({ vaultId: vault.id, txDigest: result.digest }, 'Renewal executed');
          // Record in database if DATABASE_URL is configured
          if (process.env.DATABASE_URL) {
            try {
              const registration = await findBlobRegistrationByBlobId(vault.blobId);
              if (registration) {
                const resolvedPolicy = await resolvePolicyForBlob(vault.blobId);
                await createRenewalJob({
                  orgId: registration.orgId,
                  blobRegistrationId: registration.id,
                  policyId: resolvedPolicy.policyId,
                  status: 'succeeded',
                  estimatedAt: new Date(),
                  attempt: 1,
                  maxAttempts: resolvedPolicy.maxRetries,
                  completedAt: new Date(),
                  priority: 200,
                });
              }
            } catch (dbError) {
              logger.warn({ vaultId: vault.id, error: dbError }, 'Failed to record renewal job in DB');
            }
          }
          // Forward any events that need user attention
          if (result.alerts.length > 0) {
            for (const alert of result.alerts) {
              const notifJobId = await jobMonitor.startJob('notification', 'alert', alert.type);
              try {
                const results = await notifications.sendAlert(alert);
                pendingAlerts.push(...results);
                await jobMonitor.completeJob(notifJobId);
              } catch (err) {
                await jobMonitor.failJob(notifJobId, err instanceof Error ? err.message : 'Notification send failed');
              }
            }
          }
          return { skipped: false as const, vaultId: vault.id };
        } catch (error) {
          metrics.recordFailure(vault.id, error as Error);
          await jobMonitor.failJob(renewalJobId, (error as Error).message);
          logger.error({ vaultId: vault.id, error }, 'Renewal failed');
          // Record failure in database
          if (process.env.DATABASE_URL) {
            try {
              const registration = await findBlobRegistrationByBlobId(vault.blobId);
              if (registration) {
                const policy = await resolvePolicyForBlob(vault.blobId);
                await createRenewalJob({
                  orgId: registration.orgId,
                  blobRegistrationId: registration.id,
                  policyId: policy.policyId,
                  status: 'failed_final',
                  attempt: 1,
                  maxAttempts: policy.maxRetries,
                  lastError: (error as Error).message,
                  completedAt: new Date(),
                  priority: 200,
                });
              }
            } catch (dbError) {
              logger.warn({ vaultId: vault.id, error: dbError }, 'Failed to record failed job in DB');
            }
          }
          return { skipped: false as const, vaultId: vault.id };
        }
      });
      const skippedCount = renewalResults.filter((r) => r.skipped).length;
      if (skippedCount > 0) {
        logger.info({ skippedCount, total: dueVaults.length }, 'Some vaults skipped due to leadership change');
      }
    } catch (error) {
      await handleSystemicError(error instanceof Error ? error : new Error(String(error)), {
        component: 'keeper.scan-cycle',
        suggestedRemediation: 'Check Sui RPC connectivity, database connectivity, and inspect logs',
      }).catch(err => logger.warn({ err }, 'Failed to emit systemic alert for scan cycle failure'));
    }
    const cycleDuration = Date.now() - cycleStart;
    const summary = metrics.summarize();
    const jobStats = jobMonitor.getStats();
    logger.info({
      ...summary,
      cycleDurationMs: cycleDuration,
      alertsSent: pendingAlerts.filter(r => r.success).length,
      circuitBreakerState: suiCircuitBreaker.state,
      jobStats,
    }, 'Scan cycle complete');
    // Don't reset cumulative metrics — they're useful for Prometheus
    pendingAlerts = [];

    // Process pending alert events for notification delivery
    try {
      await processFiredAlerts();
    } catch (err) {
      await handleSystemicError(err instanceof Error ? err : new Error(String(err)), {
        component: 'keeper.alert-processor',
        suggestedRemediation: 'Check notification engine and database connectivity',
      }).catch(innerErr => logger.warn({ innerErr }, 'Failed to emit systemic alert for alert processor failure'));
    }

    // Process renewal queue for queue-driven renewal execution
    if (process.env.DATABASE_URL) {
      try {
        for (let i = 0; i < executors.length; i++) {
          const scanner = scanners[i % scanners.length] || scanners[0];
          await processRenewalQueue(executors[i], scanner, metrics);
        }
      } catch (err) {
        await handleSystemicError(err instanceof Error ? err : new Error(String(err)), {
          component: 'keeper.renewal-queue',
          suggestedRemediation: 'Check database connectivity and renewal job integrity',
        }).catch(innerErr => logger.warn({ innerErr }, 'Failed to emit systemic alert for renewal queue failure'));
      }
    }
  });
  logger.info({ schedule: config.scanSchedule, finalizeSchedule: 'every 60 min' }, 'Keeper worker initialized');

  // ── Finalize pending withdrawals (every ~60 min) ──────────────────
  async function finalizePendingWithdrawals() {
    for (let i = 0; i < scanners.length; i++) {
      try {
        const pendingVaults = await scanners[i].findPendingWithdrawals();
        for (const vault of pendingVaults) {
          try {
            const digest = await executors[i].finalizeWithdraw(vault);
            if (digest) {
              logger.info({ vaultId: vault.objectId, digest }, 'Finalized pending withdrawal');
            }
          } catch (err) {
            logger.error({ vaultId: vault.objectId, error: err }, 'Failed to finalize withdrawal');
          }
        }
      } catch (err) {
        logger.error({ packageIdx: i, error: err }, 'Failed to scan pending withdrawals');
      }
    }
  }
  // Run initial scan after 5 min, then every 60 min
  setTimeout(() => { finalizePendingWithdrawals().catch(() => {}); }, 5 * 60 * 1000);
  setInterval(() => { finalizePendingWithdrawals().catch(() => {}); }, 60 * 60 * 1000);

  // ── Scheduler Engine (spec 10) ───────────────────────────────────
  const scheduler = new SchedulerEngine();
  await scheduler.loadAndStart();

  // ── Graceful shutdown ──────────────────────────────────────────
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down keeper worker');
    // Stop accepting new jobs
    isLeader = false;
    // Close database connections
    try {
      const { closeDb } = await import('./db.js');
      await closeDb();
      logger.info('Database connections closed');
    } catch {
      // DB may not be configured
    }
    // Stop scheduler
    try {
      scheduler.stop();
      logger.info('Scheduler stopped');
    } catch {
      // Ignore
    }
    // Stop metrics server
    try {
      metricsServerInstance.close();
      logger.info('Metrics server stopped');
    } catch {
      // Ignore
    }
    // Give in-flight transactions time to complete
    // Give in-flight transactions time to complete
    // The unref'd timer fires only if the event loop is still alive after 30s,
    // acting as a safety net. If the event loop drains first, the process
    // exits naturally with code 0.
    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
    forceExit.unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  handleSystemicError(err, {
    component: 'keeper.main',
    suggestedRemediation: 'Check environment configuration, credential validity, and dependency availability',
  }).catch(innerErr => logger.warn({ innerErr }, 'Failed to emit systemic alert for startup failure'));
  logger.fatal({ error }, 'Failed to start keeper worker');
  process.exit(1);
});
