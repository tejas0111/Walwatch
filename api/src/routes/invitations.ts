import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { invitations, orgMembers } from '../db/schema.js';
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
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');
    const db = getDb();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [invite] = await db.insert(invitations).values({
      orgId, email: input.email, role: input.role || 'member', token, expiresAt,
    }).returning();
    await logAudit(c, 'invitation.created', 'invitation', invite.id, { email: input.email, role: input.role });
    return c.json(invite, 201);
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
    if (c.req.query('email')) filters.push(ilike(invitations.email, `%${c.req.query('email')}%`));
    if (c.req.query('status')) filters.push(eq(invitations.status, c.req.query('status')!));

    const baseConditions = includeDeleted
      ? and(eq(invitations.orgId, orgId), ...filters)
      : and(eq(invitations.orgId, orgId), sql`${invitations.deletedAt} IS NULL`, ...filters);

    const cursorWhere = buildCursorWhere(decodedCursor, invitations.createdAt, invitations.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(invitations.createdAt, invitations.id, 'desc');

    const list = await db.select().from(invitations).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (i) => i.id, (i) => i.createdAt.toISOString());

    return c.json({
      invitations: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    throw error;
  }
});

router.delete('/:id', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Invitation ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Invitation not found', code: ErrorCodes.NOT_FOUND } }, 404);
    await db.update(invitations).set({ status: 'cancelled', deletedAt: new Date() }).where(eq(invitations.id, id));
    await logAudit(c, 'invitation.cancelled', 'invitation', id);
    return c.json({ message: 'Invitation cancelled' });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    throw error;
  }
});

router.post('/accept', async (c) => {
  const body = await c.req.json();
  const { token } = body;
  if (!token) return c.json({ error: { message: 'Token is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
  try {
    const db = getDb();
    const [invite] = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
    if (!invite) return c.json({ error: { message: 'Invalid or expired invitation token', code: ErrorCodes.NOT_FOUND } }, 404);
    if (invite.status !== 'pending') return c.json({ error: { message: 'Invitation already used or cancelled', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    if (invite.expiresAt < new Date()) return c.json({ error: { message: 'Invitation has expired', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const userId = c.get('userId');
    await db.insert(orgMembers).values({ orgId: invite.orgId, userId, role: invite.role }).onConflictDoNothing();
    await db.update(invitations).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
    return c.json({ message: 'Invitation accepted', orgId: invite.orgId, role: invite.role });
  } catch (error) {
    throw error;
  }
});

export { router as invitationRoutes };
