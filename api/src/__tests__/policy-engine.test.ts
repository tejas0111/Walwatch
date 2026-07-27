import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './setup.js';
import { getDb } from '../db/index.js';
import {
  organizations,
  projects,
  wallets,
  blobRegistrations,
  policies,
  policyAssignments,
} from '../db/schema.js';
import { policyEngine } from '../lib/policy-engine.js';

describe('Policy Engine', () => {
  let orgId: string;
  let projectId: string;
  let walletId: string;
  let blobId: string;

  beforeAll(async () => {
    await setupTestDb();
    const db = getDb();

    const [org] = await db.insert(organizations).values({
      name: 'Policy Engine Org',
      slug: `policy-engine-${Date.now()}`,
    }).returning();
    orgId = org.id;

    const [project] = await db.insert(projects).values({
      orgId,
      name: 'Policy Engine Project',
      slug: `policy-engine-proj-${Date.now()}`,
    }).returning();
    projectId = project.id;

    const [wallet] = await db.insert(wallets).values({
      orgId,
      projectId,
      address: `policy-wallet-${Date.now()}`,
    }).returning();
    walletId = wallet.id;

    const [blob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      walletId,
      blobId: `policy-test-blob-${Date.now()}`,
      tags: ['storage', 'archive'],
    }).returning();
    blobId = blob.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('resolves blob-level explicit policy over project/org', async () => {
    const db = getDb();

    const [orgPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Org Default',
      renewThreshold: 14,
      renewExtension: 60,
      autoRenewalEnabled: true,
      active: true,
      status: 'active',
      scope: 'organization',
      scopeTargetId: orgId,
    }).returning();

    const [projectPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Project Policy',
      renewThreshold: 7,
      renewExtension: 30,
      autoRenewalEnabled: true,
      active: true,
      status: 'active',
      scope: 'project',
      scopeTargetId: projectId,
    }).returning();

    const [blobPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Blob Specific',
      renewThreshold: 3,
      renewExtension: 10,
      maxTotalEpochs: 100,
      autoRenewalEnabled: true,
      active: true,
      status: 'active',
      scope: 'blob',
      scopeTargetId: blobId,
    }).returning();

    await db.insert(policyAssignments).values({
      policyId: blobPolicy.id,
      blobRegistrationId: blobId,
    });

    const resolved = await policyEngine.resolveEffectivePolicy(blobId);
    expect(resolved.policyId).toBe(blobPolicy.id);
    expect(resolved.policyName).toBe('Blob Specific');
    expect(resolved.renewThreshold).toBe(3);
    expect(resolved.renewExtension).toBe(10);
    expect(resolved.maxTotalEpochs).toBe(100);
    expect(resolved.autoRenewalEnabled).toBe(true);
    expect(resolved.scope).toBe('blob');
    expect(resolved.resolutionPath).toContain('explicit');
  });

  it('resolves blob-scope (scope=blob) when no explicit assignment exists', async () => {
    const db = getDb();

    // Create a blob-scope policy (scope='blob' + scopeTargetId=blobId)
    // This is different from the explicit assignment via policyAssignments table
    const [blobScopePolicy] = await db.insert(policies).values({
      orgId,
      name: 'Blob Scope Policy',
      renewThreshold: 5,
      renewExtension: 15,
      autoRenewalEnabled: true,
      active: true,
      status: 'active',
      scope: 'blob',
      scopeTargetId: blobId,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(blobId);
    // blob-scope should be found before project/org policies
    expect(resolved.policyId).toBe(blobScopePolicy.id);
    expect(resolved.scope).toBe('blob');
    expect(resolved.resolutionPath).toContain('scope');
  });

  it('resolves project-level policy when no blob assignment or scope exists', async () => {
    const db = getDb();

    const [otherBlob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: `no-blob-assign-${Date.now()}`,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(otherBlob.id);
    expect(resolved.policyName).toBe('Project Policy');
    expect(resolved.renewThreshold).toBe(7);
    expect(resolved.renewExtension).toBe(30);
    expect(resolved.scope).toBe('project');
  });

  it('resolves org-level policy when no project/blob policy exists', async () => {
    const db = getDb();

    const [otherProject] = await db.insert(projects).values({
      orgId,
      name: 'No Policy Project',
      slug: `no-policy-proj-${Date.now()}`,
    }).returning();

    const [noPolicyBlob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId: otherProject.id,
      blobId: `org-level-blob-${Date.now()}`,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(noPolicyBlob.id);
    expect(resolved.policyName).toBe('Org Default');
    expect(resolved.renewThreshold).toBe(14);
    expect(resolved.renewExtension).toBe(60);
    expect(resolved.scope).toBe('organization');
  });

  it('falls back to system default when no policies exist', async () => {
    const db = getDb();

    const [emptyPolicyOrg] = await db.insert(organizations).values({
      name: 'Empty Policy Org',
      slug: `empty-policy-${Date.now()}`,
    }).returning();

    const [noPolicyProject] = await db.insert(projects).values({
      orgId: emptyPolicyOrg.id,
      name: 'No Policies',
      slug: `no-policies-${Date.now()}`,
    }).returning();

    const [noPolicyBlob] = await db.insert(blobRegistrations).values({
      orgId: emptyPolicyOrg.id,
      projectId: noPolicyProject.id,
      blobId: `fallback-blob-${Date.now()}`,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(noPolicyBlob.id);
    expect(resolved.policyId).toBeNull();
    expect(resolved.policyName).toBeNull();
    expect(resolved.renewThreshold).toBe(7);
    expect(resolved.renewExtension).toBe(30);
    expect(resolved.maxTotalEpochs).toBeNull();
    expect(resolved.autoRenewalEnabled).toBe(false);
    expect(resolved.budgetId).toBeNull();
    expect(resolved.spendingLimitId).toBeNull();
    expect(resolved.publisherPriorityOverride).toBeNull();
    expect(resolved.scope).toBe('default');
    expect(resolved.resolutionPath).toContain('default');
  });

  it('resolves wallet-level policy when blob.walletId matches', async () => {
    const db = getDb();

    const [walletPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Wallet Policy',
      renewThreshold: 4,
      renewExtension: 20,
      autoRenewalEnabled: true,
      active: true,
      status: 'active',
      scope: 'wallet',
      scopeTargetId: walletId,
    }).returning();

    const [walletBlob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      walletId,
      blobId: `wallet-blob-${Date.now()}`,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(walletBlob.id);
    // Wallet policy should be found before project/org
    expect(resolved.policyId).toBe(walletPolicy.id);
    expect(resolved.scope).toBe('wallet');
  });

  it('applies Latest rule when two policies exist at the same scope', async () => {
    const db = getDb();

    // Create two project-scope policies for the same project
    const [olderPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Older Project Policy',
      renewThreshold: 10,
      renewExtension: 40,
      autoRenewalEnabled: true,
      active: true,
      status: 'active',
      scope: 'project',
      scopeTargetId: projectId,
      createdAt: new Date('2024-01-01'),
    }).returning();

    const [newerPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Newer Project Policy',
      renewThreshold: 20,
      renewExtension: 50,
      autoRenewalEnabled: false,
      active: true,
      status: 'active',
      scope: 'project',
      scopeTargetId: projectId,
      createdAt: new Date('2024-06-01'),
    }).returning();

    // This blob has no explicit/wallet/blob-scope assignment
    const [latestBlob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: `latest-blob-${Date.now()}`,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(latestBlob.id);
    // Newer policy should win
    expect(resolved.policyId).toBe(newerPolicy.id);
    expect(resolved.renewThreshold).toBe(20);
    expect(resolved.autoRenewalEnabled).toBe(false);
    expect(resolved.resolutionPath).toContain('latest');
  });

  it('paused policy is not resolved', async () => {
    const db = getDb();

    const [pausedPolicy] = await db.insert(policies).values({
      orgId,
      name: 'Paused Policy',
      renewThreshold: 99,
      renewExtension: 99,
      active: false,
      status: 'paused',
      scope: 'project',
      scopeTargetId: projectId,
    }).returning();

    // This blob has no other specific policy — should get org default, not paused policy
    const [pausedBlob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: `paused-blob-${Date.now()}`,
    }).returning();

    const resolved = await policyEngine.resolveEffectivePolicy(pausedBlob.id);
    // Should skip paused policy and resolve to org-level
    expect(resolved.policyName).toBe('Org Default');
    expect(resolved.policyId).not.toBe(pausedPolicy.id);
  });

  it('evaluation is deterministic (same result on multiple calls)', async () => {
    const db = getDb();

    const [detBlob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: `deterministic-blob-${Date.now()}`,
    }).returning();

    // Call resolve twice, should get identical results
    const result1 = await policyEngine.resolveEffectivePolicy(detBlob.id);
    const result2 = await policyEngine.resolveEffectivePolicy(detBlob.id);

    expect(result1.policyId).toBe(result2.policyId);
    expect(result1.renewThreshold).toBe(result2.renewThreshold);
    expect(result1.autoRenewalEnabled).toBe(result2.autoRenewalEnabled);
    expect(result1.scope).toBe(result2.scope);
  });
});
