import { logger as rootLogger } from './logger.js';
import { getDb } from './db.js';

const logger = rootLogger.child({ component: 'job-monitor' });

export interface JobRecord {
  id: string;
  /** Job type identifier — extensible, any string. Core types: 'scan' | 'renewal' | 'notification' | 'scheduler' */
  type: string;
  status: 'running' | 'success' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  /** The entity this job operates on (Spec 16: "what entity") */
  entityType?: string;
  /** The entity ID this job operates on */
  entityId?: string;
  details?: Record<string, unknown>;
  error?: string;
  orgId?: string;
  traceId?: string;
}

export class JobMonitor {
  private jobs: JobRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords = 1000) {
    this.maxRecords = maxRecords;
  }

  async startJob(
    type: JobRecord['type'],
    entityType?: string,
    entityId?: string,
    orgId?: string,
    traceId?: string,
  ): Promise<string> {
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO job_executions (job_type, entity_type, entity_id, status, started_at, org_id, trace_id)
      VALUES (${type}, ${entityType ?? null}, ${entityId ?? null}, 'running', NOW(), ${orgId ?? null}, ${traceId ?? null})
      RETURNING id, started_at
    `;
    const id = row.id as string;
    const record: JobRecord = {
      id,
      type,
      status: 'running',
      startedAt: new Date(row.started_at),
      entityType,
      entityId,
      orgId,
      traceId,
    };
    this.jobs.push(record);
    this.trimRecords();
    logger.info({ jobId: id, type, entityType, entityId, orgId, traceId }, 'Job started');
    return id;
  }

  async completeJob(id: string, metadata?: Record<string, unknown>): Promise<void> {
    const sql = getDb();
    let [row]: any[] = [];
    if (metadata != null) {
      [row] = await sql`
        UPDATE job_executions
        SET status = 'completed', completed_at = NOW(), duration_ms = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int, metadata = ${sql.json(metadata as any)}
        WHERE id = ${id}
        RETURNING id
      `;
    } else {
      [row] = await sql`
        UPDATE job_executions
        SET status = 'completed', completed_at = NOW(), duration_ms = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int
        WHERE id = ${id}
        RETURNING id
      `;
    }
    if (!row) {
      logger.warn({ jobId: id }, 'Attempted to complete unknown job');
      return;
    }
    const job = this.findJob(id);
    if (job) {
      job.status = 'success';
      job.completedAt = new Date();
      job.durationMs = job.completedAt.getTime() - job.startedAt.getTime();
      if (metadata) {
        job.details = metadata;
      }
    }
    logger.info(
      { jobId: id, type: job?.type, durationMs: job?.durationMs },
      'Job completed successfully',
    );
  }

  async failJob(id: string, error: string): Promise<void> {
    const sql = getDb();
    const [row] = await sql`
      UPDATE job_executions
      SET status = 'failed', completed_at = NOW(), duration_ms = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int, error = ${error}
      WHERE id = ${id}
      RETURNING id
    `;
    if (!row) {
      logger.warn({ jobId: id }, 'Attempted to fail unknown job');
      return;
    }
    const job = this.findJob(id);
    if (job) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.durationMs = job.completedAt.getTime() - job.startedAt.getTime();
      job.error = error;
    }
    logger.warn(
      { jobId: id, type: job?.type, durationMs: job?.durationMs, error },
      'Job failed',
    );
  }

  getRecentJobs(limit?: number): JobRecord[] {
    const sorted = [...this.jobs].reverse();
    return limit ? sorted.slice(0, limit) : sorted;
  }

  getStats(): {
    total: number;
    success: number;
    failed: number;
    running: number;
    avgDurationMs: number;
  } {
    const completed = this.jobs.filter(
      (j) => j.status !== 'running' && j.durationMs !== undefined,
    );
    const totalDuration = completed.reduce((sum, j) => sum + (j.durationMs ?? 0), 0);
    const avgDurationMs = completed.length > 0 ? Math.round(totalDuration / completed.length) : 0;

    return {
      total: this.jobs.length,
      success: this.jobs.filter((j) => j.status === 'success').length,
      failed: this.jobs.filter((j) => j.status === 'failed').length,
      running: this.jobs.filter((j) => j.status === 'running').length,
      avgDurationMs,
    };
  }

  /**
   * Get statistics broken down by job type (Spec 16 observability).
   * Returns a map of type -> { total, success, failed, running }.
   */
  getStatsByType(): Record<string, { total: number; success: number; failed: number; running: number }> {
    const byType: Record<string, { total: number; success: number; failed: number; running: number }> = {};
    for (const job of this.jobs) {
      if (!byType[job.type]) {
        byType[job.type] = { total: 0, success: 0, failed: 0, running: 0 };
      }
      byType[job.type].total++;
      if (job.status === 'success') byType[job.type].success++;
      else if (job.status === 'failed') byType[job.type].failed++;
      else if (job.status === 'running') byType[job.type].running++;
    }
    return byType;
  }

  getLatestJob(type: JobRecord['type']): JobRecord | undefined {
    const filtered = this.jobs.filter((j) => j.type === type);
    if (filtered.length === 0) return undefined;
    return filtered[filtered.length - 1];
  }

  reset(): void {
    this.jobs = [];
    logger.info('Job monitor reset');
  }

  private findJob(id: string): JobRecord | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  private trimRecords(): void {
    if (this.jobs.length > this.maxRecords) {
      this.jobs = this.jobs.slice(this.jobs.length - this.maxRecords);
    }
  }
}
