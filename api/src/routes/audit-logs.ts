import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { getDb } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { eq, and, ilike } from 'drizzle-orm';
import { escapeLike } from '../lib/escape-like.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();

router.use('*', requireAuth);

router.get('/', requireOrg, requireCapability(Capability.VIEW_AUDIT_LOG), async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  const action = c.req.query('action');
  const resourceType = c.req.query('resource_type');
  const userId = c.req.query('user_id');

  // Cursor-based pagination (Spec 14)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const conditions: ReturnType<typeof and>[] = [eq(auditLogs.orgId, orgId)];
  if (action) conditions.push(ilike(auditLogs.action, `%${escapeLike(action)}%`));
  if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));
  if (userId) conditions.push(eq(auditLogs.userId, userId));

  const cursorWhere = buildCursorWhere(decodedCursor, auditLogs.createdAt, auditLogs.id, 'desc');
  if (cursorWhere) conditions.push(cursorWhere);

  const where = and(...conditions);
  const orderBy = buildCursorOrderBy(auditLogs.createdAt, auditLogs.id, 'desc');

  const logs = await db.select().from(auditLogs)
    .where(where)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(logs, limit, (l) => l.id, (l) => l.createdAt.toISOString());

  return c.json({
    logs: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

export { router as auditLogRoutes };
