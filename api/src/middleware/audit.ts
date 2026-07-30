import { Context } from 'hono';
import pino from 'pino';
import { getDb } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

const logger = pino({ name: 'audit' });

/**
 * Write an Audit Log entry.
 *
 * Supports both human actors (via Hono context) and system actors (via explicit params).
 * For human actors: use `logAudit(c, ...)` which extracts orgId/userId/ip from context.
 * For system actors: use `logAuditSystem(...)` with explicit params.
 */
export async function logAudit(c: Context, action: string, resourceType: string, resourceId?: string, details?: Record<string, unknown>) {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const traceId = c.get('requestId') as string | undefined;

  if (!orgId) {
    logger.warn({ action, resourceType }, 'Audit log skipped: no orgId in context');
    return;
  }

  try {
    const db = getDb();
    await db.insert(auditLogs).values({
      orgId,
      userId: userId || null,
      action,
      resourceType,
      resourceId: resourceId || null,
      details: details || {},
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null,
      traceId: traceId || null,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to write audit log');
  }
}

/**
 * Write an Audit Log entry for system-generated events (keeper worker, scheduler, etc.)
 * These bypass the Hono context and use explicit parameters.
 */
export async function logAuditSystem(
  orgId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, unknown>,
  traceId?: string,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(auditLogs).values({
      orgId,
      userId: null,  // system-generated
      action,
      resourceType,
      resourceId: resourceId || null,
      details: details || {},
      ipAddress: null,
      traceId: traceId || null,
    });
  } catch (error) {
    logger.error({ error, orgId, action }, 'Failed to write system audit log');
  }
}
