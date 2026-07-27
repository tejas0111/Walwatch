import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './setup.js';
import { getDb } from '../db/index.js';
import {
  organizations,
  projects,
  wallets,
  blobRegistrations,
  spendingLimits,
  budgets,
  renewalJobs,
  costRecords,
} from '../db/schema.js';
import { costEngine } from '../lib/cost-engine.js';
import { AppError } from '../lib/errors.js';

describe('Cost Engine', () => {
  let orgId: string;
  let projectId: string;
  let walletId: string;
  let blobId: string;

  beforeAll(async () => {
    await setupTestDb();
    const db = getDb();

    const [org] = await db.insert(organizations).values({
      name: 'Cost Engine Org',
      slug: `cost-engine-${Date.now()}`,
    }).returning();
    orgId = org.id;

    const [project] = await db.insert(projects).values({
      orgId,
      name: 'Cost Engine Project',
      slug: `cost-engine-proj-${Date.now()}`,
    }).returning();
    projectId = project.id;

    const [wallet] = await db.insert(wallets).values({
      orgId,
      projectId,
      address: `0xcost${Date.now()}`,
      status: 'active',
    }).returning();
    walletId = wallet.id;

    const [blob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      walletId,
      blobId: `cost-test-blob-${Date.now()}`,
      sizeBytes: 1000,
    }).returning();
    blobId = blob.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('blocks execution when cost exceeds wallet spending limit', async () => {
    const db = getDb();
    await db.insert(spendingLimits).values({
      scope: 'wallet',
      scopeTargetId: walletId,
      orgId,
      name: 'Test Hard Limit',
      amount: 100,
      spent: 0,
      status: 'active',
    }).returning();

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      200,
    );

    expect(result.allowed).toBe(false);
    expect(result.hardLimitBlocked).toBe(true);
    expect(result.message).toContain('spending limit');
  });

  it('allows execution when cost is within wallet spending limit', async () => {
    const db = getDb();
    const [limit] = await db.insert(spendingLimits).values({
      scope: 'wallet',
      scopeTargetId: walletId,
      orgId,
      name: 'Test Generous Limit',
      amount: 1000,
      spent: 0,
      status: 'active',
    }).returning();

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      50,
    );

    expect(result.allowed).toBe(true);
    expect(result.hardLimitBlocked).toBe(false);
  });

  it('allows execution when cost exceeds project budget (budgets are soft ceilings)', async () => {
    const db = getDb();
    await db.insert(budgets).values({
      orgId,
      projectId,
      name: 'Project Budget',
      amount: 100,
      spent: 0,
      status: 'active',
      alertThreshold: 80,
    }).returning();

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      200,
    );

    // Spec 11: Budgets are SOFT ceilings — alert only, never block
    expect(result.allowed).toBe(true);
    expect(result.hardLimitBlocked).toBe(false);
    expect(result.softThresholdCrossed).toBe(true);
  });

  it('allows execution when cost is within project budget', async () => {
    const db = getDb();
    await db.insert(budgets).values({
      orgId,
      projectId,
      name: 'Project Budget Generous',
      amount: 1000,
      spent: 0,
      status: 'active',
    }).returning();

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      50,
    );

    expect(result.allowed).toBe(true);
    expect(result.hardLimitBlocked).toBe(false);
  });

  it('allows execution when cost exceeds org-level budget (soft ceiling)', async () => {
    const db = getDb();
    await db.insert(budgets).values({
      orgId,
      projectId: null as any,
      name: 'Org Budget',
      amount: 100,
      spent: 0,
      status: 'active',
      alertThreshold: 80,
    }).returning();

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      200,
    );

    // Spec 11: Budgets are soft ceilings — never block
    expect(result.allowed).toBe(true);
    expect(result.hardLimitBlocked).toBe(false);
    expect(result.softThresholdCrossed).toBe(true);
  });

  it('detects soft threshold crossing on budgets', async () => {
    const db = getDb();
    const [budget] = await db.insert(budgets).values({
      orgId,
      projectId: null as any,
      name: 'Soft Threshold Budget',
      amount: 1000,
      spent: 0,
      status: 'active',
      alertThreshold: 80,
    }).returning();

    // Seed cost records to simulate 900 spent
    const [job] = await db.insert(renewalJobs).values({
      orgId,
      blobRegistrationId: blobId,
      status: 'succeeded',
    }).returning();
    await db.insert(costRecords).values({
      blobRegistrationId: blobId,
      renewalJobId: job.id,
      actualCost: '900',
      orgId,
      projectId: null,
    });

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      50,
    );

    expect(result.allowed).toBe(true);
    expect(result.softThresholdCrossed).toBe(true);
  });

  it('detects soft threshold crossing when cost equals budget amount', async () => {
    const db = getDb();
    const [budget] = await db.insert(budgets).values({
      orgId,
      projectId: null as any,
      name: 'At Limit Budget',
      amount: 100,
      spent: 0,
      status: 'active',
      alertThreshold: 90,
    }).returning();

    // Seed cost records to simulate 90 spent
    const [job] = await db.insert(renewalJobs).values({
      orgId,
      blobRegistrationId: blobId,
      status: 'succeeded',
    }).returning();
    await db.insert(costRecords).values({
      blobRegistrationId: blobId,
      renewalJobId: job.id,
      actualCost: '90',
      orgId,
      projectId: null,
    });

    const result = await costEngine.checkBudgetBeforeExecution(
      orgId,
      projectId,
      walletId,
      null,
      10,
    );

    expect(result.allowed).toBe(true);
    expect(result.softThresholdCrossed).toBe(true);
  });

  it('recordActualCost updates renewal job and budgets', async () => {
    const db = getDb();
    const [job] = await db.insert(renewalJobs).values({
      orgId,
      blobRegistrationId: blobId,
      status: 'in_progress',
    }).returning();

    await costEngine.recordActualCost(job.id, 42, 'tx-digest-abc', projectId);

    const [updated] = await db.select().from(renewalJobs)
      .where(eq(renewalJobs.id, job.id))
      .limit(1);

    expect(updated.actualCost).toBe('42');
    expect(updated.txDigest).toBe('tx-digest-abc');
    expect(updated.completedAt).toBeTruthy();
  });

  it('rejects duplicate actual cost recording (immutability)', async () => {
    const db = getDb();
    const [job] = await db.insert(renewalJobs).values({
      orgId,
      blobRegistrationId: blobId,
      status: 'in_progress',
    }).returning();

    await costEngine.recordActualCost(job.id, 100, 'tx-1', projectId);
    await expect(
      costEngine.recordActualCost(job.id, 200, 'tx-2', projectId),
    ).rejects.toThrow(AppError);
  });

});
