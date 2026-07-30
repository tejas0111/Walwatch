import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './setup.js';
import { getDb } from '../db/index.js';
import {
  organizations,
  projects,
  wallets,
  blobRegistrations,
  renewalJobs,
} from '../db/schema.js';
import { invariantChecker } from '../lib/invariant-check.js';
import { AppError } from '../lib/errors.js';

describe('Invariant Checker', () => {
  let orgId: string;
  let projectId: string;
  let otherProjectId: string;
  let blobId: string;

  beforeAll(async () => {
    await setupTestDb();
    const db = getDb();

    const [org] = await db.insert(organizations).values({
      name: 'Invariant Test Org',
      slug: `invariant-${Date.now()}`,
    }).returning();
    orgId = org.id;

    const [project] = await db.insert(projects).values({
      orgId,
      name: 'Invariant Test Project',
      slug: `invariant-proj-${Date.now()}`,
    }).returning();
    projectId = project.id;

    const [otherProject] = await db.insert(projects).values({
      orgId,
      name: 'Other Project',
      slug: `other-proj-${Date.now()}`,
    }).returning();
    otherProjectId = otherProject.id;

    const [blob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: `invariant-blob-${Date.now()}`,
    }).returning();
    blobId = blob.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe('ensureUniqueWalletAddress', () => {
    it('rejects duplicate wallet address in same project', async () => {
      const db = getDb();
      const address = `0xdup${Date.now()}`;

      await db.insert(wallets).values({
        orgId,
        projectId,
        address,
        status: 'active',
      });

      await expect(
        invariantChecker.ensureUniqueWalletAddress(orgId, projectId, address),
      ).rejects.toThrow(AppError);
    });

    it('allows same address in different project', async () => {
      const address = `0xdiffproj${Date.now()}`;

      await getDb().insert(wallets).values({
        orgId,
        projectId,
        address,
        status: 'active',
      });

      await expect(
        invariantChecker.ensureUniqueWalletAddress(orgId, otherProjectId, address),
      ).resolves.toBeUndefined();
    });

    it('allows same address in same org without project (null projectId)', async () => {
      const address = `0xnullproj${Date.now()}`;

      await expect(
        invariantChecker.ensureUniqueWalletAddress(orgId, null, address),
      ).resolves.toBeUndefined();
    });

    it('rejects duplicate when first wallet has no project', async () => {
      const db = getDb();
      const address = `0xdupnoproj${Date.now()}`;

      await db.insert(wallets).values({
        orgId,
        projectId: null as any,
        address,
        status: 'active',
      });

      await expect(
        invariantChecker.ensureUniqueWalletAddress(orgId, null, address),
      ).rejects.toThrow(AppError);
    });
  });

  describe('ensureNoActiveRenewal', () => {
    it('rejects second in_progress renewal for same blob', async () => {
      const db = getDb();

      await db.insert(renewalJobs).values({
        orgId,
        blobRegistrationId: blobId,
        status: 'in_progress',
      });

      await expect(
        invariantChecker.ensureNoActiveRenewal(blobId),
      ).rejects.toThrow(AppError);
    });

    it('allows renewal when no in_progress exists', async () => {
      const db = getDb();
      const [otherBlob] = await db.insert(blobRegistrations).values({
        orgId,
        projectId,
        blobId: `no-active-renewal-${Date.now()}`,
      }).returning();

      await db.insert(renewalJobs).values({
        orgId,
        blobRegistrationId: otherBlob.id,
        status: 'pending',
      });

      await expect(
        invariantChecker.ensureNoActiveRenewal(otherBlob.id),
      ).resolves.toBeUndefined();
    });
  });

  describe('verifyOrgChain', () => {
    it('returns orgId when present', () => {
      const result = invariantChecker.verifyOrgChain({ orgId: 'org-123', projectId: 'proj-456' });
      expect(result).toBe('org-123');
    });

    it('throws when orgId is missing', () => {
      expect(() => invariantChecker.verifyOrgChain({ projectId: 'proj-456' })).toThrow(AppError);
    });

    it('throws when entity is empty', () => {
      expect(() => invariantChecker.verifyOrgChain({})).toThrow(AppError);
    });
  });
});
