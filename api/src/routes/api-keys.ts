import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { eq, and, ilike } from 'drizzle-orm';
import { ErrorCodes } from '../lib/errors.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import { validateTransition } from '../lib/state-machine.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  permissions: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Creates a new API key.
 * WARNING: The raw API key (rawKey) is returned ONLY in this response. It cannot be retrieved later.
 * The server stores only the SHA-256 hash. If lost, the key must be revoked and a new one created.
 */
router.post('/', requireAuth, requireOrg, requireCapability(Capability.MANAGE_API_KEYS), zValidator('json', createSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const input = c.req.valid('json');

    const rawKey = 'wak_' + crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 12);

    const [key] = await withAudit(c, async (tx) => {
      return await tx.insert(apiKeys).values({
        orgId,
        userId,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        role: input.role || 'member',
        permissions: input.permissions || [],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      }).returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        role: apiKeys.role,
        permissions: apiKeys.permissions,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      });
    }, {
      event: 'api_key.created',
      entityType: 'api_key',
      entityId: (rows) => rows[0].id,
      details: { name: input.name, permissions: input.permissions },
    });
    emit(createEvent(EventNames.API_KEY_CREATED, orgId, 'api_key', key.id, { type: 'human', userId }, { name: key.name, permissions: input.permissions }));

    return c.json({ apiKey: { ...key, rawKey } }, 201);
  } catch (error) {
    throw error;
  }
});

router.get('/', requireAuth, requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();
    const includeDeleted = c.req.query('include_deleted') === 'true';

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const filters = [];
    if (c.req.query('name')) filters.push(ilike(apiKeys.name, `%${c.req.query('name')}%`));
    if (c.req.query('role')) filters.push(eq(apiKeys.role, c.req.query('role')!));

    const baseConditions = includeDeleted
      ? and(eq(apiKeys.orgId, orgId), ...filters)
      : and(eq(apiKeys.orgId, orgId), eq(apiKeys.status, 'active'), ...filters);

    const cursorWhere = buildCursorWhere(decodedCursor, apiKeys.createdAt, apiKeys.id, 'desc');
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(apiKeys.createdAt, apiKeys.id, 'desc');

    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    }).from(apiKeys).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);

    const paginated = wrapPaginatedResponse(
      keys,
      limit,
      (k) => k.id,
      (k) => k.createdAt.toISOString(),
    );

    return c.json({
      apiKeys: paginated.data,
      pagination: {
        nextCursor: paginated.nextCursor,
        hasMore: paginated.hasMore,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.post('/:id/rotate', requireAuth, requireOrg, requireCapability(Capability.MANAGE_API_KEYS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id')!;
    const db = getDb();

    const [key] = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)))
      .limit(1);

    if (!key) return c.json({ error: { message: 'API key not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (key.status === 'revoked') return c.json({ error: { message: 'API key is already revoked', code: ErrorCodes.VALIDATION_ERROR } }, 400);

    validateTransition('api_key', key.status as string, 'rotated');

    const rawKey = 'wak_' + crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 12);

    await withAudit(c, async (tx) => {
      await tx.update(apiKeys).set({
        previousKeyHash: key.keyHash,
        keyHash: hash,
        keyPrefix: prefix,
        status: 'rotated',
        rotatedAt: new Date(),
      }).where(eq(apiKeys.id, id));
    }, {
      event: 'api_key.rotated',
      entityType: 'api_key',
      entityId: id,
      details: { name: key.name, keyPrefix: prefix },
    });
    emit(createEvent(EventNames.API_KEY_ROTATED, orgId, 'api_key', id, { type: 'human', userId }, { name: key.name, keyPrefix: prefix }));

    return c.json({ apiKey: { id: key.id, name: key.name, keyPrefix: prefix, rawKey } });
  } catch (error) {
    throw error;
  }
});

router.delete('/:id', requireAuth, requireOrg, requireCapability(Capability.MANAGE_API_KEYS), async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const id = c.req.param('id')!;
    const db = getDb();

    const [key] = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)))
      .limit(1);

    if (!key) return c.json({ error: { message: 'API key not found', code: ErrorCodes.NOT_FOUND } }, 404);
    if (key.status === 'revoked') return c.json({ error: { message: 'API key is already revoked', code: ErrorCodes.VALIDATION_ERROR } }, 400);

    validateTransition('api_key', key.status as string, 'revoked');

    await withAudit(c, async (tx) => {
      await tx.update(apiKeys).set({ status: 'revoked', deletedAt: new Date() })
        .where(eq(apiKeys.id, id));
    }, {
      event: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      details: { name: key.name, keyPrefix: key.keyPrefix },
    });
    emit(createEvent(EventNames.API_KEY_REVOKED, orgId, 'api_key', id, { type: 'human', userId }, { name: key.name, keyPrefix: key.keyPrefix }));

    return c.json({ message: 'API key revoked' });
  } catch (error) {
    throw error;
  }
});

export { router as apiKeyRoutes };
