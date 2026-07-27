import { getDb } from '../db/index.js';
import { orgMembers, projectMembers, capabilityGrants } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export enum Capability {
  MANAGE_POLICIES = 'manage_policies',
  MANAGE_BUDGETS = 'manage_budgets',
  TRIGGER_RENEWALS = 'trigger_renewals',
  MANAGE_WALLETS = 'manage_wallets',
  MANAGE_ALERTS = 'manage_alerts',
  MANAGE_WEBHOOKS = 'manage_webhooks',
  MANAGE_API_KEYS = 'manage_api_keys',
  VIEW_AUDIT_LOG = 'view_audit_log',
}

const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  owner: Object.values(Capability),
  admin: Object.values(Capability),
  member: [
    Capability.MANAGE_POLICIES,
    Capability.MANAGE_BUDGETS,
    Capability.TRIGGER_RENEWALS,
    Capability.MANAGE_WALLETS,
  ],
  viewer: [Capability.VIEW_AUDIT_LOG],
};

export function getCapabilitiesForRole(role: string): Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export async function resolveEffectivePermissions(
  userId: string,
  orgId: string,
  projectId?: string,
): Promise<{ role: string; capabilities: Capability[] }> {
  const db = getDb();

  const [member] = await db.select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);

  const orgRole = member?.role ?? 'viewer';

  let projectRole: string | null = null;
  if (projectId) {
    const [pm] = await db.select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)))
      .limit(1);
    if (pm) {
      projectRole = pm.role;
    }
  }

  const projectCondition = projectId
    ? sql`(${capabilityGrants.projectId} IS NULL OR ${capabilityGrants.projectId} = ${projectId})`
    : sql`${capabilityGrants.projectId} IS NULL`;

  const grants = await db.select({ capability: capabilityGrants.capability })
    .from(capabilityGrants)
    .where(and(
      eq(capabilityGrants.userId, userId),
      eq(capabilityGrants.orgId, orgId),
      projectCondition,
    ));

  const baseCapabilities = getCapabilitiesForRole(orgRole);
  const grantCapabilities = grants.map(g => g.capability as Capability);
  const merged = [...new Set([...baseCapabilities, ...grantCapabilities])];

  return { role: orgRole, capabilities: merged };
}
