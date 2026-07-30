import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { budgets } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { validateTransition } from '../lib/state-machine.js';
import { emit, createEvent, EventNames } from '../lib/event-bus.js';
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

const createSchema = z.object({
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  amount: z.number().int().nonnegative(),
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  currency: z.string().optional(),
  alertThreshold: z.number().int().min(1).max(100).optional(),
});

const updateSchema = createSchema.partial();

router.post('/', requireOrg, requireCapability(Capability.MANAGE_BUDGETS), zValidator('json', createSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');

    const [budget] = await withAudit(c, async (tx) => {
      return await tx.insert(budgets).values({ ...input, orgId }).returning();
    }, {
      event: 'budget.created',
      entityType: 'budget',
      entityId: (rows) => rows[0].id,
      details: { name: input.name, amount: input.amount },
    });
    await emit(createEvent(EventNames.BUDGET_CREATED, orgId, 'budget', budget.id, { type: 'human', userId: c.get('userId') }, { name: budget.name, amount: budget.amount }));
    return c.json(budget, 201);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
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
      ? eq(budgets.orgId, orgId)
      : and(eq(budgets.orgId, orgId), sql`${budgets.status} IS DISTINCT FROM 'deleted' AND ${budgets.status} IS DISTINCT FROM 'archived'`);

    const cursorWhere = buildCursorWhere(decodedCursor, budgets.createdAt, budgets.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(budgets.createdAt, budgets.id, 'desc');

    const list = await db.select().from(budgets).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (b) => b.id, (b) => b.createdAt.toISOString());

    return c.json({
      budgets: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/:id', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Budget ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [budget] = await db.select().from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
      .limit(1);
    if (!budget) return c.json({ error: { message: 'Budget not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(budget);
  } catch (error) {
    throw error;
  }
});

router.patch('/:id', requireOrg, requireCapability(Capability.MANAGE_BUDGETS), zValidator('json', updateSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Budget ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Budget not found', code: ErrorCodes.NOT_FOUND } }, 404);
    // Record both prior and new values in audit log (Spec 18: "prior value")
    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(input)) {
      const k = key as keyof typeof input;
      if (input[k] !== undefined && (existing as any)[k] !== undefined) {
        changedFields[key] = { from: (existing as any)[k], to: input[k] };
      }
    }
    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(budgets).set({ ...input, updatedAt: new Date() })
        .where(eq(budgets.id, id)).returning();
    }, {
      event: 'budget.updated',
      entityType: 'budget',
      entityId: id,
      details: { changes: changedFields, input },
    });
    // Budget updates are logged via audit log; no spec-defined event for generic updates
    return c.json(updated);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.delete('/:id', requireOrg, requireCapability(Capability.MANAGE_BUDGETS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Budget ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Budget not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status === 'archived') return c.json({ error: { message: 'Budget already archived', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    validateTransition('budget', existing.status, 'archived');
    await withAudit(c, async (tx) => {
      await tx.update(budgets).set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(budgets.id, id));
    }, {
      event: 'budget.archived',
      entityType: 'budget',
      entityId: id,
    });
    await emit(createEvent(EventNames.BUDGET_ARCHIVED, orgId, 'budget', id, { type: 'human', userId: c.get('userId') }));
    return c.json({ message: 'Budget archived' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/close-window', requireOrg, requireCapability(Capability.MANAGE_BUDGETS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Budget ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Budget not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status !== 'active') return c.json({ error: { message: 'Only active budgets can have their window closed', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    validateTransition('budget', existing.status, 'window_closed');
    await withAudit(c, async (tx) => {
      await tx.update(budgets).set({ status: 'window_closed', updatedAt: new Date() }).where(eq(budgets.id, id));
    }, {
      event: 'budget.window_closed',
      entityType: 'budget',
      entityId: id,
    });
    await emit(createEvent(EventNames.BUDGET_WINDOW_CLOSED, orgId, 'budget', id, { type: 'human', userId }));
    return c.json({ message: 'Budget window closed' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

// Spent is derived from cost_records at query time — no manual override endpoint.
// See cost-engine.ts getBudgetSpent() for the derived spent computation.

router.post('/:id/activate', requireOrg, requireCapability(Capability.MANAGE_BUDGETS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Budget ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Budget not found', code: ErrorCodes.NOT_FOUND } }, 404);
    // Spec 25: defined→active or window_closed→active transitions
    if (existing.status !== 'defined' && existing.status !== 'window_closed') {
      return c.json({
        error: { message: `Budget in '${existing.status}' cannot be activated — only 'defined' or 'window_closed' budgets can be activated`, code: ErrorCodes.VALIDATION_ERROR },
      }, 400);
    }
    validateTransition('budget', existing.status, 'active');
    await withAudit(c, async (tx) => {
      await tx.update(budgets).set({ status: 'active', updatedAt: new Date() }).where(eq(budgets.id, id));
    }, {
      event: 'budget.activated',
      entityType: 'budget',
      entityId: id,
    });
    await emit(createEvent(EventNames.BUDGET_ACTIVATED, orgId, 'budget', id, { type: 'human', userId }));
    return c.json({ message: 'Budget activated' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/archive', requireOrg, requireCapability(Capability.MANAGE_BUDGETS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Budget ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Budget not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status === 'archived') return c.json({ error: { message: 'Budget already archived', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    validateTransition('budget', existing.status, 'archived');
    await withAudit(c, async (tx) => {
      await tx.update(budgets).set({ status: 'archived', updatedAt: new Date() }).where(eq(budgets.id, id));
    }, {
      event: 'budget.archived',
      entityType: 'budget',
      entityId: id,
    });
    await emit(createEvent(EventNames.BUDGET_ARCHIVED, orgId, 'budget', id, { type: 'human', userId: c.get('userId') }));
    return c.json({ message: 'Budget archived' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

export { router as budgetRoutes };
