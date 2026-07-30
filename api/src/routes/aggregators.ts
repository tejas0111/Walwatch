import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { aggregators } from '../db/schema.js';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { AppError, ErrorCodes } from '../lib/errors.js';
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
  publisherId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  endpoint: z.string().optional(),
});

const updateSchema = createSchema.partial();

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');
    const db = getDb();
    const [aggregator] = await db.insert(aggregators).values({ ...input, orgId }).returning();
    await logAudit(c, 'aggregator.created', 'aggregator', aggregator.id, { name: aggregator.name });
    return c.json(aggregator, 201);
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
    if (c.req.query('name')) filters.push(ilike(aggregators.name, `%${c.req.query('name')}%`));

    const baseConditions = includeDeleted
      ? and(eq(aggregators.orgId, orgId), ...filters)
      : and(eq(aggregators.orgId, orgId), sql`${aggregators.status} IS DISTINCT FROM 'deleted'`, ...filters);

    const cursorWhere = buildCursorWhere(decodedCursor, aggregators.createdAt, aggregators.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(aggregators.createdAt, aggregators.id, 'desc');

    const list = await db.select().from(aggregators).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (a) => a.id, (a) => a.createdAt.toISOString());

    return c.json({
      aggregators: paginated.data,
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
    if (!id) return c.json({ error: { message: 'Aggregator ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [aggregator] = await db.select().from(aggregators)
      .where(and(eq(aggregators.id, id), eq(aggregators.orgId, orgId)))
      .limit(1);
    if (!aggregator) return c.json({ error: { message: 'Aggregator not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(aggregator);
  } catch (error) {
    throw error;
  }
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin'), zValidator('json', updateSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Aggregator ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(aggregators)
      .where(and(eq(aggregators.id, id), eq(aggregators.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Aggregator not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [updated] = await db.update(aggregators).set({ ...input, updatedAt: new Date() })
      .where(eq(aggregators.id, id)).returning();
    await logAudit(c, 'aggregator.updated', 'aggregator', updated.id, input);
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
    if (!id) return c.json({ error: { message: 'Aggregator ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(aggregators)
      .where(and(eq(aggregators.id, id), eq(aggregators.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Aggregator not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status === 'deleted') return c.json({ error: { message: 'Aggregator already deleted', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    await db.update(aggregators).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(aggregators.id, id));
    await logAudit(c, 'aggregator.deleted', 'aggregator', id);
    return c.json({ message: 'Aggregator deleted' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/heartbeat', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Aggregator ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(aggregators)
      .where(and(eq(aggregators.id, id), eq(aggregators.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Aggregator not found', code: ErrorCodes.NOT_FOUND } }, 404);
    await db.update(aggregators).set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(eq(aggregators.id, id));
    return c.json({ message: 'Heartbeat recorded' });
  } catch (error) {
    throw error;
  }
});

export { router as aggregatorRoutes };
