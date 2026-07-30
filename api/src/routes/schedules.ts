import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { schedules, scheduleRuns } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { validateTransition } from '../lib/state-machine.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();
router.use('*', requireAuth);

// System-enforced bounds for user-configurable schedules (spec 10):
// Users cannot set min interval lower than this (would risk missing guarantees)
const SYSTEM_MIN_INTERVAL_MS = 60_000;      // 1 minute floor
// Users cannot leave staleness window wider than this (would let blobs pass lead-time)
const SYSTEM_MAX_STALENESS_MS = 86_400_000;  // 24 hours ceiling

const createSchema = z.object({
  name: z.string().min(1).max(255),
  cronExpr: z.string().min(1),
  minIntervalMs: z.number().int().nonnegative().optional(),
  maxStalenessMs: z.number().int().nonnegative().optional(),
  config: z.record(z.unknown()).optional(),
}).refine(
  (data) => data.minIntervalMs === undefined || data.minIntervalMs >= SYSTEM_MIN_INTERVAL_MS,
  { message: `minIntervalMs cannot be less than system floor of ${SYSTEM_MIN_INTERVAL_MS}ms`, path: ['minIntervalMs'] },
).refine(
  (data) => data.maxStalenessMs === undefined || data.maxStalenessMs <= SYSTEM_MAX_STALENESS_MS,
  { message: `maxStalenessMs cannot exceed system ceiling of ${SYSTEM_MAX_STALENESS_MS}ms`, path: ['maxStalenessMs'] },
);

const updateSchema = z.object({
  cronExpr: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(255).optional(),
  minIntervalMs: z.number().int().nonnegative().optional(),
  maxStalenessMs: z.number().int().nonnegative().optional(),
  config: z.record(z.unknown()).optional(),
}).refine(
  (data) => data.minIntervalMs === undefined || data.minIntervalMs >= SYSTEM_MIN_INTERVAL_MS,
  { message: `minIntervalMs cannot be less than system floor of ${SYSTEM_MIN_INTERVAL_MS}ms`, path: ['minIntervalMs'] },
).refine(
  (data) => data.maxStalenessMs === undefined || data.maxStalenessMs <= SYSTEM_MAX_STALENESS_MS,
  { message: `maxStalenessMs cannot exceed system ceiling of ${SYSTEM_MAX_STALENESS_MS}ms`, path: ['maxStalenessMs'] },
);

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createSchema), async (c) => {
  const orgId = c.get('orgId');
  const input = c.req.valid('json');
  const db = getDb();
  const [existing] = await db.select().from(schedules)
    .where(and(eq(schedules.orgId, orgId), eq(schedules.name, input.name)))
    .limit(1);
  if (existing) return c.json({ error: { message: 'Schedule with this name already exists', code: 'CONFLICT' } }, 409);
  const [schedule] = await withAudit(c, async (tx) => {
    return await tx.insert(schedules).values({
      name: input.name,
      orgId,
      type: 'user',
      cronExpr: input.cronExpr,
      minIntervalMs: input.minIntervalMs ?? SYSTEM_MIN_INTERVAL_MS,
      maxStalenessMs: input.maxStalenessMs ?? SYSTEM_MAX_STALENESS_MS,
      config: input.config ?? {},
    }).returning();
  }, {
    event: 'schedule.created',
    entityType: 'schedule',
    entityId: (rows) => rows[0].id,
    details: { name: input.name },
  });
  return c.json(schedule, 201);
});

router.get('/', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();
  const typeFilter = c.req.query('type');

  // Cursor-based pagination (Spec 14)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const baseConditions = typeFilter
    ? and(eq(schedules.orgId, orgId), eq(schedules.type, typeFilter))
    : eq(schedules.orgId, orgId);

  const cursorWhere = buildCursorWhere(decodedCursor, schedules.createdAt, schedules.id, 'desc');
  const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
  const orderBy = buildCursorOrderBy(schedules.createdAt, schedules.id, 'desc');

  const list = await db.select().from(schedules)
    .where(finalWhere)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(list, limit, (s) => s.id, (s) => s.createdAt.toISOString());

  return c.json({
    schedules: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

router.get('/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Schedule ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();
  const [schedule] = await db.select().from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.orgId, orgId)))
    .limit(1);
  if (!schedule) return c.json({ error: { message: 'Schedule not found', code: 'NOT_FOUND' } }, 404);
  return c.json(schedule);
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin'), zValidator('json', updateSchema), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Schedule ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const input = c.req.valid('json');
  const db = getDb();
  const [existing] = await db.select().from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Schedule not found', code: 'NOT_FOUND' } }, 404);
  // System schedules cannot be modified by users (spec 10)
  if (existing.type === 'system') {
    return c.json({ error: { message: 'System schedules are not user-configurable', code: 'FORBIDDEN' } }, 403);
  }
  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(schedules).set({ ...input, updatedAt: new Date() })
      .where(eq(schedules.id, id)).returning();
  }, {
    event: 'schedule.updated',
    entityType: 'schedule',
    entityId: id,
    details: input,
  });
  return c.json(updated);
});

router.post('/:id/pause', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Schedule ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Schedule not found', code: 'NOT_FOUND' } }, 404);
  const currentStatus = existing.status || 'active';
  validateTransition('schedule', currentStatus, 'paused');
  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(schedules).set({ status: 'paused', updatedAt: new Date() })
      .where(eq(schedules.id, id)).returning();
  }, {
    event: 'schedule.paused',
    entityType: 'schedule',
    entityId: id,
  });
  return c.json(updated);
});

router.post('/:id/activate', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Schedule ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Schedule not found', code: 'NOT_FOUND' } }, 404);
  const currentStatus = existing.status || 'active';
  validateTransition('schedule', currentStatus, 'active');
  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(schedules).set({ status: 'active', updatedAt: new Date() })
      .where(eq(schedules.id, id)).returning();
  }, {
    event: 'schedule.activated',
    entityType: 'schedule',
    entityId: id,
  });
  return c.json(updated);
});

router.delete('/:id', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Schedule ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Schedule not found', code: 'NOT_FOUND' } }, 404);
  if (existing.type === 'system') return c.json({ error: { message: 'Cannot delete system schedules', code: 'FORBIDDEN' } }, 403);
  validateTransition('schedule', existing.status || 'active', 'deleted');
  await withAudit(c, async (tx) => {
    await tx.update(schedules).set({ status: 'deleted', deletedAt: new Date(), enabled: false, updatedAt: new Date() })
      .where(eq(schedules.id, id));
  }, {
    event: 'schedule.deleted',
    entityType: 'schedule',
    entityId: id,
  });
  return c.json({ message: 'Schedule deleted' });
});

router.get('/:id/runs', requireOrg, async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const baseCondition = eq(scheduleRuns.scheduleId, id);
  const cursorWhere = buildCursorWhere(decodedCursor, scheduleRuns.startedAt, scheduleRuns.id, 'desc');
  const finalWhere = cursorWhere ? and(baseCondition, cursorWhere) : baseCondition;
  const orderBy = buildCursorOrderBy(scheduleRuns.startedAt, scheduleRuns.id, 'desc');

  const runs = await db.select().from(scheduleRuns)
    .where(finalWhere)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(runs, limit, (r) => r.id, (r) => r.startedAt.toISOString());

  return c.json({
    runs: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    total: paginated.data.length,
    page: 1,
    limit,
  });
});

export { router as scheduleRoutes };
