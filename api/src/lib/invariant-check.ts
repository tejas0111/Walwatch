import { getDb } from '../db/index.js';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { wallets, renewalJobs, blobRegistrations, auditLogs } from '../db/schema.js';
import { AppError, ErrorCodes } from './errors.js';
import { emit, createEvent, EventNames } from '../lib/event-bus.js';

type DrizzleDb = ReturnType<typeof getDb>;

export class InvariantChecker {
  /**
   * Invariant 2: No duplicate active wallet address per project
   */
  async ensureUniqueWalletAddress(orgId: string, projectId: string | null, address: string): Promise<void> {
    const conditions = projectId
      ? and(eq(wallets.orgId, orgId), eq(wallets.address, address), eq(wallets.projectId, projectId), sql`${wallets.status} IN ('active', 'connected')`, sql`${wallets.deletedAt} IS NULL`)
      : and(eq(wallets.orgId, orgId), eq(wallets.address, address), sql`${wallets.projectId} IS NULL`, sql`${wallets.status} IN ('active', 'connected')`, sql`${wallets.deletedAt} IS NULL`);
    const existing = await getDb().select().from(wallets)
      .where(conditions).then(r => r[0]);
    if (existing) {
      throw new AppError(`Wallet with address ${address} already exists in this project`, 409, ErrorCodes.CONFLICT);
    }
  }

  /**
   * Invariant 4: At most one in_progress renewal per blob at a time
   */
  async ensureNoActiveRenewal(blobRegistrationId: string): Promise<void> {
    const active = await getDb().select().from(renewalJobs)
      .where(and(
        eq(renewalJobs.blobRegistrationId, blobRegistrationId),
        eq(renewalJobs.status, 'in_progress'),
      )).then(r => r[0]);
    if (active) {
      throw new AppError(`Blob ${blobRegistrationId} already has an in_progress renewal`, 409, ErrorCodes.CONFLICT);
    }
  }

  async ensureNoOrphanedBlobs(db: DrizzleDb, orgId?: string): Promise<{ detected: number; resolved: number }> {
    const query = db
      .select({ id: blobRegistrations.id, orgId: blobRegistrations.orgId })
      .from(blobRegistrations)
      .leftJoin(wallets, eq(blobRegistrations.walletId, wallets.id))
      .where(
        and(
          isNull(wallets.id),
          isNull(blobRegistrations.deletedAt),
          orgId ? eq(blobRegistrations.orgId, orgId) : undefined,
        ),
      );

    const orphans = await query;
    if (orphans.length === 0) {
      return { detected: 0, resolved: 0 };
    }

    let resolved = 0;

    await db.transaction(async (tx) => {
      for (const blob of orphans) {
        await tx.update(blobRegistrations)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(blobRegistrations.id, blob.id));

        await emit(createEvent(
          EventNames.BLOB_ARCHIVED,
          blob.orgId,
          'blob_registration',
          blob.id,
          { type: 'system' },
          { reason: 'orphaned_wallet' },
        ));

        await tx.insert(auditLogs).values({
          orgId: blob.orgId,
          action: 'blob.orphaned_archived',
          resourceType: 'blob_registration',
          resourceId: blob.id,
          details: { reason: 'wallet_disconnected_or_deleted' },
        });

        resolved++;
      }
    });

    return { detected: orphans.length, resolved };
  }

  /**
   * Invariant 8: Entity traces to exactly one org
   */
  verifyOrgChain(entity: { orgId?: string; projectId?: string }): string {
    if (!entity.orgId) throw new AppError('Entity must have an orgId', 400, ErrorCodes.VALIDATION_ERROR);
    return entity.orgId;
  }
}

export const invariantChecker = new InvariantChecker();
