import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, users, auditLogs, schedules, apiKeys } from '../db/schema.js';
import { eq, and, ilike, sql, desc } from 'drizzle-orm';
import { rateLimit } from '../middleware/rate-limit.js';
import { ErrorCodes } from '../lib/errors.js';
import { validateTransition } from '../lib/state-machine.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();

router.use('*', requireAuth);

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

router.post('/', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }), zValidator('json', createOrgSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const input = c.req.valid('json');

    const [org] = await withAudit(c, async (tx) => {
      const [o] = await tx.insert(organizations).values(input).returning();
      await tx.insert(orgMembers).values({ orgId: o.id, userId, role: 'owner' });

      await tx.insert(schedules).values([
        { orgId: o.id, name: 'expiry-threshold-check', type: 'system', cronExpr: '*/5 * * * *', config: { type: 'expiry_check', description: 'Check blobs approaching expiry threshold' } },
        { orgId: o.id, name: 'budget-window-rollover', type: 'system', cronExpr: '0 0 * * *', config: { type: 'budget_rollover', description: 'Roll over budget windows' } },
      ]);

      c.set('orgId', o.id);
      return [o];
    }, {
      event: 'org.created',
      entityType: 'organization',
      entityId: (rows) => rows[0].id,
    });
    return c.json({ organization: org }, 201);
  } catch (error) {
    throw error;
  }
});

router.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const db = getDb();

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const cursorWhere = buildCursorWhere(
      decodedCursor,
      organizations.createdAt,
      organizations.id,
      'desc',
    );

    const conditions = [eq(orgMembers.userId, userId)];
    if (c.req.query('name')) conditions.push(ilike(organizations.name, `%${c.req.query('name')}%`));
    if (c.req.query('slug')) conditions.push(eq(organizations.slug, c.req.query('slug')!));
    const finalWhere = cursorWhere
      ? and(...conditions, cursorWhere)
      : and(...conditions);

    const orderBy = buildCursorOrderBy(organizations.createdAt, organizations.id, 'desc');

    const orgs = await db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: orgMembers.role,
      createdAt: organizations.createdAt,
    })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(finalWhere)
      .orderBy(...orderBy)
      .limit(fetchLimit);

    const paginated = wrapPaginatedResponse(
      orgs,
      limit,
      (o) => o.id,
      (o) => o.createdAt.toISOString(),
    );

    return c.json({
      organizations: paginated.data,
      pagination: {
        nextCursor: paginated.nextCursor,
        hasMore: paginated.hasMore,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/:id', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return c.json({ error: { message: 'Organization not found', code: 'NOT_FOUND' } }, 404);
    return c.json({ organization: org });
  } catch (error) {
    throw error;
  }
});

router.patch('/:id', requireOrg, requireRole('owner', 'admin'), zValidator('json', createOrgSchema.partial()), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');

    const [org] = await withAudit(c, async (tx) => {
      return await tx.update(organizations).set({ ...input, updatedAt: new Date() })
        .where(eq(organizations.id, orgId)).returning();
    }, {
      event: 'org.updated',
      entityType: 'organization',
      entityId: orgId,
      details: input,
    });
    return c.json({ organization: org });
  } catch (error) {
    throw error;
  }
});

router.delete('/:id', requireOrg, requireRole('owner'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return c.json({ error: { message: 'Organization not found', code: 'NOT_FOUND' } }, 404);
    validateTransition('organization', org.status, 'deleted');
    const ownerCount = await db.select({ count: sql<number>`count(*)` }).from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
    if (Number(ownerCount[0]?.count ?? 0) <= 1) {
      return c.json({ error: { message: 'Cannot delete organization: you are the only owner', code: 'FORBIDDEN' } }, 403);
    }
    await withAudit(c, async (tx) => {
      await tx.update(organizations).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }, {
      event: 'org.deleted',
      entityType: 'organization',
      entityId: orgId,
    });
    return c.json({ message: 'Organization deleted' });
  } catch (error) {
    throw error;
  }
});

router.post('/:id/restore', requireOrg, requireRole('owner'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return c.json({ error: { message: 'Organization not found', code: 'NOT_FOUND' } }, 404);
    validateTransition('organization', org.status, 'active');
    await withAudit(c, async (tx) => {
      await tx.update(organizations).set({ status: 'active', deletedAt: null, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }, {
      event: 'org.restored',
      entityType: 'organization',
      entityId: orgId,
    });
    return c.json({ message: 'Organization restored' });
  } catch (error) {
    throw error;
  }
});

router.post('/:id/suspend', requireOrg, requireRole('owner'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return c.json({ error: { message: 'Organization not found', code: 'NOT_FOUND' } }, 404);
    validateTransition('organization', org.status, 'suspended');
    await withAudit(c, async (tx) => {
      await tx.update(organizations).set({ status: 'suspended', suspendedAt: new Date(), updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }, {
      event: 'org.suspended',
      entityType: 'organization',
      entityId: orgId,
    });
    return c.json({ message: 'Organization suspended' });
  } catch (error) {
    throw error;
  }
});

router.post('/:id/unsuspend', requireOrg, requireRole('owner'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return c.json({ error: { message: 'Organization not found', code: 'NOT_FOUND' } }, 404);
    validateTransition('organization', org.status, 'active');
    await withAudit(c, async (tx) => {
      await tx.update(organizations).set({ status: 'active', suspendedAt: null, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }, {
      event: 'org.unsuspended',
      entityType: 'organization',
      entityId: orgId,
    });
    return c.json({ message: 'Organization unsuspended' });
  } catch (error) {
    throw error;
  }
});

router.get('/:id/members', requireOrg, requireRole('owner', 'admin', 'member'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();

    // Cursor-based pagination (Spec 14: cursor-based, not offset-based)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const cursorWhere = buildCursorWhere(
      decodedCursor,
      orgMembers.joinedAt,
      orgMembers.userId,
      'desc',
    );

    const conditions = [eq(orgMembers.orgId, orgId)];
    const finalWhere = cursorWhere ? and(...conditions, cursorWhere) : and(...conditions);
    const orderBy = buildCursorOrderBy(orgMembers.joinedAt, orgMembers.userId, 'desc');

    const members = await db.select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
    })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(finalWhere)
      .orderBy(...orderBy)
      .limit(fetchLimit);

    const paginated = wrapPaginatedResponse(
      members,
      limit,
      (m) => m.userId,
      (m) => m.joinedAt.toISOString(),
    );

    return c.json({
      members: paginated.data,
      pagination: {
        nextCursor: paginated.nextCursor,
        hasMore: paginated.hasMore,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.post('/:id/members', requireOrg, requireRole('owner', 'admin'), zValidator('json', z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
})), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');
    const db = getDb();

    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user) return c.json({ error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);

    const existing = await db.select().from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
      .limit(1);
    if (existing.length > 0) return c.json({ error: { message: 'User is already a member', code: 'CONFLICT' } }, 409);

    await withAudit(c, async (tx) => {
      await tx.insert(orgMembers).values({ orgId, userId: user.id, role: input.role });
    }, {
      event: 'member.invited',
      entityType: 'organization',
      entityId: orgId,
      details: { userId: user.id, role: input.role },
    });
    emit(createEvent(EventNames.MEMBER_INVITED, orgId, 'member', user.id, { type: 'human', userId: c.get('userId') }, { email: input.email, role: input.role }));
    return c.json({ message: 'Member added' }, 201);
  } catch (error) {
    throw error;
  }
});

router.patch('/:id/members/:userId', requireOrg, requireRole('owner', 'admin'), zValidator('json', z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
})), async (c) => {
  try {
    const orgId = c.get('orgId');
    const requesterRole = c.get('role');
    const { userId } = c.req.param();
    const { role } = c.req.valid('json');
    const db = getDb();

    if (requesterRole !== 'owner' && role === 'owner') {
      return c.json({ error: { message: 'Only owners can assign the owner role', code: 'FORBIDDEN' } }, 403);
    }

    if (role !== 'owner') {
      const owners = await db.select().from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
      if (owners.length <= 1 && owners[0].userId === userId) {
        return c.json({ error: { message: 'Cannot demote the last owner', code: 'VALIDATION_ERROR' } }, 400);
      }
    }

    await withAudit(c, async (tx) => {
      await tx.update(orgMembers).set({ role })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    }, {
      event: 'member.role_changed',
      entityType: 'organization',
      entityId: orgId,
      details: { userId, role },
    });
    emit(createEvent(EventNames.MEMBER_ROLE_CHANGED, orgId, 'member', userId, { type: 'human', userId: c.get('userId') }, { role }));
    return c.json({ message: 'Role updated' });
  } catch (error) {
    throw error;
  }
});

router.delete('/:id/members/:userId', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const { userId } = c.req.param();
    const db = getDb();

    const owners = await db.select().from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
    if (owners.length <= 1 && owners[0].userId === userId) {
      return c.json({ error: { message: 'Cannot remove the last owner', code: 'VALIDATION_ERROR' } }, 400);
    }

    // Spec 27: Member Removed While Owning API Keys.
    // Count keys owned by this member that will remain valid until explicitly revoked.
    const activeKeys = await db.select({ count: sql<number>`COUNT(*)` })
      .from(apiKeys)
      .where(and(
        eq(apiKeys.orgId, orgId),
        eq(apiKeys.userId, userId as string),
        eq(apiKeys.status, 'active'),
      ))
      .then(r => Number(r[0]?.count ?? 0));

    await withAudit(c, async (tx) => {
      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    }, {
      event: 'member.removed',
      entityType: 'organization',
      entityId: orgId,
      details: {
        userId,
        activeApiKeys: activeKeys,
        // Spec 27: API keys remain valid until explicitly revoked — attribution references
        // the historical creator via immutable audit logs.
        apiKeysNote: activeKeys > 0
          ? `${activeKeys} active API key(s) remain valid — revoke explicitly via DELETE /api/keys/:id if needed`
          : undefined,
      },
    });
    emit(createEvent(EventNames.MEMBER_REMOVED, orgId, 'member', userId, { type: 'human', userId: c.get('userId') }, { activeApiKeys: activeKeys }));
    return c.json({
      message: 'Member removed',
      ...(activeKeys > 0 ? { warning: `${activeKeys} active API key(s) created by this member remain valid. Revoke explicitly if needed.` } : {}),
    });
  } catch (error) {
    throw error;
  }
});

// TODO: spec 06 requires audit log access to be separately grantable (not bundled into owner/admin)
router.get('/:id/audit-logs', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;
    const sort = c.req.query('sort') || 'desc';
    const sortDirection = sort === 'asc' ? 'asc' : 'desc';

    const cursorWhere = buildCursorWhere(
      decodedCursor,
      auditLogs.createdAt,
      auditLogs.id,
      sortDirection,
    );

    const conditions = [eq(auditLogs.orgId, orgId)];
    const finalWhere = cursorWhere ? and(...conditions, cursorWhere) : and(...conditions);
    const orderBy = buildCursorOrderBy(auditLogs.createdAt, auditLogs.id, sortDirection);

    const logs = await db.select()
      .from(auditLogs)
      .where(finalWhere)
      .orderBy(...orderBy)
      .limit(fetchLimit);

    const paginated = wrapPaginatedResponse(
      logs,
      limit,
      (l) => l.id,
      (l) => l.createdAt.toISOString(),
    );

    return c.json({
      auditLogs: paginated.data,
      pagination: {
        nextCursor: paginated.nextCursor,
        hasMore: paginated.hasMore,
      },
    });
  } catch (error) {
    throw error;
  }
});

export { router as orgRoutes };
