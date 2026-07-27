import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { spendingLimits, wallets, projects, policies, organizations } from '../db/schema.js';
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
  scope: z.enum(['organization', 'project', 'wallet', 'policy']),
  scopeTargetId: z.string().uuid(),
  name: z.string().optional(),
  amount: z.number().int().nonnegative(),
  period: z.enum(['daily', 'weekly', 'monthly']).optional(),
});

const updateSchema = createSchema.partial();

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');

    const [limit] = await withAudit(c, async (tx) => {
      // Validate scope target exists within org — inside the transaction to avoid TOCTOU
      if (input.scope === 'wallet') {
        const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.id, input.scopeTargetId), eq(wallets.orgId, orgId))).limit(1);
        if (!wallet) throw new AppError('Wallet not found in org', 404, ErrorCodes.NOT_FOUND);
      } else if (input.scope === 'project') {
        const [project] = await tx.select().from(projects).where(and(eq(projects.id, input.scopeTargetId), eq(projects.orgId, orgId))).limit(1);
        if (!project) throw new AppError('Project not found in org', 404, ErrorCodes.NOT_FOUND);
      } else if (input.scope === 'organization') {
        if (input.scopeTargetId !== orgId) throw new AppError('Organization scope target must match current org', 400, ErrorCodes.VALIDATION_ERROR);
      } else if (input.scope === 'policy') {
        const [policy] = await tx.select().from(policies).where(and(eq(policies.id, input.scopeTargetId), eq(policies.orgId, orgId))).limit(1);
        if (!policy) throw new AppError('Policy not found in org', 404, ErrorCodes.NOT_FOUND);
      }
      return await tx.insert(spendingLimits).values({ scope: input.scope, scopeTargetId: input.scopeTargetId, name: input.name, amount: input.amount, period: input.period, orgId }).returning();
    }, {
      event: 'spending_limit.created',
      entityType: 'spending_limit',
      entityId: (rows) => rows[0].id,
      details: { scope: input.scope, scopeTargetId: input.scopeTargetId, amount: input.amount },
    });
    await emit(createEvent(EventNames.SPENDING_LIMIT_CREATED, orgId, 'spending_limit', limit.id, { type: 'human', userId: c.get('userId') }, { scope: input.scope, scopeTargetId: input.scopeTargetId, amount: input.amount }));
    return c.json(limit, 201);
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

    const filters = [];
    if (c.req.query('scope')) filters.push(sql`${spendingLimits.scope} = ${c.req.query('scope')}`);
    if (c.req.query('walletId')) filters.push(eq(spendingLimits.scopeTargetId, c.req.query('walletId')!));

    const baseConditions = includeDeleted
      ? and(eq(spendingLimits.orgId, orgId), ...filters)
      : and(eq(spendingLimits.orgId, orgId), eq(spendingLimits.status, 'active'), ...filters);

    const cursorWhere = buildCursorWhere(decodedCursor, spendingLimits.createdAt, spendingLimits.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(spendingLimits.createdAt, spendingLimits.id, 'desc');

    const list = await db.select().from(spendingLimits).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (s) => s.id, (s) => s.createdAt.toISOString());

    return c.json({
      spendingLimits: paginated.data,
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
    if (!id) return c.json({ error: { message: 'Spending limit ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [limit] = await db.select().from(spendingLimits)
      .where(and(eq(spendingLimits.id, id), eq(spendingLimits.orgId, orgId)))
      .limit(1);
    if (!limit) return c.json({ error: { message: 'Spending limit not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(limit);
  } catch (error) {
    throw error;
  }
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin'), zValidator('json', updateSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Spending limit ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(spendingLimits)
      .where(and(eq(spendingLimits.id, id), eq(spendingLimits.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Spending limit not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(spendingLimits).set({ ...input, updatedAt: new Date() })
        .where(eq(spendingLimits.id, id)).returning();
    }, {
      event: 'spending_limit.updated',
      entityType: 'spending_limit',
      entityId: id,
      details: input,
    });
    // Updates are logged via audit log; no spec-defined event for generic updates
    return c.json(updated);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.delete('/:id', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Spending limit ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(spendingLimits)
      .where(and(eq(spendingLimits.id, id), eq(spendingLimits.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Spending limit not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status === 'deleted') return c.json({ error: { message: 'Spending limit already deleted', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    validateTransition('spending_limit', existing.status, 'archived');
    await withAudit(c, async (tx) => {
      await tx.update(spendingLimits).set({ status: 'archived', deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(spendingLimits.id, id));
    }, {
      event: 'spending_limit.deleted',
      entityType: 'spending_limit',
      entityId: id,
    });
    await emit(createEvent(EventNames.SPENDING_LIMIT_ARCHIVED, orgId, 'spending_limit', id, { type: 'human', userId: c.get('userId') }));
    return c.json({ message: 'Spending limit archived' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/activate', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Spending limit ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(spendingLimits)
      .where(and(eq(spendingLimits.id, id), eq(spendingLimits.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Spending limit not found', code: ErrorCodes.NOT_FOUND } }, 404);
    validateTransition('spending_limit', existing.status, 'active');
    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(spendingLimits).set({ status: 'active', updatedAt: new Date() })
        .where(eq(spendingLimits.id, id)).returning();
    }, {
      event: 'spending_limit.activated',
      entityType: 'spending_limit',
      entityId: id,
    });
    await emit(createEvent(EventNames.SPENDING_LIMIT_ACTIVATED, orgId, 'spending_limit', id, { type: 'human', userId: c.get('userId') }));
    return c.json(updated);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/pause', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Spending limit ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(spendingLimits)
      .where(and(eq(spendingLimits.id, id), eq(spendingLimits.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Spending limit not found', code: ErrorCodes.NOT_FOUND } }, 404);
    validateTransition('spending_limit', existing.status, 'paused');
    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(spendingLimits).set({ status: 'paused', updatedAt: new Date() })
        .where(eq(spendingLimits.id, id)).returning();
    }, {
      event: 'spending_limit.paused',
      entityType: 'spending_limit',
      entityId: id,
    });
    await emit(createEvent(EventNames.SPENDING_LIMIT_PAUSED, orgId, 'spending_limit', id, { type: 'human', userId: c.get('userId') }));
    return c.json(updated);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

export { router as spendingLimitRoutes };
