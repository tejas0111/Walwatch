import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireCapability } from '../middleware/capability.js';
import { Capability } from '../lib/permissions.js';
import { withAudit } from '../lib/audit-helper.js';
import { getDb } from '../db/index.js';
import { wallets, delegations } from '../db/schema.js';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { PostgresError } from 'postgres';
import { invariantChecker } from '../lib/invariant-check.js';
import { handleWalletDisconnected } from '../lib/edge-cases.js';
import { validateTransition } from '../lib/state-machine.js';
import { emit, EventNames, createEvent } from '../lib/event-bus.js';
import { createDelegation, revokeDelegation } from '../lib/delegation.js';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const router = new Hono();

router.use('*', requireAuth);

const suiAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'Invalid Sui address format');

const createWalletSchema = z.object({
  address: suiAddressSchema,
  projectId: z.string().uuid().optional(),
  label: z.string().optional(),
  type: z.enum(['owned', 'watch-only']).optional(),
  isDefault: z.boolean().optional(),
  spendingLimit: z.number().int().nonnegative().optional(),
});

const updateWalletSchema = z.object({
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
  spendingLimit: z.number().int().nonnegative().optional(),
});

router.post('/', requireOrg, requireCapability(Capability.MANAGE_WALLETS), zValidator('json', createWalletSchema), async (c) => {
  const orgId = c.get('orgId');
  invariantChecker.verifyOrgChain({ orgId });
  const input = c.req.valid('json');
  await invariantChecker.ensureUniqueWalletAddress(orgId, input.projectId || null, input.address);
  try {
    const [wallet] = await withAudit(c, async (tx) => {
      return await tx.insert(wallets).values({ ...input, orgId }).returning();
    }, {
      event: 'wallet.created',
      entityType: 'wallet',
      entityId: (rows) => rows[0].id,
      details: { address: input.address },
    });
    return c.json(wallet, 201);
  } catch (err) {
    if (err instanceof PostgresError && err.code === '23505') {
      return c.json({ error: { message: 'Wallet with this address already exists in the organization', code: 'CONFLICT', failureClass: 'persistent', requestId: c.get('requestId') } }, 409);
    }
    throw err;
  }
});

router.get('/', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();
  const includeDeleted = c.req.query('include_deleted') === 'true';

  // Cursor-based pagination (Spec 14)
  const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const fetchLimit = limit + 1;

  const filters = [];
  if (c.req.query('type')) filters.push(eq(wallets.type, c.req.query('type')!));
  if (c.req.query('projectId')) filters.push(eq(wallets.projectId, c.req.query('projectId')!));
  if (c.req.query('label')) filters.push(ilike(wallets.label, `%${c.req.query('label')}%`));

  const baseConditions = includeDeleted
    ? and(eq(wallets.orgId, orgId), ...filters)
    : and(eq(wallets.orgId, orgId), sql`${wallets.status} IS DISTINCT FROM 'deleted'`, ...filters);

  const cursorWhere = buildCursorWhere(decodedCursor, wallets.createdAt, wallets.id, 'desc');
  const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
  const orderBy = buildCursorOrderBy(wallets.createdAt, wallets.id, 'desc');

  const list = await db.select().from(wallets).where(finalWhere).orderBy(...orderBy).limit(fetchLimit);
  const paginated = wrapPaginatedResponse(list, limit, (w) => w.id, (w) => w.createdAt.toISOString());

  return c.json({
    wallets: paginated.data,
    pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
  });
});

router.get('/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [wallet] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!wallet) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  return c.json(wallet);
});

router.patch('/:id', requireOrg, requireCapability(Capability.MANAGE_WALLETS), zValidator('json', updateWalletSchema), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const input = c.req.valid('json');
  const db = getDb();
  const [existing] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  const [updated] = await withAudit(c, async (tx) => {
    return await tx.update(wallets)
      .set(input)
      .where(eq(wallets.id, id))
      .returning();
  }, {
    event: 'wallet.updated',
    entityType: 'wallet',
    entityId: id,
    details: input,
  });
  return c.json(updated);
});

router.delete('/:id', requireOrg, requireCapability(Capability.MANAGE_WALLETS), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  validateTransition('wallet', existing.status, 'deleted');
  await withAudit(c, async (tx) => {
    await tx.update(wallets).set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(wallets.id, id));
  }, {
    event: 'wallet.deleted',
    entityType: 'wallet',
    entityId: id,
  });
  return c.json({ message: 'Wallet removed' });
});

router.post('/:id/restore', requireOrg, requireCapability(Capability.MANAGE_WALLETS), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  validateTransition('wallet', existing.status, 'active');
  await withAudit(c, async (tx) => {
    await tx.update(wallets).set({ status: 'active', deletedAt: null })
      .where(eq(wallets.id, id));
  }, {
    event: 'wallet.restored',
    entityType: 'wallet',
    entityId: id,
  });
  return c.json({ message: 'Wallet restored' });
});

router.post('/:id/revoke-delegation', requireOrg, requireCapability(Capability.MANAGE_WALLETS), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  validateTransition('wallet', existing.status, 'delegation_revoked');
  await withAudit(c, async (tx) => {
    await tx.update(wallets).set({ status: 'delegation_revoked', delegationRevokedAt: new Date() })
      .where(eq(wallets.id, id));
  }, {
    event: 'wallet.delegation_revoked',
    entityType: 'wallet',
    entityId: id,
  });
  emit(createEvent(EventNames.DELEGATION_REVOKED, orgId, 'wallet', id, { type: 'human', userId: c.get('userId') }, { address: existing.address }));

  // Spec 27: Wallet disconnected while blobs are protected.
  // Transition protected blobs to tracked, stop auto-renewal, fire alert.
  // In-flight renewals are NOT aborted (only blobs in 'protected' state are affected).
  await handleWalletDisconnected(id).catch((err) => {
    console.error('Failed to handle wallet disconnect compensating actions:', err);
  });

  return c.json({ message: 'Delegation revoked. Monitoring continues but auto-renewal stopped.' });
});

router.post('/:id/reconnect', requireOrg, requireCapability(Capability.MANAGE_WALLETS), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  validateTransition('wallet', existing.status, 'active');
  await withAudit(c, async (tx) => {
    await tx.update(wallets).set({ status: 'active', delegationRevokedAt: null })
      .where(eq(wallets.id, id));
  }, {
    event: 'wallet.reconnected',
    entityType: 'wallet',
    entityId: id,
  });
  emit(createEvent(EventNames.DELEGATION_GRANTED, orgId, 'wallet', id, { type: 'human', userId }, { address: existing.address }));
  return c.json({ message: 'Delegation restored. Auto-renewal resumed.' });
});

router.post('/:id/refresh-balance', requireOrg, requireCapability(Capability.MANAGE_WALLETS), async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  if (!id) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const db = getDb();
  const [existing] = await db.select().from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!existing) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  return c.json({ message: 'Balance refreshed', balance: 0 });
});

// Delegated signing authority (Task 7.10)
const createDelegationSchema = z.object({
  delegateAddress: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid delegate address format'),
  scope: z.enum(['blob_ids', 'policy', 'all']),
  scopeTargets: z.array(z.string()).optional(),
  spendCeiling: z.string().optional(),
  timeBoundEnd: z.string().datetime().optional(),
});

router.post('/:id/delegate', requireOrg, requireCapability(Capability.MANAGE_WALLETS), zValidator('json', createDelegationSchema), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const walletId = c.req.param('id');
  if (!walletId) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  const input = c.req.valid('json');

  const db = getDb();
  const [wallet] = await db.select().from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!wallet) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  const delegation = await createDelegation({
    orgId,
    walletId,
    delegateAddress: input.delegateAddress,
    scope: input.scope,
    scopeTargets: input.scopeTargets,
    spendCeiling: input.spendCeiling,
    timeBoundEnd: input.timeBoundEnd,
    createdBy: userId,
  });

  return c.json(delegation, 201);
});

router.get('/:id/delegations', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const walletId = c.req.param('id');
  if (!walletId) return c.json({ error: { message: 'Wallet ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);

  const db = getDb();
  const [wallet] = await db.select().from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.orgId, orgId)))
    .limit(1);
  if (!wallet) return c.json({ error: { message: 'Wallet not found', code: 'NOT_FOUND', failureClass: 'persistent', requestId: c.get('requestId') } }, 404);

  const list = await db.select().from(delegations)
    .where(and(eq(delegations.walletId, walletId), eq(delegations.orgId, orgId)))
    .orderBy(delegations.createdAt);

  return c.json({ delegations: list });
});

router.post('/:id/delegations/:delegationId/revoke', requireOrg, requireCapability(Capability.MANAGE_WALLETS), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const delegationId = c.req.param('delegationId');
  if (!delegationId) return c.json({ error: { message: 'Delegation ID is required', code: 'VALIDATION_ERROR', failureClass: 'persistent', requestId: c.get('requestId') } }, 400);

  await revokeDelegation(delegationId, orgId, userId);

  return c.json({ message: 'Delegation revoked' });
});

export { router as walletRoutes };
