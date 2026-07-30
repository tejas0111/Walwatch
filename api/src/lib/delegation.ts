import { getDb } from '../db/index.js';
import { delegations } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { emit, EventNames, createEvent } from './event-bus.js';

export interface Delegation {
  id: string;
  orgId: string;
  walletId: string;
  delegateAddress: string;
  scope: string;
  scopeTargets: string[];
  spendCeiling: string;
  timeBoundStart: Date;
  timeBoundEnd: Date | null;
  isRevoked: boolean;
}

export async function createDelegation(params: {
  orgId: string;
  walletId: string;
  delegateAddress: string;
  scope: string;
  scopeTargets?: string[];
  spendCeiling?: string;
  timeBoundEnd?: string;
  createdBy: string;
}): Promise<Delegation> {
  const db = getDb();
  const [row] = await db.insert(delegations).values({
    orgId: params.orgId,
    walletId: params.walletId,
    delegateAddress: params.delegateAddress,
    scope: params.scope,
    scopeTargets: params.scopeTargets ?? [],
    spendCeiling: params.spendCeiling ?? '0',
    timeBoundEnd: params.timeBoundEnd ? new Date(params.timeBoundEnd) : null,
    createdBy: params.createdBy,
    isRevoked: false,
  }).returning();

  emit(createEvent(EventNames.DELEGATION_GRANTED, params.orgId, 'delegation', row.id, { type: 'human', userId: params.createdBy }, { walletId: params.walletId, delegateAddress: params.delegateAddress, scope: params.scope }));

  return {
    id: row.id,
    orgId: row.orgId,
    walletId: row.walletId,
    delegateAddress: row.delegateAddress,
    scope: row.scope,
    scopeTargets: row.scopeTargets as string[],
    spendCeiling: row.spendCeiling,
    timeBoundStart: row.timeBoundStart,
    timeBoundEnd: row.timeBoundEnd,
    isRevoked: row.isRevoked ?? false,
  };
}

export async function revokeDelegation(delegationId: string, orgId: string, userId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.update(delegations)
    .set({ isRevoked: true, revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(delegations.id, delegationId), eq(delegations.orgId, orgId)))
    .returning();

  if (!row) return;

  emit(createEvent(EventNames.DELEGATION_REVOKED, orgId, 'delegation', row.id, { type: 'human', userId }, { walletId: row.walletId, delegateAddress: row.delegateAddress }));
}

export async function checkDelegationValidity(delegationId: string, orgId: string, action: string, details?: any): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select().from(delegations)
    .where(and(eq(delegations.id, delegationId), eq(delegations.orgId, orgId)))
    .limit(1);

  if (!row) return false;
  if (row.isRevoked) return false;
  if (row.timeBoundEnd && new Date(row.timeBoundEnd) < new Date()) return false;

  if (row.scope === 'all') return true;
  if (row.scope === 'blob_ids' && action === 'renew') return true;
  if (row.scope === 'policy' && action === 'policy_execute') return true;

  return row.scope === action;
}

export async function recordDelegationUsage(delegationId: string, cost: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(delegations)
    .where(eq(delegations.id, delegationId))
    .limit(1);

  if (!row) return;

  const ceiling = BigInt(row.spendCeiling);
  if (ceiling > 0n && BigInt(cost) > ceiling) {
    throw new Error(`Delegation ${delegationId} spend ceiling of ${row.spendCeiling} exceeded`);
  }

  emit(createEvent(EventNames.DELEGATION_USED, row.orgId, 'delegation', row.id, { type: 'system' }, { cost, walletId: row.walletId }));
}