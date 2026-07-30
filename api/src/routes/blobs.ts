import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { blobRegistrations } from '../db/schema.js';
import { eq, and, or, ilike, sql, arrayContains, type SQL } from 'drizzle-orm';
import { escapeLike } from '../lib/escape-like.js';
import { validateTransition, validNextStates, isTerminal, StateTransitionError } from '../lib/state-machine.js';
import { emitBlobEvent } from '../lib/event-bus.js';
import { invariantChecker } from '../lib/invariant-check.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';
import { errorResponse, notFound, validationError, partialFailure } from '../lib/error-response.js';

const router = new Hono();

router.use('*', requireAuth);

const createBlobSchema = z.object({
  projectId: z.string().uuid(),
  blobId: z.string().min(1),
  name: z.string().max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentType: z.string().max(100).optional(),
  uploadDate: z.string().datetime().transform((v) => new Date(v)).optional(),
  expiryEpoch: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  suiVaultId: z.string().optional(),
  ownerAddress: z.string().optional(),
});

const updateBlobSchema = z.object({
  projectId: z.string().uuid().optional(),
  name: z.string().max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentType: z.string().max(100).optional(),
  status: z.enum(['discovered', 'verified', 'tracked', 'protected', 'expiring', 'renewing', 'renewed', 'expired', 'archived', 'deleted']).optional(),
  uploadDate: z.string().datetime().transform((v) => new Date(v)).optional(),
  expiryEpoch: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  suiVaultId: z.string().optional(),
  ownerAddress: z.string().optional(),
});

const TRANSITION_TIMESTAMP_MAP: Record<string, string> = {
  discovered: 'discoveredAt',
  verified: 'verifiedAt',
  tracked: 'trackedAt',
  protected: 'protectedAt',
  expiring: 'expiringAt',
  renewing: 'renewingAt',
  renewed: 'renewedAt',
  expired: 'expiredAt',
  archived: 'archivedAt',
  deleted: 'deletedAt',
};

const bulkActionSchema = z.object({
  action: z.enum(['archive', 'activate', 'delete']),
  ids: z.array(z.string().uuid()).min(1).max(100),
});

// Map legacy bulk actions to state machine transitions
function bulkActionToTransition(action: string): string | null {
  switch (action) {
    case 'archive': return 'archived';
    case 'activate': return 'tracked';   // reactivate → tracked
    case 'delete': return 'deleted';
    default: return null;
  }
}

router.post('/', requireOrg, requireRole('owner', 'admin', 'member'), zValidator('json', createBlobSchema), async (c) => {
  const orgId = c.get('orgId');
  invariantChecker.verifyOrgChain({ orgId });
  const input = c.req.valid('json');
  const [blob] = await withAudit(c, async (tx) => {
    return await tx.insert(blobRegistrations).values({
      ...input,
      orgId,
      status: 'discovered',
      discoveredAt: new Date(),
    }).returning();
  }, {
    event: 'blob.created',
    entityType: 'blob_registration',
    entityId: (rows) => rows[0].id,
    details: { blobId: input.blobId, name: input.name },
  });
  // Emit event
  emitBlobEvent('discovered', orgId, blob.id, { type: 'human', userId: c.get('userId') });
  return c.json(blob, 201);
});

router.get('/', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  const search = c.req.query('search');
  const status = c.req.query('status');
  const projectId = c.req.query('project_id');
  const tag = c.req.query('tag');
  const sort = c.req.query('sort') || 'desc';

  // Cursor-based pagination (Spec 14: cursor-based, not offset-based)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  // Fetch limit+1 to determine if there are more results
  const fetchLimit = limit + 1;

  const conditions: SQL[] = [eq(blobRegistrations.orgId, orgId)];

  if (search) {
    const safeSearch = escapeLike(search);
    conditions.push(or(
      ilike(blobRegistrations.name, `%${safeSearch}%`),
      ilike(blobRegistrations.blobId, `%${safeSearch}%`),
    )!);
  }
  if (status) {
    conditions.push(eq(blobRegistrations.status, status));
  }
  if (projectId) {
    conditions.push(eq(blobRegistrations.projectId, projectId));
  }
  if (tag) {
    conditions.push(arrayContains(blobRegistrations.tags, [tag]));
  }

  const where = and(...conditions)!;

  // Apply cursor-based pagination (keyset pagination)
  const sortDirection = sort === 'asc' ? 'asc' : 'desc';
  const cursorWhere = buildCursorWhere(decodedCursor, blobRegistrations.createdAt, blobRegistrations.id, sortDirection);

  const finalWhere = cursorWhere ? and(where, cursorWhere)! : where;
  const orderBy = buildCursorOrderBy(blobRegistrations.createdAt, blobRegistrations.id, sortDirection);

  const blobs = await db.select()
    .from(blobRegistrations)
    .where(finalWhere)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(
    blobs,
    limit,
    (b) => b.id,
    (b) => b.createdAt.toISOString(),
  );

  // Also return total count for UI convenience (though cursor is the primary pagination mechanism)
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(blobRegistrations).where(where);

  return c.json({
    blobs: paginated.data,
    pagination: {
      nextCursor: paginated.nextCursor,
      hasMore: paginated.hasMore,
    },
    total: Number(count),
  });
});

router.get('/export', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  // Use cursor-based pagination for export (Spec 14: all list endpoints use cursor pagination)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  // Cap export page size at 1000 to prevent OOM on large datasets
  const exportLimit = Math.min(limit, 1000);
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = exportLimit + 1;

  const cursorWhere = buildCursorWhere(decodedCursor, blobRegistrations.createdAt, blobRegistrations.id, 'desc');
  const baseConditions = eq(blobRegistrations.orgId, orgId);
  const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
  const orderBy = buildCursorOrderBy(blobRegistrations.createdAt, blobRegistrations.id, 'desc');

  const blobs = await db.select()
    .from(blobRegistrations)
    .where(finalWhere)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(blobs, exportLimit, (b) => b.id, (b) => b.createdAt.toISOString());

  return c.json({
    blobs: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

router.get('/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Blob registration ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [blob] = await db.select().from(blobRegistrations)
    .where(and(eq(blobRegistrations.id, id!), eq(blobRegistrations.orgId, orgId)))
    .limit(1);
  if (!blob) return c.json({ error: { message: 'Blob registration not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  return c.json(blob);
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin', 'member'), zValidator('json', updateBlobSchema), async (c) => {
  const orgId = c.get('orgId');
  invariantChecker.verifyOrgChain({ orgId });
  const id = c.req.param('id');
  const userId = c.get('userId');
  if (!id) return c.json({ error: { message: 'Blob registration ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const input = c.req.valid('json');
  const db = getDb();

  const [existing] = await db.select().from(blobRegistrations)
    .where(and(eq(blobRegistrations.id, id!), eq(blobRegistrations.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Blob registration not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  // State machine enforcement on status transitions
  const updateData: Record<string, unknown> = { ...input, updatedAt: new Date() };

  if (input.status && input.status !== existing.status) {
    // Validate state machine transition
    const transition = validateTransition('blob', existing.status, input.status, { allowTerminalOverride: false });

    // Spec 07: API/human-initiated transitions must be 'manual' type
    // Automatic-only transitions (e.g., discovered->verified, verified->tracked)
    // are system-driven and cannot be triggered via the PATCH API
    if (transition.type !== 'manual') {
      throw new StateTransitionError(
        'blob', existing.status, input.status,
        `Transition '${existing.status} -> ${input.status}' is '${transition.type}' and cannot be triggered via API — it must be performed by the system`,
      );
    }

    // Set the corresponding transition timestamp
    const tsField = TRANSITION_TIMESTAMP_MAP[input.status];
    if (tsField) {
      updateData[tsField] = new Date();
    }

    // Emit event for the state transition
    emitBlobEvent(input.status as any, orgId, id, { type: 'human', userId }, {
      previousStatus: existing.status,
    });
  }

  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(blobRegistrations)
      .set(updateData)
      .where(eq(blobRegistrations.id, id!))
      .returning();
  }, {
    event: 'blob.updated',
    entityType: 'blob_registration',
    entityId: id!,
    details: input,
  });
  return c.json(updated);
});

router.delete('/:id', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const userId = c.get('userId');
  if (!id) return c.json({ error: { message: 'Blob registration ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();

  const [existing] = await db.select().from(blobRegistrations)
    .where(and(eq(blobRegistrations.id, id!), eq(blobRegistrations.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Blob registration not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  // State machine: enforce that only allowed from-states can transition to deleted
  const transition = validateTransition('blob', existing.status, 'deleted');

  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(blobRegistrations)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(blobRegistrations.id, id!))
      .returning();
  }, {
    event: 'blob.deleted',
    entityType: 'blob_registration',
    entityId: id!,
  });

  emitBlobEvent('deleted', orgId, id, { type: 'human', userId }, { previousStatus: existing.status });
  return c.json(updated);
});

router.post('/bulk', requireOrg, requireRole('owner', 'admin'), zValidator('json', bulkActionSchema), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { action, ids } = c.req.valid('json');
  const db = getDb();

  // Spec 14: Partial failures reported per-item, not collapsed into single failure
  const results: Array<{ itemId: string; success: boolean; error?: string }> = [];

  // Track missing IDs upfront
  for (const id of ids) {
    results.push({ itemId: id, success: false, error: 'Not found in organization' });
  }

  const blobs = await db.select().from(blobRegistrations)
    .where(and(eq(blobRegistrations.orgId, orgId), sql`${blobRegistrations.id} = ANY(${ids}::uuid[])`));

  const foundIds = new Set(blobs.map((b) => b.id));

  // Mark found items as pending
  for (const result of results) {
    if (foundIds.has(result.itemId)) {
      result.success = true;
      result.error = undefined;
    }
  }

  if (blobs.length === 0) {
    return partialFailure(c, `No matching blobs found for action: ${action}`, results);
  }

  const targetStatus = bulkActionToTransition(action);
  if (!targetStatus) {
    return validationError(c, `Unknown bulk action: ${action}`);
  }

  // Process each blob individually for per-item error reporting (Spec 14)
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const blob of blobs) {
    try {
      // Validate state machine transition
      if (action === 'delete') {
        validateTransition('blob', blob.status, 'deleted');
      } else {
        validateTransition('blob', blob.status, targetStatus as any);
      }

      const tsField = action === 'delete' ? 'deletedAt' : TRANSITION_TIMESTAMP_MAP[targetStatus];
      const updateData: Record<string, unknown> = {
        status: targetStatus,
        updatedAt: new Date(),
      };
      if (tsField) updateData[tsField] = new Date();

      await db.update(blobRegistrations)
        .set(updateData)
        .where(eq(blobRegistrations.id, blob.id));

      // Emit event
      emitBlobEvent(targetStatus as any, orgId, blob.id, { type: 'human', userId }, { previousStatus: blob.status });

      succeeded.push(blob.id);
      // Update result entry
      const result = results.find((r) => r.itemId === blob.id);
      if (result) {
        result.success = true;
        result.error = undefined;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      failed.push({ id: blob.id, error: errorMsg });
      // Update result entry
      const result = results.find((r) => r.itemId === blob.id);
      if (result) {
        result.success = false;
        result.error = errorMsg;
      }
    }
  }

  await logAudit(c, `blob.bulk.${action}`, 'blob_registration', undefined, { succeeded, failed, total: ids.length });

  // Spec 14: Return per-item results. Use 207 if any failures, 202 if all succeeded.
  const allSucceeded = failed.length === 0;
  const someSucceeded = succeeded.length > 0;

  if (allSucceeded) {
    return c.json({
      message: `Bulk ${action} completed for ${succeeded.length} blobs`,
      results,
      processed: succeeded.length,
      skipped: ids.length - succeeded.length,
    }, 202);
  } else if (someSucceeded) {
    return partialFailure(c, `Bulk ${action}: ${succeeded.length} succeeded, ${failed.length} failed`, results);
  } else {
    return c.json({
      error: {
        message: `Bulk ${action}: all ${failed.length} items failed`,
        code: 'VALIDATION_ERROR',
        failureClass: 'persistent',
        requestId: c.get('requestId'),
        results,
      },
    }, 400);
  }
});

// ── Helper: get available transitions for a blob ───────────────
router.get('/:id/transitions', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = getDb();

  const [blob] = await db.select().from(blobRegistrations)
    .where(and(eq(blobRegistrations.id, id!), eq(blobRegistrations.orgId, orgId)))
    .limit(1);
  if (!blob) return c.json({ error: { message: 'Blob registration not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  const nextStates = validNextStates('blob', blob.status);
  return c.json({
    currentState: blob.status,
    isTerminal: isTerminal('blob', blob.status),
    availableTransitions: nextStates,
  });
});

export { router as blobRoutes };
