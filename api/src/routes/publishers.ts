import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { publishers } from '../db/schema.js';
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
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  endpoint: z.string().optional(),
  walletAddress: z.string().optional(),
  suiVaultId: z.string().optional(),
});

const updateSchema = createSchema.partial();

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');
    const db = getDb();
    const [publisher] = await db.insert(publishers).values({ ...input, orgId }).returning();
    await logAudit(c, 'publisher.created', 'publisher', publisher.id, { name: publisher.name });
    return c.json(publisher, 201);
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
    if (c.req.query('name')) filters.push(ilike(publishers.name, `%${c.req.query('name')}%`));

    const baseConditions = includeDeleted
      ? and(eq(publishers.orgId, orgId), ...filters)
      : and(eq(publishers.orgId, orgId), sql`${publishers.status} IS DISTINCT FROM 'deleted'`, ...filters);

    const cursorWhere = buildCursorWhere(decodedCursor, publishers.createdAt, publishers.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(publishers.createdAt, publishers.id, 'desc');

    const list = await db.select().from(publishers).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (p) => p.id, (p) => p.createdAt.toISOString());

    return c.json({
      publishers: paginated.data,
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
    if (!id) return c.json({ error: { message: 'Publisher ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [publisher] = await db.select().from(publishers)
      .where(and(eq(publishers.id, id), eq(publishers.orgId, orgId)))
      .limit(1);
    if (!publisher) return c.json({ error: { message: 'Publisher not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(publisher);
  } catch (error) {
    throw error;
  }
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin'), zValidator('json', updateSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Publisher ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(publishers)
      .where(and(eq(publishers.id, id), eq(publishers.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Publisher not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [updated] = await db.update(publishers).set({ ...input, updatedAt: new Date() })
      .where(eq(publishers.id, id)).returning();
    await logAudit(c, 'publisher.updated', 'publisher', updated.id, input);
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
    if (!id) return c.json({ error: { message: 'Publisher ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(publishers)
      .where(and(eq(publishers.id, id), eq(publishers.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Publisher not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status === 'deleted') return c.json({ error: { message: 'Publisher already deleted', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    await db.update(publishers).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(publishers.id, id));
    await logAudit(c, 'publisher.deleted', 'publisher', id);
    return c.json({ message: 'Publisher deleted' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/heartbeat', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Publisher ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(publishers)
      .where(and(eq(publishers.id, id), eq(publishers.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Publisher not found', code: ErrorCodes.NOT_FOUND } }, 404);
    await db.update(publishers).set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(eq(publishers.id, id));
    return c.json({ message: 'Heartbeat recorded' });
  } catch (error) {
    throw error;
  }
});

export { router as publisherRoutes };
