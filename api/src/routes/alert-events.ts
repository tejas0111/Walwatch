import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { alertEvents } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { validNextStates, isTerminal } from '../lib/state-machine.js';
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

router.get('/', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  const status = c.req.query('status');
  const eventType = c.req.query('event_type');
  const severity = c.req.query('severity');

  // Cursor-based pagination (Spec 14)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const conditions: ReturnType<typeof and>[] = [eq(alertEvents.orgId, orgId)];
  if (status) conditions.push(eq(alertEvents.status, status));
  if (eventType) conditions.push(eq(alertEvents.eventType, eventType));
  if (severity) conditions.push(eq(alertEvents.severity, severity));

  const cursorWhere = buildCursorWhere(decodedCursor, alertEvents.firedAt, alertEvents.id, 'desc');
  if (cursorWhere) conditions.push(cursorWhere);

  const where = and(...conditions);
  const orderBy = buildCursorOrderBy(alertEvents.firedAt, alertEvents.id, 'desc');

  const events = await db.select().from(alertEvents)
    .where(where)
    .orderBy(...orderBy)
    .limit(fetchLimit);

  const paginated = wrapPaginatedResponse(events, limit, (e) => e.id, (e) => e.firedAt.toISOString());

  return c.json({
    alertEvents: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

router.get('/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Alert event ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();
  const [event] = await db.select().from(alertEvents)
    .where(and(eq(alertEvents.id, id!), eq(alertEvents.orgId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: { message: 'Alert event not found', code: 'NOT_FOUND' } }, 404);
  return c.json(event);
});

/**
 * Acknowledge an alert event.
 * Spec 25: Acknowledged -> terminal state; purely for human tracking.
 */
router.post('/:id/acknowledge', requireOrg, requireRole('owner', 'admin', 'member'), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Alert event ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();

  const [event] = await db.select().from(alertEvents)
    .where(and(eq(alertEvents.id, id!), eq(alertEvents.orgId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: { message: 'Alert event not found', code: 'NOT_FOUND' } }, 404);

  // Only delivered events can be acknowledged (spec 25: Acknowledged is purely for human tracking)
  if (event.status !== 'delivered') {
    return c.json({
      error: {
        message: `Alert event in state '${event.status}' cannot be acknowledged — only 'delivered' events can be acknowledged per spec 25`,
        code: 'VALIDATION_ERROR',
      },
    }, 400);
  }

  await db.update(alertEvents).set({
    status: 'acknowledged',
    acknowledgedAt: new Date(),
  }).where(eq(alertEvents.id, id!));

  await logAudit(c, 'alert_event.acknowledged', 'alert_event', id);
  emit(createEvent(EventNames.ALERT_EVENT_ACKNOWLEDGED, orgId, 'alert_event', id, { type: 'human', userId }));

  return c.json({ message: 'Alert event acknowledged' });
});

// Helper: get available transitions
router.get('/:id/transitions', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Alert event ID is required', code: 'VALIDATION_ERROR' } }, 400);
  const db = getDb();

  const [event] = await db.select().from(alertEvents)
    .where(and(eq(alertEvents.id, id!), eq(alertEvents.orgId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: { message: 'Alert event not found', code: 'NOT_FOUND' } }, 404);

  const nextStates = validNextStates('alert_event', event.status);
  return c.json({
    currentState: event.status,
    isTerminal: isTerminal('alert_event', event.status),
    availableTransitions: nextStates,
  });
});

export { router as alertEventRoutes };
