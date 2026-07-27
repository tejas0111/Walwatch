import { claimNextJob, completeJob, failJob, sendToDLQ, publishJob, type JobMessage } from './queue.js';
import { emit, EventNames, createEvent } from './event-bus.js';
import { getTraceId } from './trace-context.js';

type JobHandler = (job: JobMessage) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerHandler(type: string, handler: JobHandler): void {
  if (handlers.has(type)) {
    throw new Error(`Handler for job type '${type}' is already registered`);
  }
  handlers.set(type, handler);
}

export async function publish(
  type: string,
  payload: unknown,
  entityType: string,
  entityId: string,
  priority?: number,
  scheduledFor?: Date,
  maxAttempts?: number,
  traceId?: string,
): Promise<string> {
  return publishJob({
    type,
    payload,
    entityType,
    entityId,
    priority: priority ?? 50,
    scheduledFor: scheduledFor ?? new Date(),
    maxAttempts: maxAttempts ?? 5,
    traceId: traceId ?? getTraceId(),
  });
}

export async function processNextJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  const handler = handlers.get(job.type);
  if (!handler) {
    await failJob(job.id, `No handler registered for job type '${job.type}'`);
    return true;
  }

  const traceId = job.traceId ?? getTraceId();

  try {
    await handler(job);
    await completeJob(job.id);
    emit(createEvent(EventNames.JOB_COMPLETED, (job as any).orgId, job.entityType, job.entityId, { type: 'system' }, { jobType: job.type }, traceId));
  } catch (err) {
    const errMsg = (err as Error).message;
    if (job.attempts + 1 >= job.maxAttempts) {
      await sendToDLQ(job.id, errMsg);
      emit(createEvent(EventNames.JOB_FAILED_FINAL, (job as any).orgId, job.entityType, job.entityId, { type: 'system' }, { jobType: job.type, error: errMsg }, traceId));
    } else {
      await failJob(job.id, errMsg);
    }
  }

  return true;
}
