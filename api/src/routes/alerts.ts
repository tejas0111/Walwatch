import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { logAudit } from '../middleware/audit.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { notificationChannels, alertRules, alertEvents, auditLogs } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import pino from 'pino';
import { ErrorCodes } from '../lib/errors.js';
import { validateTransition } from '../lib/state-machine.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import { encrypt, decrypt } from '../lib/encryption.js';

import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const logger = pino({ name: 'alert-routes' });

const router = new Hono();

router.use('*', requireAuth);

const channelTypes = ['email', 'discord', 'slack', 'telegram', 'webhook'] as const;
const triggerTypes = ['blob_expiring', 'renewal_failed', 'renewal_succeeded', 'wallet_balance_low', 'budget_exceeded', 'api_key_compromised', 'publisher_offline'] as const;

const createChannelSchema = z.object({
  type: z.enum(channelTypes),
  name: z.string().min(1).max(255),
  config: z.record(z.unknown()),
  enabled: z.boolean().optional(),
});

const updateChannelSchema = createChannelSchema.partial();

const createRuleSchema = z.object({
  name: z.string().min(1).max(255),
  trigger: z.enum(triggerTypes),
  conditions: z.record(z.unknown()).optional(),
  channelIds: z.array(z.string()).optional(),
  projectIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  dedupWindowSeconds: z.number().int().min(30).max(86400).optional(),
});

const updateRuleSchema = createRuleSchema.partial();

// ── Channel routes ────────────────────────────────────────────

/**
 * Encrypt sensitive fields in notification channel config.
 * Fields known to contain secrets are url, webhookUrl, apiKey, secret, token, password, webhook_secret.
 * Encrypted at rest using AES-256-GCM (Spec 17: secrets management).
 */
function encryptChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_FIELDS = ['webhookUrl', 'url', 'apiKey', 'secret', 'token', 'password', 'webhook_secret'];
  const encrypted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_FIELDS.includes(key) && typeof value === 'string' && value.length > 0) {
      encrypted[key] = encrypt(value);
    } else {
      encrypted[key] = value;
    }
  }
  return encrypted;
}

router.post('/channels', requireOrg, requireCapability(Capability.MANAGE_ALERTS), zValidator('json', createChannelSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const input = c.req.valid('json');
    const db = getDb();
    // Encrypt sensitive fields in channel config at rest
    const encryptedConfig = encryptChannelConfig(input.config || {});
    const [channel] = await db.insert(notificationChannels).values({
      ...input,
      config: encryptedConfig,
      orgId,
    }).returning();
    await logAudit(c, 'channel.created', 'notification_channel', channel.id, { name: channel.name, type: channel.type });
    return c.json(stripChannelSecret(channel), 201);
  } catch (error) {
    throw error;
  }
});

/**
 * Strip secret/sensitive fields from channel config before returning to client.
 * Channel credentials (webhook URLs, tokens, API keys) must never be returned
 * by read endpoints after configuration per Spec 12 security requirements.
 */
function stripChannelSecret(channel: any) {
  if (!channel) return channel;
  return {
    ...channel,
    config: { configured: true, type: channel.config?.type || 'redacted' },
  };
}

router.get('/channels', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const includeDeleted = c.req.query('include_deleted') === 'true';

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const baseConditions = includeDeleted
      ? eq(notificationChannels.orgId, orgId)
      : and(eq(notificationChannels.orgId, orgId), sql`${notificationChannels.status} IS DISTINCT FROM 'deleted'`);

    const cursorWhere = buildCursorWhere(decodedCursor, notificationChannels.createdAt, notificationChannels.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(notificationChannels.createdAt, notificationChannels.id, 'desc');

    const list = await db.select().from(notificationChannels).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (c) => c.id, (c) => c.createdAt.toISOString());

    return c.json({
      channels: paginated.data.map(stripChannelSecret),
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/channels/:id', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Channel ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [channel] = await db.select().from(notificationChannels)
      .where(and(eq(notificationChannels.id, id), eq(notificationChannels.orgId, orgId)))
      .limit(1);
    if (!channel) return c.json({ error: { message: 'Channel not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(stripChannelSecret(channel));
  } catch (error) {
    throw error;
  }
});

router.patch('/channels/:id', requireOrg, requireCapability(Capability.MANAGE_ALERTS), zValidator('json', updateChannelSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Channel ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(notificationChannels)
      .where(and(eq(notificationChannels.id, id), eq(notificationChannels.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Channel not found', code: ErrorCodes.NOT_FOUND } }, 404);
    // Encrypt any sensitive fields in the config update
    const updateData: Record<string, unknown> = {};
    if (input.name) updateData.name = input.name;
    if (input.type) updateData.type = input.type;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;
    if (input.config) {
      updateData.config = encryptChannelConfig(input.config);
    }
    const [updated] = await db.update(notificationChannels)
      .set(updateData)
      .where(eq(notificationChannels.id, id))
      .returning();
    await logAudit(c, 'channel.updated', 'notification_channel', updated.id, { name: input.name, type: input.type });
    return c.json(stripChannelSecret(updated));
  } catch (error) {
    throw error;
  }
});

router.delete('/channels/:id', requireOrg, requireCapability(Capability.MANAGE_ALERTS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Channel ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(notificationChannels)
      .where(and(eq(notificationChannels.id, id), eq(notificationChannels.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Channel not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (existing.status === 'deleted') return c.json({ error: { message: 'Channel is already deleted', code: ErrorCodes.VALIDATION_ERROR } }, 400);

    // Spec 27: Alert Rule's Only Channel Is Deleted — escalate immediately.
    // Find active alert rules whose channel list includes this channel (and only this channel).
    const affectedRules = await db.select().from(alertRules)
      .where(and(
        eq(alertRules.orgId, orgId),
        eq(alertRules.status, 'active'),
        sql`${alertRules.channelIds} @> ARRAY[${id}]::text[]`,
      ));

    const onlyChannelRules = affectedRules.filter(
      (rule) => rule.channelIds.length === 1 && rule.channelIds[0] === id,
    );

    await db.update(notificationChannels).set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(notificationChannels.id, id));
    await logAudit(c, 'channel.deleted', 'notification_channel', id);

    // For rules whose only channel was this one, escalate immediately (treated as delivery_failed_final).
    for (const rule of onlyChannelRules) {
      logger.warn(
        { ruleId: rule.id, ruleName: rule.name, channelId: id },
        'Alert rule\'s only channel was deleted — escalating pending events',
      );

      // Escalate any in-flight alert events for this rule that are still pending delivery
      const pendingEvents = await db.select().from(alertEvents)
        .where(and(
          eq(alertEvents.orgId, orgId),
          eq(alertEvents.alertRuleId, rule.id),
          sql`${alertEvents.status} IN ('fired', 'delivery_failed')`,
        ));

      for (const event of pendingEvents) {
        await db.update(alertEvents)
          .set({ status: 'delivery_failed_final', escalatedAt: new Date() })
          .where(eq(alertEvents.id, event.id));

        await db.insert(auditLogs).values({
          orgId,
          action: 'alert_event.channel_deleted_escalation',
          resourceType: 'alert_event',
          resourceId: event.id,
          details: {
            reason: 'alert_rule_only_channel_deleted',
            channelId: id,
            channelName: existing.name,
            ruleId: rule.id,
            ruleName: rule.name,
          },
        });

        emit(createEvent(
          EventNames.ALERT_EVENT_ESCALATED,
          orgId,
          'alert_event',
          event.id,
          { type: 'human', userId },
          { reason: 'only_channel_deleted', channelId: id, ruleId: rule.id },
        ));
      }
    }

    return c.json({ message: 'Channel deleted' });
  } catch (error) {
    throw error;
  }
});

// ── Alert Rule routes ─────────────────────────────────────────

router.post('/rules', requireOrg, requireCapability(Capability.MANAGE_ALERTS), zValidator('json', createRuleSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const db = getDb();
    const [rule] = await db.insert(alertRules).values({ ...input, orgId }).returning();
    await logAudit(c, 'rule.created', 'alert_rule', rule.id, { name: rule.name, trigger: rule.trigger });
    emit(createEvent(EventNames.ALERT_RULE_CREATED, orgId, 'alert_rule', rule.id, { type: 'human', userId }));
    return c.json(rule, 201);
  } catch (error) {
    throw error;
  }
});

router.get('/rules', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const includeDeleted = c.req.query('include_deleted') === 'true';

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const baseConditions = includeDeleted
      ? eq(alertRules.orgId, orgId)
      : and(eq(alertRules.orgId, orgId), sql`${alertRules.status} IS DISTINCT FROM 'deleted'`);

    const cursorWhere = buildCursorWhere(decodedCursor, alertRules.createdAt, alertRules.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(alertRules.createdAt, alertRules.id, 'desc');

    const list = await db.select().from(alertRules).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
    const paginated = wrapPaginatedResponse(list, limit, (r) => r.id, (r) => r.createdAt.toISOString());

    return c.json({
      rules: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/rules/:id', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Rule ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [rule] = await db.select().from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
      .limit(1);
    if (!rule) return c.json({ error: { message: 'Rule not found', code: ErrorCodes.NOT_FOUND } }, 404);
    return c.json(rule);
  } catch (error) {
    throw error;
  }
});

router.patch('/rules/:id', requireOrg, requireCapability(Capability.MANAGE_ALERTS), zValidator('json', updateRuleSchema), async (c) => {
  try {
    const orgId = c.get('orgId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Rule ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const input = c.req.valid('json');
    const db = getDb();
    const [existing] = await db.select().from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Rule not found', code: ErrorCodes.NOT_FOUND } }, 404);
    const [updated] = await db.update(alertRules)
      .set(input)
      .where(eq(alertRules.id, id))
      .returning();
    await logAudit(c, 'rule.updated', 'alert_rule', updated.id, input);
    return c.json(updated);
  } catch (error) {
    throw error;
  }
});

// ── Alert Rule State Machine Transitions ──────────────────────

router.post('/rules/:id/pause', requireOrg, requireCapability(Capability.MANAGE_ALERTS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Rule ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [rule] = await db.select().from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
      .limit(1);
    if (!rule) return c.json({ error: { message: 'Rule not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('alert_rule', rule.status, 'paused');

    await db.update(alertRules).set({ status: 'paused', enabled: false, pausedAt: new Date() })
      .where(eq(alertRules.id, id));
    await logAudit(c, 'rule.paused', 'alert_rule', id);
    emit(createEvent(EventNames.ALERT_RULE_PAUSED, orgId, 'alert_rule', id, { type: 'human', userId }));
    return c.json({ message: 'Alert rule paused' });
  } catch (error) {
    throw error;
  }
});

router.post('/rules/:id/activate', requireOrg, requireCapability(Capability.MANAGE_ALERTS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Rule ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [rule] = await db.select().from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
      .limit(1);
    if (!rule) return c.json({ error: { message: 'Rule not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('alert_rule', rule.status, 'active');

    await db.update(alertRules).set({ status: 'active', enabled: true, pausedAt: null })
      .where(eq(alertRules.id, id));
    await logAudit(c, 'rule.activated', 'alert_rule', id);
    return c.json({ message: 'Alert rule activated' });
  } catch (error) {
    throw error;
  }
});

router.delete('/rules/:id', requireOrg, requireCapability(Capability.MANAGE_ALERTS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Rule ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [existing] = await db.select().from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
      .limit(1);
    if (!existing) return c.json({ error: { message: 'Rule not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('alert_rule', existing.status, 'deleted');

    await db.update(alertRules).set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(alertRules.id, id));
    await logAudit(c, 'rule.deleted', 'alert_rule', id);
    emit(createEvent(EventNames.ALERT_RULE_DELETED, orgId, 'alert_rule', id, { type: 'human', userId }));
    return c.json({ message: 'Rule deleted' });
  } catch (error) {
    throw error;
  }
});

// ── Alert Event State Machine Transitions ──────────────────────

router.post('/alert-events/:id/escalate', requireOrg, requireCapability(Capability.MANAGE_ALERTS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id) return c.json({ error: { message: 'Alert event ID is required', code: ErrorCodes.VALIDATION_ERROR } }, 400);
    const db = getDb();
    const [event] = await db.select().from(alertEvents)
      .where(and(eq(alertEvents.id, id), eq(alertEvents.orgId, orgId)))
      .limit(1);
    if (!event) return c.json({ error: { message: 'Alert event not found', code: ErrorCodes.NOT_FOUND } }, 404);

    validateTransition('alert_event', event.status, 'escalated');

    const [updated] = await withAudit(c, async (tx) => {
      return await tx.update(alertEvents).set({ status: 'escalated', escalatedAt: new Date() })
        .where(eq(alertEvents.id, id))
        .returning();
    }, {
      event: 'alert_event.escalated',
      entityType: 'alert_event',
      entityId: id,
    });
    emit(createEvent(EventNames.ALERT_EVENT_ESCALATED, orgId, 'alert_event', id, { type: 'human', userId }));
    return c.json(updated);
  } catch (error) {
    throw error;
  }
});

export { router as alertRoutes };
