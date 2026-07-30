import { getDb } from '../db/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { policies, policyAssignments, blobRegistrations } from '../db/schema.js';
import { AppError, ErrorCodes } from './errors.js';

export interface ResolvedPolicy {
  policyId: string | null;
  policyName: string | null;
  renewThreshold: number;
  renewExtension: number;
  maxTotalEpochs: number | null;
  autoRenewalEnabled: boolean;
  budgetId: string | null;
  spendingLimitId: string | null;
  publisherPriorityOverride: number | null;
  maxRetries: number;
  scope: string;
  resolutionPath: string[];
}

const SYSTEM_DEFAULT_POLICY: ResolvedPolicy = {
  policyId: null,
  policyName: null,
  renewThreshold: 7,
  renewExtension: 30,
  maxTotalEpochs: null,
  autoRenewalEnabled: false,
  budgetId: null,
  spendingLimitId: null,
  publisherPriorityOverride: null,
  maxRetries: 5,
  scope: 'default',
  resolutionPath: ['default'],
};

type PolicyRow = typeof policies.$inferSelect;

export class PolicyEngine {
  /**
   * Resolve the effective policy for a blob.
   *
   * Conflict Resolution Order (same scope level):
   *   1. Explicit — a policy naming this Blob ID wins (via policyAssignments)
   *   2. Specific — among tag matches, more/narrower tags wins
   *   3. Latest — most recently created/updated wins
   *   4. Default — fall back to system default (alert-only, no auto-renewal)
   *
   * Inheritance chain (most specific scope wins in FULL):
   *   Blob (explicit) > Blob (scope) > Tag > Wallet > Project > Organization
   */
  async resolveEffectivePolicy(blobId: string): Promise<ResolvedPolicy> {
    const db = getDb();
    const blob = await db.select().from(blobRegistrations)
      .where(eq(blobRegistrations.id, blobId)).then(r => r[0]);
    if (!blob) throw new AppError(`Blob ${blobId} not found`, 404, ErrorCodes.NOT_FOUND);

    // 1. Check for blob-level EXPLICIT assignment via policyAssignments table
    const explicitAssignment = await this.findExplicitBlobAssignment(blobId);
    if (explicitAssignment) {
      return this.toResolvedPolicy(explicitAssignment, ['blob', 'explicit']);
    }

    // 2. Build scope priority: most specific first
    //    Matches are collected per scope level so we can apply conflict resolution
    //    within each scope level before falling through to broader scopes.

    // 2a. Blob-scope (scope='blob' with scopeTargetId = blob.id)
    const blobScopePolicies = await this.getPoliciesForScope(blob.orgId, 'blob', blob.id);
    if (blobScopePolicies.length > 0) {
      return this.resolveWithinScope(blobScopePolicies, ['blob', 'scope']);
    }

    // 2b. Tag-scope (scope='tag' — policy tags intersect blob tags, narrowest match wins)
    const tagResults = await this.resolveTagPolicies(blob);
    if (tagResults) {
      return tagResults;
    }

    // 2c. Wallet-scope (scope='wallet' with scopeTargetId = blob.walletId)
    if (blob.walletId) {
      const walletPolicies = await this.getPoliciesForScope(blob.orgId, 'wallet', blob.walletId);
      if (walletPolicies.length > 0) {
        return this.resolveWithinScope(walletPolicies, ['wallet']);
      }
    }

    // 2d. Project-scope (scope='project' with scopeTargetId = blob.projectId)
    const projectPolicies = await this.getPoliciesForScope(blob.orgId, 'project', blob.projectId);
    if (projectPolicies.length > 0) {
      return this.resolveWithinScope(projectPolicies, ['project']);
    }

    // 2e. Organization-scope (scope='organization' with orgId match)
    const orgPolicies = await this.getPoliciesForScope(blob.orgId, 'organization', blob.orgId);
    if (orgPolicies.length > 0) {
      return this.resolveWithinScope(orgPolicies, ['organization']);
    }

    // 3. Fallback: system default
    return { ...SYSTEM_DEFAULT_POLICY };
  }

  /**
   * Find an explicit blob assignment via the policyAssignments join table.
   * This is the highest-priority match (Explicit rule).
   */
  private async findExplicitBlobAssignment(blobId: string): Promise<PolicyRow | null> {
    const db = getDb();
    const rows = await db.select()
      .from(policyAssignments)
      .where(eq(policyAssignments.blobRegistrationId, blobId))
      .leftJoin(policies, eq(policyAssignments.policyId, policies.id))
      .then(r => r.filter(row => row.policies?.status === 'active'));

    if (rows.length === 0) return null;

    // Among explicit assignments, pick the most recently created (Latest rule).
    // Spec 27 tie-breaking: use `id` as deterministic secondary sort.
    rows.sort((a, b) => {
      const aTime = a.policies!.createdAt?.getTime() ?? 0;
      const bTime = b.policies!.createdAt?.getTime() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.policies!.id < b.policies!.id ? 1 : -1;
    });

    return rows[0].policies as PolicyRow;
  }

  /**
   * Resolve among tag-based policies for a blob.
   * The spec says: "among tag matches, more/narrower tags wins".
   * If a blob has tags ["storage", "archive"] and we have two policies:
   *   - Policy A with tags ["storage"]
   *   - Policy B with tags ["storage", "archive"]
   * Policy B wins because it matches more/narrower tags.
   */
  private async resolveTagPolicies(blob: any): Promise<ResolvedPolicy | null> {
    const blobTags: string[] = blob.tags ?? [];
    if (blobTags.length === 0) return null;
    return this.resolveTagPoliciesByTags(blob.orgId, blobTags);
  }

  private async resolveTagPoliciesByTags(orgId: string, tags: string[]): Promise<ResolvedPolicy | null> {
    const db = getDb();
    const tagPolicies = await db.select().from(policies)
      .where(and(
        eq(policies.orgId, orgId),
        eq(policies.scope, 'tag'),
        eq(policies.status, 'active'),
      ));

    const matching: Array<{ policy: PolicyRow; matchCount: number }> = [];
    for (const pol of tagPolicies) {
      const policyTags = this.extractPolicyTags(pol);
      if (policyTags.length === 0) continue;

      const intersection = policyTags.filter((t: string) => tags.includes(t));
      if (intersection.length > 0) {
        matching.push({ policy: pol, matchCount: intersection.length });
      }
    }

    if (matching.length === 0) return null;

    matching.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      const aTime = a.policy.createdAt?.getTime() ?? 0;
      const bTime = b.policy.createdAt?.getTime() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.policy.id < b.policy.id ? 1 : -1;
    });

    return this.toResolvedPolicy(matching[0].policy, ['tag']);
  }

  /**
   * Extract tag conditions from a policy's rules JSON.
   * Tag policies are expected to have rules like:
   *   [{ "field": "tag", "operator": "in", "value": ["storage", "archive"] }]
   */
  private extractPolicyTags(policy: PolicyRow): string[] {
    try {
      const rules = policy.rules as Array<Record<string, unknown>> | null;
      if (!Array.isArray(rules)) return [];

      for (const rule of rules) {
        if (rule.field === 'tag' && Array.isArray(rule.value)) {
          return rule.value as string[];
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get all active policies for a given org at a specific scope level targeting a specific ID.
   */
  private async getPoliciesForScope(
    orgId: string,
    scope: string,
    targetId: string,
  ): Promise<PolicyRow[]> {
    const db = getDb();
    return db.select().from(policies)
      .where(and(
        eq(policies.orgId, orgId),
        eq(policies.scope, scope),
        eq(policies.scopeTargetId, targetId),
        eq(policies.status, 'active'),
      ))
      .orderBy(desc(policies.createdAt));
  }

  /**
   * Resolve within a single scope level using conflict resolution:
   * All policies at this scope are tied (same scope, same target) — use Latest rule.
   */
  /**
   * Resolve the effective policy from scope parameters directly,
   * without requiring a blob registration.
   *
   * Inheritance chain: Tag > Wallet > Project > Organization
   */
  async resolveFromScope(params: {
    orgId: string;
    projectId: string;
    walletId?: string;
    tags?: string[];
  }): Promise<ResolvedPolicy> {
    // Tag-scope
    if (params.tags && params.tags.length > 0) {
      const tagResult = await this.resolveTagPoliciesByTags(params.orgId, params.tags);
      if (tagResult) return tagResult;
    }

    // Wallet-scope
    if (params.walletId) {
      const walletPolicies = await this.getPoliciesForScope(params.orgId, 'wallet', params.walletId);
      if (walletPolicies.length > 0) {
        return this.resolveWithinScope(walletPolicies, ['wallet']);
      }
    }

    // Project-scope
    const projectPolicies = await this.getPoliciesForScope(params.orgId, 'project', params.projectId);
    if (projectPolicies.length > 0) {
      return this.resolveWithinScope(projectPolicies, ['project']);
    }

    // Organization-scope
    const orgPolicies = await this.getPoliciesForScope(params.orgId, 'organization', params.orgId);
    if (orgPolicies.length > 0) {
      return this.resolveWithinScope(orgPolicies, ['organization']);
    }

    return { ...SYSTEM_DEFAULT_POLICY };
  }

  private resolveWithinScope(policies: PolicyRow[], path: string[]): ResolvedPolicy {
    if (policies.length === 1) {
      return this.toResolvedPolicy(policies[0], path);
    }

    // Latest rule: most recently created wins.
    // Spec 27 tie-breaking: use `id` as a deterministic secondary sort to prevent
    // wall-clock ties when two policies are created simultaneously.
    const sorted = [...policies].sort((a, b) => {
      const aTime = a.createdAt?.getTime() ?? 0;
      const bTime = b.createdAt?.getTime() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      // Deterministic tie-break: `id` is a UUID — random but provides a stable total order.
      return a.id < b.id ? 1 : -1;
    });

    return this.toResolvedPolicy(sorted[0], [...path, 'latest']);
  }

  private toResolvedPolicy(policy: PolicyRow, path: string[]): ResolvedPolicy {
    return {
      policyId: policy.id,
      policyName: policy.name,
      renewThreshold: policy.renewThreshold,
      renewExtension: policy.renewExtension,
      maxTotalEpochs: policy.maxTotalEpochs,
      autoRenewalEnabled: policy.autoRenewalEnabled ?? policy.active,
      budgetId: policy.budgetId ?? null,
      spendingLimitId: policy.spendingLimitId ?? null,
      publisherPriorityOverride: policy.publisherPriorityOverride ?? null,
      maxRetries: policy.maxRetries ?? 5,
      scope: policy.scope || 'unknown',
      resolutionPath: path,
    };
  }
}

export const policyEngine = new PolicyEngine();
