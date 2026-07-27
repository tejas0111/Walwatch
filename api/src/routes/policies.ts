import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { policies, policyAssignments } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { validateTransition } from '../lib/state-machine.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import { policyEngine } from '../lib/policy-engine.js';
import { snapshotPolicyOnStart } from '../lib/edge-cases.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();

router.use('*', requireAuth);

const createPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  rules: z.array(z.record(z.unknown())).default([]),
  renewThreshold: z.number().int().nonnegative(),
  renewExtension: z.number().int().nonnegative(),
  maxTotalEpochs: z.number().int().nonnegative().optional(),
  autoRenewalEnabled: z.boolean().optional(),
  active: z.boolean().optional(),
  scope: z.enum(['organization', 'project', 'wallet', 'blob', 'tag']).optional(),
  scopeTargetId: z.string().uuid().optional(),
  budgetId: z.string().uuid().optional(),
  spendingLimitId: z.string().uuid().optional(),
  publisherPriorityOverride: z.number().int().nonnegative().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
});

const updatePolicySchema = createPolicySchema.partial();

const assignSchema = z.object({
  blob_ids: z.array(z.string().uuid()).min(1),
});

router.post('/', requireOrg, requireCapability(Capability.MANAGE_POLICIES), zValidator('json', createPolicySchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const input = c.req.valid('json');

    // Validate that scope requires scopeTargetId for non-organization scopes
    if (input.scope && input.scope !== 'organization' && !input.scopeTargetId) {
      return c.json({
        error: { message: `scopeTargetId is required for scope '${input.scope}'`, code: ErrorCodes.VALIDATION_ERROR },
      }, 400);
    }

    const [policy] = await withAudit(c, async (tx) => {
      return await tx.insert(policies).values({ ...input, orgId }).returning();
    }, {
      event: 'policy.created',
      entityType: 'policy',
      entityId: (rows) => rows[0].id,
      details: { name: input.name },
    });
    const policySnapshot = snapshotPolicyOnStart(policy);
    emit(createEvent(EventNames.POLICY_CREATED, orgId, 'policy', policy.id, { type: 'human', userId }));
    return c.json({ ...policy, snapshot: policySnapshot }, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.get('/', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const includeDeleted = c.req.query('include_deleted') === 'true';

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const baseConditions = includeDeleted
      ? eq(policies.orgId, orgId)
      : and(eq(policies.orgId, orgId), sql`${policies.status} IS DISTINCT FROM 'archived'`);

    const cursorWhere = buildCursorWhere(decodedCursor, policies.createdAt, policies.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(policies.createdAt, policies.id, 'desc');

    const list = await db.select().from(policies).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (p) => p.id, (p) => p.createdAt.toISOString());

    return c.json({
      policies: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.get('/:id', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [policy] = await db.select().from(policies)
      .where(and(eq(policies.id, id), eq(policies.orgId, orgId)))
      .limit(1);
    if (!policy) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const assignments = await db.select().from(policyAssignments)
      .where(eq(policyAssignments.policyId, id));
    return c.json({ ...policy, assignments });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.patch('/:id', requireOrg, requireCapability(Capability.MANAGE_POLICIES), zValidator('json', updatePolicySchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(policies)
      .where(and(eq(policies.id, id), eq(policies.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);

    // Validate scope/scopeTargetId consistency on update
    if (input.scope && input.scope !== 'organization' && !input.scopeTargetId && !existing.scopeTargetId) {
      return c.json({
        error: { message: `scopeTargetId is required for scope '${input.scope}'`, code: ErrorCodes.VALIDATION_ERROR },
      }, 400);
    }

    // Record both prior and new values in audit log (Spec 18: "prior value")
    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(input)) {
      const k = key as keyof typeof input;
      if (input[k] !== undefined && (existing as any)[k] !== undefined) {
        changedFields[key] = { from: (existing as any)[k], to: input[k] };
      }
    }

    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(policies)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(policies.id, id))
        .returning();
    }, {
      event: 'policy.updated',
      entityType: 'policy',
      entityId: id,
      details: { changes: changedFields, input },
    });
    return c.json(updated);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

// ── State Machine Transitions ─────────────────────────────────

router.post('/:id/pause', requireOrg, requireCapability(Capability.MANAGE_POLICIES), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const policyId = c.req.param('id');
    if (!policyId) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [policy] = await db.select().from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
      .limit(1);
    if (!policy) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('policy', policy.status, 'paused');

    await withAudit(c, async (tx) => {
      await tx.update(policies).set({ status: 'paused', active: false, updatedAt: new Date() })
        .where(eq(policies.id, policyId));
    }, {
      event: 'policy.paused',
      entityType: 'policy',
      entityId: policyId,
    });
    emit(createEvent(EventNames.POLICY_PAUSED, orgId, 'policy', policyId, { type: 'human', userId }));
    return c.json({ message: 'Policy paused. In-progress renewals continue.' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/activate', requireOrg, requireCapability(Capability.MANAGE_POLICIES), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const policyId = c.req.param('id');
    if (!policyId) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [policy] = await db.select().from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
      .limit(1);
    if (!policy) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('policy', policy.status, 'active');

    await withAudit(c, async (tx) => {
      await tx.update(policies).set({ status: 'active', active: true, updatedAt: new Date() })
        .where(eq(policies.id, policyId));
    }, {
      event: 'policy.activated',
      entityType: 'policy',
      entityId: policyId,
    });
    emit(createEvent(EventNames.POLICY_ACTIVATED, orgId, 'policy', policyId, { type: 'human', userId }));
    return c.json({ message: 'Policy activated' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/archive', requireOrg, requireCapability(Capability.MANAGE_POLICIES), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const policyId = c.req.param('id');
    if (!policyId) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [policy] = await db.select().from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
      .limit(1);
    if (!policy) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('policy', policy.status, 'archived');

    await withAudit(c, async (tx) => {
      await tx.update(policies).set({ status: 'archived', active: false, updatedAt: new Date() })
        .where(eq(policies.id, policyId));
    }, {
      event: 'policy.archived',
      entityType: 'policy',
      entityId: policyId,
    });
    emit(createEvent(EventNames.POLICY_ARCHIVED, orgId, 'policy', policyId, { type: 'human', userId }));
    return c.json({ message: 'Policy archived' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.delete('/:id', requireOrg, requireCapability(Capability.MANAGE_POLICIES), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const policyId = c.req.param('id');
    if (!policyId) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [policy] = await db.select().from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
      .limit(1);
    if (!policy) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('policy', policy.status, 'archived');

    await withAudit(c, async (tx) => {
      await tx.update(policies).set({ status: 'archived', active: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(policies.id, policyId));
    }, {
      event: 'policy.deleted',
      entityType: 'policy',
      entityId: policyId,
    });
    emit(createEvent(EventNames.POLICY_ARCHIVED, orgId, 'policy', policyId, { type: 'human', userId }));
    return c.json({ message: 'Policy deleted' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/assign', requireOrg, requireCapability(Capability.MANAGE_POLICIES), zValidator('json', assignSchema), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
  const { blob_ids } = c.req.valid('json');
  try {
    const db = getDb();
    const [existing] = await db.select().from(policies)
      .where(and(eq(policies.id, id), eq(policies.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const inserted = await withAudit(c, async (tx) => {
      const values = blob_ids.map((blobRegistrationId) => ({ policyId: id, blobRegistrationId }));
      return await tx.insert(policyAssignments).values(values).onConflictDoNothing().returning();
    }, {
      event: 'policy.assign',
      entityType: 'policy',
      entityId: id,
      details: { blob_ids },
    });
    return c.json({ assigned: inserted.length });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/unassign', requireOrg, requireCapability(Capability.MANAGE_POLICIES), zValidator('json', assignSchema), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Policy ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
  const { blob_ids } = c.req.valid('json');
  try {
    const db = getDb();
    const [existing] = await db.select().from(policies)
      .where(and(eq(policies.id, id), eq(policies.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Policy not found', code: ErrorCodes.NOT_FOUND } }, 404);
    await withAudit(c, async (tx) => {
      await tx.delete(policyAssignments)
        .where(
          and(
            eq(policyAssignments.policyId, id),
            inArray(policyAssignments.blobRegistrationId, blob_ids),
          ),
        );
    }, {
      event: 'policy.unassign',
      entityType: 'policy',
      entityId: id,
      details: { blob_ids },
    });
    return c.json({ unassigned: blob_ids.length });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/resolve', requireOrg, requireCapability(Capability.MANAGE_POLICIES), zValidator('json', z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  walletId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
})), async (c) => {
  try {
    const input = c.req.valid('json');
    const resolved = await policyEngine.resolveFromScope(input);
    return c.json(resolved);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.get('/resolve/:blobId', requireAuth, requireOrg, async (c) => {
  try {
    const { blobId } = c.req.param();
    const resolved = await policyEngine.resolveEffectivePolicy(blobId);
    return c.json(resolved);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

export { router as policyRoutes };
