import { policyEngine } from '../../api/src/lib/policy-engine.js';
import { validateTransition } from '../../api/src/lib/state-machine.js';
import { emit, createEvent } from '../../api/src/lib/event-bus.js';
import { getDb } from './db.js';
import { logger as rootLogger } from './logger.js';


const logger = rootLogger.child({ component: 'policy-reconciler' });

export async function reconcilePolicies(db: ReturnType<typeof getDb>, orgId?: string): Promise<{ matched: number; unmatched: number }> {
  let matched = 0;
  let unmatched = 0;

  const trackedBlobs = await (orgId
    ? db`SELECT id, org_id FROM blob_registrations WHERE status = 'tracked' AND org_id = ${orgId}`
    : db`SELECT id, org_id FROM blob_registrations WHERE status = 'tracked'`
  );
  for (const blob of trackedBlobs as any[]) {
    try {
      const resolved = await policyEngine.resolveEffectivePolicy(blob.id);
      if (resolved.policyId && resolved.autoRenewalEnabled) {
        validateTransition('blob', 'tracked', 'protected');
        const [result] = await db`
          UPDATE blob_registrations SET status = 'protected', protected_at = now(), updated_at = now()
          WHERE id = ${blob.id} AND status = 'tracked'
          RETURNING id
        `;
        if (result) {
          await emit(createEvent('blob.protected', blob.org_id, 'blob_registration', blob.id, { type: 'system' }, { policyId: resolved.policyId }));
          matched++;
        }
      }
    } catch (err) {
      logger.warn({ blobId: blob.id, error: err }, 'Policy reconciliation failed for tracked blob');
    }
  }

  const protectedBlobs = await (orgId
    ? db`SELECT id, org_id FROM blob_registrations WHERE status = 'protected' AND org_id = ${orgId}`
    : db`SELECT id, org_id FROM blob_registrations WHERE status = 'protected'`
  );
  for (const blob of protectedBlobs as any[]) {
    try {
      const resolved = await policyEngine.resolveEffectivePolicy(blob.id);
      if (!resolved.policyId || !resolved.autoRenewalEnabled) {
        validateTransition('blob', 'protected', 'tracked');
        const [result] = await db`
          UPDATE blob_registrations SET status = 'tracked', tracked_at = now(), updated_at = now()
          WHERE id = ${blob.id} AND status = 'protected'
          RETURNING id
        `;
        if (result) {
          await emit(createEvent('blob.unprotected', blob.org_id, 'blob_registration', blob.id, { type: 'system' }, { previousPolicyId: resolved.policyId }));
          unmatched++;
        }
      }
    } catch (err) {
      logger.warn({ blobId: blob.id, error: err }, 'Policy reconciliation failed for protected blob');
    }
  }

  return { matched, unmatched };
}
