import postgres from 'postgres';
import { logger as rootLogger } from './logger.js';
import { getDb } from './db.js';

const logger = rootLogger.child({ component: 'db-writer' });

export interface RenewalJobRecord {
  orgId: string;
  blobRegistrationId: string;
  policyId?: string | null;
  status: string;
  attempt: number;
  maxAttempts: number;
  lastError?: string | null;
  estimatedCost?: bigint | null;
  blockedByLimitId?: string | null;
  digest?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  estimatedAt?: Date | null;
  scheduledFor?: Date | null;
  priority?: number;
}

export interface NotificationChannelRow {
  id: string;
  orgId: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Create a renewal job with idempotent semantics per Spec 16.
 *
 * Idempotency strategy (check-then-upsert):
 *   1. For non-terminal statuses (estimated, pending), check if a job in the
 *      same non-terminal status already exists for this blob_registration_id.
 *      If so, update its attempt/timing fields rather than inserting a duplicate.
 *   2. For terminal statuses (succeeded, failed_final, blocked_by_budget),
 *      always insert — a blob can have multiple terminal jobs over its lifetime.
 *
 * This ensures the system is resilient to at-least-once delivery of job
 * creation events without producing duplicate rows for the same logical job.
 */
export async function createRenewalJob(job: RenewalJobRecord): Promise<string> {
  const sql = getDb();
  try {
    // Idempotency check: for non-terminal statuses, look for an existing job
    // in the same non-terminal state for this blob registration.
    if (job.status === 'estimated' || job.status === 'pending') {
      const [existing] = await sql`
        SELECT id, attempt, status FROM renewal_jobs
        WHERE blob_registration_id = ${job.blobRegistrationId}
          AND status IN ('estimated', 'pending', 'retrying')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (existing) {
        // Update existing record with new timing/attempt info instead of inserting
        const [updated] = await sql`
          UPDATE renewal_jobs SET
            attempt = ${job.attempt},
            max_attempts = ${job.maxAttempts},
            estimated_at = COALESCE(${job.estimatedAt ?? null}, estimated_at),
            scheduled_for = COALESCE(${job.scheduledFor ?? null}, scheduled_for),
            last_error = ${job.lastError ?? null},
            updated_at = NOW()
          WHERE id = ${existing.id}
          RETURNING id
        `;
        logger.info({ jobId: updated.id, status: job.status, action: 'upserted' }, 'Renewal job updated (idempotent)');
        return (updated as { id: string }).id;
      }
    }

    // Also check for status='succeeded' — if one already exists for this blob,
    // don't create another (idempotency per Spec 08).
    if (job.status === 'succeeded') {
      const [existing] = await sql`
        SELECT id FROM renewal_jobs
        WHERE blob_registration_id = ${job.blobRegistrationId}
          AND status = 'succeeded'
        LIMIT 1
      `;
      if (existing) {
        logger.warn({ blobRegistrationId: job.blobRegistrationId, existingId: existing.id },
          'Succeeded renewal job already exists — skipping duplicate');
        return existing.id as string;
      }
    }

    // No existing job found — insert new record
    const [row] = await sql`
      INSERT INTO renewal_jobs (
        org_id, blob_registration_id, policy_id, status,
        attempt, max_attempts, last_error, estimated_cost,
        blocked_by_limit_id, started_at, completed_at,
        estimated_at, scheduled_for, priority
      ) VALUES (
        ${job.orgId}, ${job.blobRegistrationId}, ${job.policyId ?? null}, ${job.status},
        ${job.attempt}, ${job.maxAttempts}, ${job.lastError ?? null},
        ${job.estimatedCost != null ? String(job.estimatedCost) : null}, ${job.blockedByLimitId ?? null},
        ${job.startedAt ?? null}, ${job.completedAt ?? null},
        ${job.estimatedAt ?? null}, ${job.scheduledFor ?? null},
        ${job.priority ?? 50}
      )
      RETURNING id
    `;
    logger.info({ jobId: row.id, status: job.status }, 'Renewal job recorded');
    return row.id as string;
  } catch (error) {
    logger.error({ error, blobRegistrationId: job.blobRegistrationId }, 'Failed to create renewal job');
    throw error;
  }
}

export async function updateRenewalJobStatus(id: string, status: string, error?: string): Promise<void> {
  const sql = getDb();
  // TODO: When a state-machine library is available at the keeper level,
  // replace raw SQL status updates with validateTransition() calls
  await sql`
    UPDATE renewal_jobs
    SET status = ${status}, last_error = ${error ?? null}, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function recordActualCost(
  jobId: string,
  actualCost: bigint,
  digest: string,
): Promise<void> {
  const sql = getDb();
  // Check if actual cost already recorded (immutability per spec 11)
  const existing = await sql`SELECT actual_cost FROM renewal_jobs WHERE id = ${jobId}`;
  if (existing[0]?.actual_cost) {
    throw new Error(`Actual cost already recorded for renewal job ${jobId}`);
  }
  const [job] = await sql`
    SELECT rj.id, rj.org_id, rj.blob_registration_id, rj.estimated_cost, br.project_id
    FROM renewal_jobs rj
    LEFT JOIN blob_registrations br ON br.id = rj.blob_registration_id
    WHERE rj.id = ${jobId} LIMIT 1
  `;
  await sql.begin(async (tx) => {
    await tx`
      UPDATE renewal_jobs
      SET actual_cost = ${actualCost.toString()}, tx_digest = ${digest}, completed_at = NOW(), updated_at = NOW()
      WHERE id = ${jobId}
    `;
    if (job) {
      await tx`
        INSERT INTO cost_records (blob_registration_id, renewal_job_id, estimated_cost, actual_cost, org_id, project_id)
        VALUES (${job.blob_registration_id}, ${job.id}, ${job.estimated_cost ?? null}, ${actualCost.toString()}, ${job.org_id}, ${job.project_id ?? null})
      `;
    }
  });
}

export async function getNotificationChannels(orgId: string): Promise<NotificationChannelRow[]> {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT id, org_id, type, name, config, enabled
      FROM notification_channels
      WHERE org_id = ${orgId} AND status = 'active' AND enabled = true
    `;
    return rows as unknown as NotificationChannelRow[];
  } catch (error) {
    logger.error({ error, orgId }, 'Failed to fetch notification channels');
    return [];
  }
}

export async function getAlertRulesForBlob(orgId: string, blobId: string): Promise<{ trigger: string; channels: string[] }[]> {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT trigger, channel_ids
      FROM alert_rules
      WHERE org_id = ${orgId} AND status = 'active' AND enabled = true
    `;
    return rows.map((r: any) => ({ trigger: r.trigger, channels: r.channel_ids || [] }));
  } catch (error) {
    logger.error({ error, orgId, blobId }, 'Failed to fetch alert rules');
    return [];
  }
}
