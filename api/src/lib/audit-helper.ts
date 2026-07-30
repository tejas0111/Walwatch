import { getDb } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import type { Context } from 'hono';

type DbInstance = ReturnType<typeof getDb>;

export async function withAudit<T>(
  c: Context,
  fn: (tx: DbInstance) => Promise<T>,
  audit: {
    event: string;
    entityType: string;
    entityId: string | ((result: T) => string);
    details?: Record<string, unknown>;
  },
): Promise<T> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const result = await fn(tx as unknown as DbInstance);

    const userId = c.get('userId') ?? null;
    const orgId = c.get('orgId');
    const traceId = c.get('requestId') as string | undefined;
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null;

    const entityId = typeof audit.entityId === 'function' ? audit.entityId(result) : audit.entityId;

    await tx.insert(auditLogs).values({
      orgId,
      userId: userId || null,
      action: audit.event,
      resourceType: audit.entityType,
      resourceId: entityId || null,
      details: audit.details as any ?? {},
      ipAddress,
      traceId: traceId || null,
    });

    return result;
  }) as Promise<T>;
}
