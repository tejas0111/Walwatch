import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { validateTransition, validNextStates, isTerminal } from '../lib/state-machine.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import { encrypt } from '../lib/encryption.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();
router.use('*', requireAuth);

const createWebhookSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1).optional(),
  status: z.enum(['active', 'failing', 'disabled']).optional(),
});

/**
 * Strip sensitive fields from webhook before returning to client.
 * Per Spec 17: Secrets are never returned by read endpoints after initial creation.
 */
function stripWebhookSecret(wh: Record<string, unknown>): Record<string, unknown> {
  if (!wh) return wh;
  const { secret: _, ...safe } = wh;
  return safe;
}

router.post('/', requireOrg, requireCapability(Capability.MANAGE_WEBHOOKS), zValidator('json', createWebhookSchema), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const input = c.req.valid('json');

  // Encrypt the secret at rest if provided
  const secret = input.secret ? encrypt(input.secret) : undefined;
  const [wh] = await withAudit(c, async (tx) => {
    return await tx.insert(webhooks).values({
      name: input.name,
      url: input.url,
      events: input.events,
      orgId,
      status: 'created',
      ...(secret ? { secret } : {}),
    }).returning();
  }, {
    event: 'webhook.created',
    entityType: 'webhook',
    entityId: (rows) => rows[0].id,
    details: { name: input.name, url: input.url },
  });

  emit(createEvent(EventNames.WEBHOOK_CREATED, orgId, 'webhook', wh.id, { type: 'human', userId }, {
    name: wh.name, url: wh.url,
  }));

  // Return the raw secret ONLY at creation time (Spec 17: one-time show)
  return c.json({ ...stripWebhookSecret(wh), rawSecret: input.secret || null }, 201);
});

router.get('/', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  // Cursor-based pagination (Spec 14)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const baseConditions = and(eq(webhooks.orgId, orgId), sql`${webhooks.deletedAt} IS NULL`);
  const cursorWhere = buildCursorWhere(decodedCursor, webhooks.createdAt, webhooks.id, 'desc');
  const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
  const orderBy = buildCursorOrderBy(webhooks.createdAt, webhooks.id, 'desc');

  const list = await db.select().from(webhooks).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
  const paginated = wrapPaginatedResponse(list, limit, (w) => w.id, (w) => w.createdAt.toISOString());

  return c.json({
    webhooks: paginated.data.map(stripWebhookSecret),
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

router.get('/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = getDb();
  const [wh] = await db.select().from(webhooks)
    .where(and(eq(webhooks.id, id!), eq(webhooks.orgId, orgId)))
    .limit(1);
  if (!wh) return c.json({ error: { message: 'Webhook not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  return c.json(stripWebhookSecret(wh));
});

router.patch('/:id', requireOrg, requireCapability(Capability.MANAGE_WEBHOOKS), zValidator('json', updateWebhookSchema), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const input = c.req.valid('json');
  const db = getDb();

  const [existing] = await db.select().from(webhooks)
    .where(and(eq(webhooks.id, id!), eq(webhooks.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Webhook not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  const updateData: Record<string, unknown> = { ...input, updatedAt: new Date() };

  // State machine enforcement on status transitions
  if (input.status && input.status !== existing.status) {
    validateTransition('webhook', existing.status, input.status);
    if (input.status === 'disabled') {
      emit(createEvent(EventNames.WEBHOOK_DISABLED, orgId, 'webhook', id, { type: 'human', userId }));
    }
    if (input.status === 'active' && existing.status === 'disabled') {
      emit(createEvent(EventNames.WEBHOOK_REENABLED, orgId, 'webhook', id, { type: 'human', userId }));
    }
  }

  // Encrypt the secret if it's being updated
  if (updateData.secret && typeof updateData.secret === 'string') {
    updateData.secret = encrypt(updateData.secret as string);
  }

  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(webhooks)
      .set(updateData)
      .where(eq(webhooks.id, id!))
      .returning();
  }, {
    event: 'webhook.updated',
    entityType: 'webhook',
    entityId: id!,
    details: input,
  });
  return c.json(stripWebhookSecret(updated));
});

router.delete('/:id', requireOrg, requireCapability(Capability.MANAGE_WEBHOOKS), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = getDb();

  const [existing] = await db.select().from(webhooks)
    .where(and(eq(webhooks.id, id!), eq(webhooks.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Webhook not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  validateTransition('webhook', existing.status, 'deleted');

  await withAudit(c, async (tx) => {
    await tx.update(webhooks).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(webhooks.id, id!));
  }, {
    event: 'webhook.deleted',
    entityType: 'webhook',
    entityId: id!,
  });
  emit(createEvent(EventNames.WEBHOOK_DELETED, orgId, 'webhook', id!, { type: 'human', userId }));

  return c.json({ message: 'Webhook deleted' });
});

// ── Helper: get available transitions ──────────────────────────
router.get('/:id/transitions', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = getDb();

  const [wh] = await db.select().from(webhooks)
    .where(and(eq(webhooks.id, id!), eq(webhooks.orgId, orgId)))
    .limit(1);
  if (!wh) return c.json({ error: { message: 'Webhook not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  const nextStates = validNextStates('webhook', wh.status);
  return c.json({
    currentState: wh.status,
    isTerminal: isTerminal('webhook', wh.status),
    availableTransitions: nextStates,
  });
});

export { router as webhookRoutes };
