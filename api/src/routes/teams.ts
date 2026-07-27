import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { teams, teamMembers } from '../db/schema.js';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { emit, createEvent } from '../lib/event-bus.js';
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

const createTeamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

const updateTeamSchema = createTeamSchema.partial();

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['lead', 'member']).optional(),
});

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createTeamSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');

    const [team] = await withAudit(c, async (tx) => {
      return await tx.insert(teams).values({ ...input, orgId }).returning();
    }, {
      event: 'team.created',
      entityType: 'team',
      entityId: (rows) => rows[0].id,
      details: { name: input.name },
    });
    await emit(createEvent('team.created' as any, orgId, 'team', team.id, { type: 'human', userId: c.get('userId') }, { name: team.name }));
    return c.json(team, 201);
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
    if (c.req.query('name')) filters.push(ilike(teams.name, `%${c.req.query('name')}%`));

    const baseConditions = includeDeleted
      ? and(eq(teams.orgId, orgId), ...filters)
      : and(eq(teams.orgId, orgId), sql`${teams.deletedAt} IS NULL`, ...filters);

    const cursorWhere = buildCursorWhere(decodedCursor, teams.createdAt, teams.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(teams.createdAt, teams.id, 'desc');

    const list = await db.select().from(teams).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (t) => t.id, (t) => t.createdAt.toISOString());

    return c.json({
      teams: paginated.data,
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
    if (!id) return c.json({ error: { message: 'Team ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [team] = await db.select().from(teams)
      .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
      .limit(1);
    if (!team) return c.json({ error: { message: 'Team not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, id));
    return c.json({ ...team, members });
  } catch (error) {
    throw error;
  }
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin'), zValidator('json', updateTeamSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Team ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(teams)
      .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Team not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(teams).set({ ...input, updatedAt: new Date() })
        .where(eq(teams.id, id)).returning();
    }, {
      event: 'team.updated',
      entityType: 'team',
      entityId: id,
      details: input,
    });
    await emit(createEvent('team.updated' as any, orgId, 'team', updated.id, { type: 'human', userId: c.get('userId') }, input));
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
    if (!id) return c.json({ error: { message: 'Team ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(teams)
      .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Team not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.deletedAt) return c.json({ error: { message: 'Team already deleted', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    await withAudit(c, async (tx) => {
      await tx.update(teams).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(teams.id, id));
    }, {
      event: 'team.deleted',
      entityType: 'team',
      entityId: id,
    });
    await emit(createEvent('team.deleted' as any, orgId, 'team', id, { type: 'human', userId: c.get('userId') }));
    return c.json({ message: 'Team deleted' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/:id/members', requireOrg, requireRole('owner', 'admin'), zValidator('json', addMemberSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    const { userId, role } = c.req.valid('json');
    const db = getDb();
    const [team] = await db.select().from(teams).where(and(eq(teams.id, id), eq(teams.orgId, orgId))).limit(1);
    if (!team) return c.json({ error: { message: 'Team not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [member] = await withAudit(c, async (tx) => {
      return await tx.insert(teamMembers).values({ teamId: id, userId, role: role || 'member' }).returning();
    }, {
      event: 'team.member_added',
      entityType: 'team_member',
      entityId: id,
      details: { userId, role },
    });
    await emit(createEvent('team.member_added' as any, orgId, 'team', id, { type: 'human', userId: c.get('userId') }, { userId, role }));
    return c.json(member, 201);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.delete('/:id/members/:userId', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id')!;
    const userId = c.req.param('userId')!;
    const db = getDb();
    const [team] = await db.select().from(teams).where(and(eq(teams.id, id), eq(teams.orgId, orgId))).limit(1);
    if (!team) return c.json({ error: { message: 'Team not found', code: ErrorCodes.NOT_FOUND } }, 404);
    await withAudit(c, async (tx) => {
      await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, userId)));
    }, {
      event: 'team.member_removed',
      entityType: 'team_member',
      entityId: id,
      details: { userId },
    });
    await emit(createEvent('team.member_removed' as any, orgId, 'team', id, { type: 'human', userId: c.get('userId') }, { userId }));
    return c.json({ message: 'Member removed from team' });
  } catch (error) {
    throw error;
  }
});

export { router as teamRoutes };
