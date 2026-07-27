import { logger as rootLogger } from './logger.js';
import { getDb } from './db.js';

const logger = rootLogger.child({ component: 'vault-mapper' });

export interface BlobRegistrationRow {
  id: string;
  orgId: string;
  projectId: string | null;
  walletId: string | null;
  blobId: string;
  status: string;
  suiVaultId: string | null;
}

export interface PolicyRow {
  id: string;
  orgId: string;
  renewThreshold: number;
  renewExtension: number;
  maxTotalEpochs: number | null;
  status: string;
}

export async function findBlobRegistrationByBlobId(blobId: string): Promise<BlobRegistrationRow | null> {
  const sql = getDb();
  try {
    const [row] = await sql`
      SELECT id, org_id, project_id, wallet_id, blob_id, status, sui_vault_id
      FROM blob_registrations
      WHERE blob_id = ${blobId} AND status NOT IN ('archived', 'deleted')
      LIMIT 1
    `;
    return row ? (row as unknown as BlobRegistrationRow) : null;
  } catch (error) {
    logger.error({ error, blobId }, 'Failed to find blob registration');
    return null;
  }
}

export async function updateBlobSuiVaultId(blobId: string, vaultId: string): Promise<void> {
  const sql = getDb();
  try {
    await sql`
      UPDATE blob_registrations
      SET sui_vault_id = ${vaultId}, updated_at = NOW()
      WHERE blob_id = ${blobId}
    `;
  } catch (error) {
    logger.error({ error, blobId, vaultId }, 'Failed to update blob sui_vault_id');
  }
}

export async function findPoliciesForOrg(orgId: string): Promise<PolicyRow[]> {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT id, org_id, renew_threshold, renew_extension, max_total_epochs, status
      FROM policies
      WHERE org_id = ${orgId} AND status = 'active'
    `;
    return rows as unknown as PolicyRow[];
  } catch (error) {
    logger.error({ error, orgId }, 'Failed to fetch policies');
    return [];
  }
}
