/**
 * Publisher Selector
 *
 * Implements publisher priority ordering per Project (Spec 08).
 * Selects the highest-priority healthy publisher for a renewal.
 * Falls back to the next publisher if the preferred one is
 * unavailable or fails.
 *
 * Publisher health is determined by lastHeartbeatAt — a publisher
 * whose last heartbeat exceeds the stale threshold is considered
 * degraded and skipped in favor of the next healthy one.
 */

import { logger as rootLogger } from './logger.js';
import { getDb } from './db.js';

const logger = rootLogger.child({ component: 'publisher-selector' });

export interface PublisherInfo {
  id: string;
  name: string;
  endpoint: string | null;
  walletAddress: string | null;
  suiVaultId: string | null;
  status: string;
  lastHeartbeatAt: Date | null;
  priority: number;
}

/**
 * Default stale threshold: publisher is considered degraded if no
 * heartbeat received within this duration.
 */
const STALE_HEARTBEAT_MS = parseInt(
  process.env.PUBLISHER_HEARTBEAT_STALE_MS || '300000', // 5 minutes default
  10,
);

/**
 * Select the best available publisher for a given project.
 *
 * Returns the highest-priority active publisher with a recent
 * heartbeat. If no publisher is configured or all are degraded,
 * returns null (the caller should use a default path or escalate).
 */
export async function selectPublisherForProject(
  projectId: string,
  orgId: string,
  publisherPriorityOverride?: number,
): Promise<PublisherInfo | null> {
  const db = getDb();

  const assigned = await db`
    SELECT
      p.id,
      p.name,
      p.endpoint,
      p.wallet_address,
      p.sui_vault_id,
      p.status,
      p.last_heartbeat_at,
      pp.priority
    FROM project_publishers pp
    JOIN publishers p ON p.id = pp.publisher_id
    WHERE pp.project_id = ${projectId}
      AND pp.status = 'active'
      AND p.status IN ('active', 'degraded')
    ORDER BY pp.priority ASC
  `;

  if (!assigned || assigned.length === 0) {
    logger.debug({ projectId, orgId }, 'No publishers assigned to project');
    return null;
  }

  const now = Date.now();

  function isPublisherHealthy(row: any): boolean {
    const lastHb = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
    const healthMs = now - lastHb;
    return row.status !== 'degraded' && healthMs < STALE_HEARTBEAT_MS;
  }

  function toPublisherInfo(row: any): PublisherInfo {
    return {
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      walletAddress: row.wallet_address,
      suiVaultId: row.sui_vault_id,
      status: row.status,
      lastHeartbeatAt: row.last_heartbeat_at,
      priority: row.priority,
    };
  }

  // If publisherPriorityOverride is specified, try that publisher first
  if (publisherPriorityOverride != null) {
    const overrideRow = (assigned as any[]).find(
      row => row.priority === publisherPriorityOverride,
    );
    if (overrideRow && isPublisherHealthy(overrideRow)) {
      logger.info({
        publisherId: overrideRow.id,
        name: overrideRow.name,
        priority: overrideRow.priority,
        projectId,
        override: true,
      }, 'Selected publisher via priority override');
      return toPublisherInfo(overrideRow);
    }
  }

  // Fall back to default priority ordering
  for (const row of assigned as any[]) {
    if (!isPublisherHealthy(row)) {
      logger.debug({
        publisherId: row.id,
        name: row.name,
        priority: row.priority,
        status: row.status,
        lastHeartbeat: row.last_heartbeat_at,
      }, 'Publisher is degraded or stale — skipping');
      continue;
    }

    logger.info({
      publisherId: row.id,
      name: row.name,
      priority: row.priority,
      projectId,
    }, 'Selected publisher for renewal');

    return toPublisherInfo(row);
  }

  logger.warn({ projectId, orgId, totalPublishers: assigned.length },
    'All assigned publishers are degraded/unhealthy — no publisher available');
  return null;
}

/**
 * Select publisher by org-level default when no project-specific
 * assignment exists. Returns the highest-priority active publisher
 * for the org.
 */
export async function selectPublisherForOrg(
  orgId: string,
): Promise<PublisherInfo | null> {
  const db = getDb();

  const publishers = await db`
    SELECT id, name, endpoint, wallet_address, sui_vault_id, status, last_heartbeat_at
    FROM publishers
    WHERE org_id = ${orgId}
      AND status IN ('active', 'degraded')
      AND deleted_at IS NULL
    ORDER BY last_heartbeat_at DESC NULLS LAST
    LIMIT 1
  `;

  if (!publishers || publishers.length === 0) {
    logger.debug({ orgId }, 'No org-level publishers available');
    return null;
  }

  const pub = publishers[0] as any;
  const lastHb = pub.last_heartbeat_at ? new Date(pub.last_heartbeat_at).getTime() : 0;
  const isHealthy = pub.status !== 'degraded' && (Date.now() - lastHb) < STALE_HEARTBEAT_MS;

  if (!isHealthy) {
    logger.warn({ orgId, publisherId: pub.id }, 'Only available org publisher is degraded');
    return null;
  }

  return {
    id: pub.id,
    name: pub.name,
    endpoint: pub.endpoint,
    walletAddress: pub.wallet_address,
    suiVaultId: pub.sui_vault_id,
    status: pub.status,
    lastHeartbeatAt: pub.last_heartbeat_at,
    priority: 0,
  };
}

/**
 * Resolve the best publisher for a given project/org combination.
 * Tries project-specific assignment first, falls back to org-level.
 */
export async function resolvePublisher(
  projectId: string | null,
  orgId: string,
  publisherPriorityOverride?: number,
): Promise<PublisherInfo | null> {
  if (projectId) {
    const projectPublisher = await selectPublisherForProject(projectId, orgId, publisherPriorityOverride);
    if (projectPublisher) return projectPublisher;
  }

  return selectPublisherForOrg(orgId);
}
