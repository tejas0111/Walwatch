import { Hono } from 'hono';
import { Context, Next } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { projects, orgMembers, organizations, blobRegistrations } from '../db/schema.js';
import { eq, and, sql, type SQL } from 'drizzle-orm';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { validateTransition } from '../lib/state-machine.js';
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

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),
  environment: z.enum(['production', 'staging', 'development', 'personal']).optional(),
});

const updateProjectSchema = createProjectSchema.partial();

async function requireProjectOrg(c: Context, next: Next) {
  const userId = c.get('userId');
  const orgId = c.req.header('X-Org-Id');
  if (!orgId) {
    return c.json({ error: { message: 'Organization ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
  }
  const db = getDb();
  const [org] = await db.select({ suspendedAt: organizations.suspendedAt })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return c.json({ error: { message: 'Organization not found', code: ErrorCodes.NOT_FOUND } }, 404);
  if (org.suspendedAt) return c.json({ error: { message: 'Organization is suspended', code: ErrorCodes.FORBIDDEN } }, 403);
  const [membership] = await db.select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!membership) {
    return c.json({ error: { message: 'Not a member of this organization', code: ErrorCodes.FORBIDDEN } }, 403);
  }
  c.set('orgId', orgId);
  c.set('role', membership.role);
  await next();
}

router.post('/', requireOrg, requireRole('owner', 'admin'), zValidator('json', createProjectSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');

    const [project] = await withAudit(c, async (tx) => {
      return await tx.insert(projects).values({ ...input, orgId }).returning();
    }, {
      event: 'project.created',
      entityType: 'project',
      entityId: (rows) => rows[0].id,
      details: { name: input.name, slug: input.slug },
    });
    return c.json(project, 201);
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
      ? eq(projects.orgId, orgId)
      : and(eq(projects.orgId, orgId), sql`${projects.status} IS DISTINCT FROM 'deleted'`);

    const cursorWhere = buildCursorWhere(decodedCursor, projects.createdAt, projects.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(projects.createdAt, projects.id, 'desc');

    const list = await db.select().from(projects).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (p) => p.id, (p) => p.createdAt.toISOString());

    return c.json({
      projects: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.get('/:id', requireProjectOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (!project) return c.json({ error: { message: 'Project not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(project);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.patch('/:id', requireProjectOrg, requireRole('owner', 'admin'), zValidator('json', updateProjectSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (!project) return c.json({ error: { message: 'Project not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
        .returning();
    }, {
      event: 'project.updated',
      entityType: 'project',
      entityId: projectId,
      details: input,
    });
    return c.json(updated);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/archive', requireProjectOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (!project) return c.json({ error: { message: 'Project not found', code: ErrorCodes.NOT_FOUND } }, 404);
    validateTransition('project', project.status, 'archived');
    await withAudit(c, async (tx) => {
      await tx.update(projects).set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }, {
      event: 'project.archived',
      entityType: 'project',
      entityId: projectId,
    });
    return c.json({ message: 'Project archived' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/unarchive', requireProjectOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (!project) return c.json({ error: { message: 'Project not found', code: ErrorCodes.NOT_FOUND } }, 404);
    validateTransition('project', project.status, 'active');
    await withAudit(c, async (tx) => {
      await tx.update(projects).set({ status: 'active', archivedAt: null, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }, {
      event: 'project.unarchived',
      entityType: 'project',
      entityId: projectId,
    });
    return c.json({ message: 'Project unarchived' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.delete('/:id', requireProjectOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (!project) return c.json({ error: { message: 'Project not found', code: ErrorCodes.NOT_FOUND } }, 404);
    validateTransition('project', project.status, 'deleted');
    await withAudit(c, async (tx) => {
      await tx.update(projects).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }, {
      event: 'project.deleted',
      entityType: 'project',
      entityId: projectId,
    });
    return c.json({ message: 'Project deleted' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.post('/:id/restore', requireProjectOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (!project) return c.json({ error: { message: 'Project not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (project.status !== 'deleted') return c.json({ error: { message: 'Project is not deleted', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    await withAudit(c, async (tx) => {
      await tx.update(projects).set({ status: 'active', deletedAt: null, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }, {
      event: 'project.restored',
      entityType: 'project',
      entityId: projectId,
    });
    return c.json({ message: 'Project restored' });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

router.get('/:id/blobs', requireProjectOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: { message: 'Project ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);

    const db = getDb();
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const status = c.req.query('status');
    const conditions: SQL[] = [
      eq(blobRegistrations.orgId, orgId),
      eq(blobRegistrations.projectId, projectId),
    ];
    if (status) conditions.push(eq(blobRegistrations.status, status));

    const cursorWhere = buildCursorWhere(decodedCursor, blobRegistrations.createdAt, blobRegistrations.id, 'desc');
    if (cursorWhere) conditions.push(cursorWhere);

    const where = and(...conditions)!;
    const orderBy = buildCursorOrderBy(blobRegistrations.createdAt, blobRegistrations.id, 'desc');

    const blobs = await db.select().from(blobRegistrations).where(where).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(blobs, limit, (b) => b.id, (b) => b.createdAt.toISOString());

    // Spec 14: Nested resources addressed through parent scope (Project→Blob)
    return c.json({
      blobs: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
});

// TODO: spec 06 granular capability system - requires architectural discussion

export { router as projectRoutes };
