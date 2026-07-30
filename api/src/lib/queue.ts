import { getDb } from '../db/index.js';
import { sql, eq, and, isNull, asc } from 'drizzle-orm';
import { jobQueue, jobDlq } from '../db/schema.js';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'dlq';

export interface JobMessage {
  id: string;
  type: string;
  payload: unknown;
  entityType: string;
  entityId: string;
  priority: number;
  status: JobStatus;
  scheduledFor: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  attempts: number;
  maxAttempts: number;
  traceId?: string;
}

export async function publishJob(job: Omit<JobMessage, 'id' | 'status' | 'createdAt' | 'attempts'>): Promise<string> {
  const db = getDb();
  const [inserted] = await db.insert(jobQueue).values({
    type: job.type,
    payload: job.payload,
    entityType: job.entityType,
    entityId: job.entityId,
    priority: job.priority,
    maxAttempts: job.maxAttempts,
    scheduledFor: job.scheduledFor ?? new Date(),
    traceId: job.traceId,
  }).returning({ id: jobQueue.id });
  return inserted.id;
}

export async function claimNextJob(): Promise<JobMessage | null> {
  const db = getDb();

  const [job] = await db.select().from(jobQueue)
    .where(eq(jobQueue.status, 'queued'))
    .orderBy(asc(jobQueue.priority), asc(jobQueue.scheduledFor))
    .limit(1);

  if (!job) return null;

  await db.update(jobQueue)
    .set({ status: 'processing', startedAt: new Date() })
    .where(eq(jobQueue.id, job.id));

  return job as unknown as JobMessage;
}

export async function completeJob(id: string): Promise<void> {
  const db = getDb();
  await db.update(jobQueue)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(jobQueue.id, id));
}

export async function failJob(id: string, error: string): Promise<void> {
  const db = getDb();
  await db.update(jobQueue)
    .set({ status: 'failed', error, completedAt: new Date() })
    .where(eq(jobQueue.id, id));
}

export async function sendToDLQ(id: string, reason: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobQueue).where(eq(jobQueue.id, id)).limit(1);
    if (!job) return;

    await tx.insert(jobDlq).values({
      id: job.id,
      type: job.type,
      payload: job.payload,
      entityType: job.entityType,
      entityId: job.entityId,
      priority: job.priority,
      scheduledFor: job.scheduledFor,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      traceId: job.traceId,
      orgId: job.orgId,
      dlqReason: reason,
    });

    await tx.delete(jobQueue).where(eq(jobQueue.id, id));
  });
}
