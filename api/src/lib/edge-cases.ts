import { getDb } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { blobRegistrations, auditLogs } from '../db/schema.js';
import { validateTransition } from './state-machine.js';
import { emit, EventNames, createEvent } from './event-bus.js';

export function snapshotPolicyOnStart(policy: any): Record<string, unknown> {
  return {
    policyId: policy.id,
    policyName: policy.name,
    renewThreshold: policy.renewThreshold,
    renewExtension: policy.renewExtension,
    maxTotalEpochs: policy.maxTotalEpochs ?? null,
    autoRenewalEnabled: policy.autoRenewalEnabled ?? policy.active ?? true,
    active: policy.active,
    scope: policy.scope ?? null,
    scopeTargetId: policy.scopeTargetId ?? null,
    budgetId: policy.budgetId ?? null,
    spendingLimitId: policy.spendingLimitId ?? null,
    publisherPriorityOverride: policy.publisherPriorityOverride ?? null,
    status: policy.status,
    snapshotAt: new Date().toISOString(),
  };
}

export function freezeBudgetCheck(budgetCheck: any, at: Date): Record<string, unknown> {
  return {
    ...budgetCheck,
    checkedAt: at.toISOString(),
  };
}

export async function handleWalletDisconnected(walletId: string): Promise<void> {
  const db = getDb();
  const blobs = await db.select().from(blobRegistrations)
    .where(and(
      eq(blobRegistrations.walletId, walletId),
      sql`status IN ('protected')`,
    ));
  for (const blob of blobs) {
    const previousStatus = blob.status;
    validateTransition('blob', blob.status as string, 'tracked');
    await db.update(blobRegistrations)
      .set({ status: 'tracked', updatedAt: new Date() })
      .where(eq(blobRegistrations.id, blob.id));

    // Spec 20: Compensating actions are themselves audited
    // This automatic rollback from protected → tracked is logged as an audit event
    await db.insert(auditLogs).values({
      orgId: blob.orgId,
      action: 'blob.compensated_wallet_disconnect',
      resourceType: 'blob_registration',
      resourceId: blob.id,
      details: { previousStatus, newStatus: 'tracked', reason: 'wallet_disconnected', walletId },
    }).catch((err) => {
      // Best-effort: audit logging failure must not break the compensating action
      console.error('Failed to audit compensating action:', err);
    });

    await emit(createEvent(
      EventNames.BLOB_TRACKED, blob.orgId, 'blob_registration', blob.id,
      { type: 'system' },
      { previousStatus, reason: 'wallet_disconnected', compensatingAction: true },
    ));
  }
}

export async function verifyOnChainStateBeforeRetry(
  blobId: string,
  aggregatorUrl: string,
): Promise<{ verified: boolean; currentState: any }> {
  try {
    const response = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}/status`);
    const state = await response.json();
    return { verified: true, currentState: state };
  } catch {
    return { verified: false, currentState: null };
  }
}
