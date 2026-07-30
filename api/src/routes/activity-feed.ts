/**
 * Activity Feed Routes (Spec 18 — Three Distinct Surfaces)
 *
 * The Activity Feed is a human-readable, reverse-chronological event log
 * derived from the same events as the Audit Log but optimized for browsing.
 * Unlike the Audit Log (compliance-grade, immutable, write-once), the
 * Activity Feed may be pruned — losing old feed entries is acceptable.
 *
 * This is NOT a compliance surface. For compliance queries, use the
 * Audit Log endpoint (GET /audit-logs or GET /orgs/:id/audit-logs).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { getDb } from '../db/index.js';
import { activityFeed } from '../db/schema.js';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { escapeLike } from '../lib/escape-like.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';
import pino from 'pino';

const log = pino({ name: 'activity-feed' });

const router = new Hono();

router.use('*', requireAuth);

/**
 * GET / — paginated activity feed for the current org.
 * Returns human-readable events in reverse chronological order.
 * Supports filtering by action, resource_type, and actor_type.
 */
router.get('/', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  const action = c.req.query('action');
  const resourceType = c.req.query('resource_type');
  const actorType = c.req.query('actor_type');

  // Cursor-based pagination (Spec 14)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const conditions: ReturnType<typeof and>[] = [eq(activityFeed.orgId, orgId)];
  if (action) conditions.push(ilike(activityFeed.action, `%${escapeLike(action)}%`));
  if (resourceType) conditions.push(eq(activityFeed.resourceType, resourceType));
  if (actorType) conditions.push(eq(activityFeed.actorType, actorType));

  const cursorWhere = buildCursorWhere(decodedCursor, activityFeed.createdAt, activityFeed.id, 'desc');
  if (cursorWhere) conditions.push(cursorWhere);

  const where = and(...conditions);
  const orderBy = buildCursorOrderBy(activityFeed.createdAt, activityFeed.id, 'desc');

  const entries = await db.select().from(activityFeed)
    .where(where)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(entries, limit, (e) => e.id, (e) => e.createdAt.toISOString());

  return c.json({
    entries: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

export { router as activityFeedRoutes };

/**
 * Write an entry to the Activity Feed.
 * Called internally by services; not exposed via API.
 */
export async function writeFeedEntry(
  orgId: string,
  actorType: 'human' | 'system' | 'api_key',
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  summary: string,
  details?: Record<string, unknown>,
  traceId?: string,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(activityFeed).values({
      orgId,
      actorType,
      actorId,
      action,
      resourceType,
      resourceId,
      summary,
      details: details || {},
      traceId: traceId || null,
    });
  } catch (err) {
    // Feed writes are best-effort — losing a feed entry is acceptable (Spec 18)
    log.error({ err }, 'Failed to write entry');
  }
}
