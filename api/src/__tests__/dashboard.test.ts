import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { dashboardRoutes } from '../routes/dashboard.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import {
  organizations,
  orgMembers,
  projects,
  blobRegistrations,
  renewalJobs,
  budgets,
  alertEvents,
  notifications,
} from '../db/schema.js';

describe('Dashboard API', () => {
  let app: Hono;
  let authToken: string;
  let userId: string;
  let orgId: string;
  beforeAll(async () => {
    await setupTestDb();

    app = new Hono();
    app.route('/api/dashboard', dashboardRoutes);

    // Create test user and org
    const user = await createTestUser({ email: 'dashboard@test.com' });
    userId = user.id;
    authToken = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Dashboard Test Org',
      slug: `dashboard-org-${Date.now()}`,
    }).returning();
    orgId = org.id;

    await db.insert(orgMembers).values({ orgId, userId, role: 'owner' });
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe('GET /api/dashboard/summary — empty org', () => {
    it('returns expected shape with all empty panels', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // ── Basic shape ──────────────────────────────────────────
      expect(data).toHaveProperty('scope');
      expect(data.scope).toEqual({ orgId, projectId: null });

      expect(data).toHaveProperty('dataFreshness');
      expect(data.dataFreshness).toHaveProperty('fetchedAt');
      expect(data.dataFreshness).toHaveProperty('stalenessMs');
      expect(data.dataFreshness).toHaveProperty('cacheLayer');
      expect(typeof data.dataFreshness.fetchedAt).toBe('string');
      expect(data.dataFreshness.cacheLayer).toBe('direct_db');

      expect(data).toHaveProperty('status');
      expect(data.status).toBe('ok');

      // ── Panel shapes (all empty) ─────────────────────────────
      expect(data).toHaveProperty('blobsByHealth');
      expect(data.blobsByHealth).toEqual({ healthy: 0, atRisk: 0, expiring: 0, expired: 0 });

      expect(data).toHaveProperty('storageUnderManagement');
      expect(data.storageUnderManagement).toEqual({ totalBytes: 0, totalBlobs: 0 });

      expect(data).toHaveProperty('recentSpend');
      expect(data.recentSpend).toHaveProperty('totalCost');
      expect(data.recentSpend).toHaveProperty('renewalCount');
      expect(data.recentSpend).toHaveProperty('succeededCount');
      expect(data.recentSpend).toHaveProperty('failedCount');
      expect(data.recentSpend).toHaveProperty('blockedCount');
      expect(data.recentSpend).toHaveProperty('windowDays');
      expect(data.recentSpend).toHaveProperty('windowStart');
      expect(data.recentSpend.totalCost).toBe(0);
      expect(data.recentSpend.renewalCount).toBe(0);

      expect(data).toHaveProperty('budgetComparison');
      expect(Array.isArray(data.budgetComparison)).toBe(true);
      expect(data.budgetComparison.length).toBe(0);

      expect(data).toHaveProperty('nextToExpire');
      expect(Array.isArray(data.nextToExpire)).toBe(true);
      expect(data.nextToExpire.length).toBe(0);

      expect(data).toHaveProperty('needsAttention');
      expect(Array.isArray(data.needsAttention)).toBe(true);
      expect(data.needsAttention.length).toBe(0);

      expect(data).toHaveProperty('attentionSummary');
      expect(data.attentionSummary).toHaveProperty('total');
      expect(data.attentionSummary).toHaveProperty('alertEvents');
      expect(data.attentionSummary).toHaveProperty('failedRenewals');
      expect(data.attentionSummary).toHaveProperty('blockedRenewals');
      expect(data.attentionSummary).toHaveProperty('failedNotifications');

      // ── Empty-state guidance ─────────────────────────────────
      expect(data).toHaveProperty('emptyStateGuidance');
      expect(data.emptyStateGuidance).toHaveProperty('blobsByHealth');
      expect(data.emptyStateGuidance).toHaveProperty('recentSpend');
      expect(data.emptyStateGuidance).toHaveProperty('budgetComparison');
      expect(data.emptyStateGuidance).toHaveProperty('nextToExpire');
      expect(data.emptyStateGuidance).toHaveProperty('needsAttention');

      // Each guidance entry has the required fields
      for (const key of ['blobsByHealth', 'recentSpend', 'budgetComparison', 'nextToExpire', 'needsAttention']) {
        const guidance = data.emptyStateGuidance[key];
        expect(guidance).toHaveProperty('title');
        expect(guidance).toHaveProperty('description');
        expect(guidance).toHaveProperty('action');
        expect(guidance).toHaveProperty('actionLink');
        expect(typeof guidance.title).toBe('string');
        expect(typeof guidance.actionLink).toBe('string');
      }

      // No panel errors
      expect(data).not.toHaveProperty('_panelErrors');
    });
  });

  describe('GET /api/dashboard/summary — with data', () => {
    let blobId: string;
    let blobId2: string;
    let budgetId: string;
    let mainProjectId: string;

    beforeAll(async () => {
      const db = getDb();

      // Create default project for test data
      const [proj] = await db.insert(projects).values({
        orgId,
        name: 'Main Project',
        slug: `main-proj-${Date.now()}`,
      }).returning();
      mainProjectId = proj.id;

      // ── Insert blobs in various health states ────────────
      const [blob1] = await db.insert(blobRegistrations).values({
        orgId,
        projectId: mainProjectId,
        blobId: `blob-healthy-${Date.now()}`,
        name: 'healthy-blob',
        sizeBytes: 1024,
        status: 'tracked',
        expiryEpoch: 1_000_000_000,
      }).returning();
      blobId = blob1.id;

      const [blob2] = await db.insert(blobRegistrations).values({
        orgId,
        projectId: mainProjectId,
        blobId: `blob-expiring-${Date.now()}`,
        name: 'expiring-blob',
        sizeBytes: 2048,
        status: 'expiring',
        expiryEpoch: 100,
      }).returning();
      blobId2 = blob2.id;

      await db.insert(blobRegistrations).values({
        orgId,
        projectId: mainProjectId,
        blobId: `blob-atrisk-${Date.now()}`,
        name: 'renewing-blob',
        sizeBytes: 4096,
        status: 'renewing',
      });

      await db.insert(blobRegistrations).values({
        orgId,
        projectId: mainProjectId,
        blobId: `blob-expired-${Date.now()}`,
        name: 'expired-blob',
        sizeBytes: 512,
        status: 'expired',
      });

      // ── Budget ──────────────────────────────────────────
      const [budget] = await db.insert(budgets).values({
        orgId,
        projectId: mainProjectId,
        name: 'Monthly Budget',
        amount: 1000000,  // $10,000
        period: 'monthly',
        spent: 250000,    // $2,500 spent
        status: 'active',
        alertThreshold: 80,
      }).returning();
      budgetId = budget.id;

      // ── Renewal jobs (failed, blocked, succeeded) ───────
      await db.insert(renewalJobs).values({
        orgId,
        blobRegistrationId: blobId,
        status: 'succeeded',
        estimatedCost: 50000,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      await db.insert(renewalJobs).values({
        orgId,
        blobRegistrationId: blobId,
        status: 'failed_final',
        lastError: 'Insufficient gas for transaction',
        estimatedCost: 30000,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      });

      await db.insert(renewalJobs).values({
        orgId,
        blobRegistrationId: blobId,
        status: 'blocked_by_budget',
        estimatedCost: 20000,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      });

      // ── Alert events ───────────────────────────────────
      const [alertEvt] = await db.insert(alertEvents).values({
        orgId,
        eventType: 'renewal_failed',
        severity: 'error',
        message: 'Renewal failed for blob: insufficient gas',
        status: 'fired',
        firedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }).returning();

      // ── Failed notifications ───────────────────────────
      await db.insert(notifications).values({
        orgId,
        alertEventId: alertEvt.id,
        status: 'failed',
        error: 'SMTP connection refused',
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      });
    });

    it('returns correct blob health breakdown', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();
      expect(res.status).toBe(200);

      // Health breakdown: tracked=healthy(1), expiring=expiring(1),
      //   renewing=atRisk(1), expired=expired(1)
      expect(data.blobsByHealth.healthy).toBe(1);
      expect(data.blobsByHealth.atRisk).toBe(1);
      expect(data.blobsByHealth.expiring).toBe(1);
      expect(data.blobsByHealth.expired).toBe(1);

      // Storage: 1024 + 2048 + 4096 + 512 = 7680
      expect(data.storageUnderManagement.totalBlobs).toBe(4);
      expect(data.storageUnderManagement.totalBytes).toBeGreaterThan(0);
    });

    it('returns correct budget comparison', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();
      expect(data.budgetComparison).toHaveLength(1);
      expect(data.budgetComparison[0]).toMatchObject({
        name: 'Monthly Budget',
        amount: 1000000,
        spent: 250000,
        remaining: 750000,
        period: 'monthly',
      });
      expect(data.budgetComparison[0].crossed).toBe(false); // 25% spent < 80% threshold
    });

    it('returns next-to-expire sorted by expiryEpoch', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();
      expect(data.nextToExpire.length).toBeGreaterThanOrEqual(1);
      // The expiring blob (expiryEpoch=100) should be first
      expect(data.nextToExpire[0].name).toBe('expiring-blob');
      expect(data.nextToExpire[0].expiryEpoch).toBe(100);
    });

    it('returns combined needs-attention from all sources', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();

      // Should have items from all sources: alert_event + failed_renewal + blocked + failed_notification
      expect(data.needsAttention.length).toBeGreaterThanOrEqual(3);

      // Check attentionSummary
      expect(data.attentionSummary.alertEvents).toBeGreaterThanOrEqual(1);  // renewal_failed alert
      expect(data.attentionSummary.failedRenewals).toBeGreaterThanOrEqual(1);  // failed_final
      expect(data.attentionSummary.blockedRenewals).toBeGreaterThanOrEqual(1); // blocked_by_budget
      expect(data.attentionSummary.failedNotifications).toBeGreaterThanOrEqual(1); // failed notification

      // Items should be sorted by firedAt descending (most recent first)
      for (let i = 1; i < data.needsAttention.length; i++) {
        const prev = new Date(data.needsAttention[i - 1].firedAt).getTime();
        const curr = new Date(data.needsAttention[i].firedAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }

      // Each item should have the unified shape
      const item = data.needsAttention[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('source');
      expect(item).toHaveProperty('itemId');
      expect(item).toHaveProperty('itemType');
      expect(item).toHaveProperty('severity');
      expect(item).toHaveProperty('message');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('firedAt');
    });

    it('returns correct recent spend with succeeded/failed/blocked counts', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();
      expect(data.recentSpend.renewalCount).toBe(3);  // 1 succeeded + 1 failed + 1 blocked
      expect(data.recentSpend.succeededCount).toBe(1);
      expect(data.recentSpend.failedCount).toBe(1);
      expect(data.recentSpend.blockedCount).toBe(1);
      expect(data.recentSpend.totalCost).toBeGreaterThan(0);
      expect(data.recentSpend.windowDays).toBe(30);
    });
  });

  describe('GET /api/dashboard/summary — project scoping', () => {
    let otherProjectId: string;

    beforeAll(async () => {
      const db = getDb();
      const [proj] = await db.insert(projects).values({
        orgId,
        name: 'Other Project',
        slug: `other-proj-${Date.now()}`,
      }).returning({ id: projects.id });
      otherProjectId = proj.id;

      // Add a blob in the other project
      await db.insert(blobRegistrations).values({
        orgId,
        projectId: otherProjectId,
        blobId: `other-blob-${Date.now()}`,
        name: 'other-project-blob',
        sizeBytes: 999999,
        status: 'tracked',
      });
    });

    it('filters by projectId when provided', async () => {
      const res = await app.request(`/api/dashboard/summary?projectId=${otherProjectId}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();
      expect(data.scope.projectId).toBe(otherProjectId);
      expect(data.blobsByHealth.healthy).toBe(1);  // only the blob in this project
      expect(data.storageUnderManagement.totalBlobs).toBe(1);
    });

    it('returns all org data without projectId', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': orgId,
        },
      });

      const data = await res.json();
      expect(data.scope.projectId).toBeNull();
      expect(data.blobsByHealth.healthy).toBeGreaterThanOrEqual(2); // blob from main + other project
    });
  });

  describe('GET /api/dashboard/summary — auth failures', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: { 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 without X-Org-Id header', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/dashboard/summary — error isolation', () => {
    it('handles non-existent org gracefully', async () => {
      const res = await app.request('/api/dashboard/summary', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Org-Id': '00000000-0000-0000-0000-000000000000',
        },
      });
      // requireOrg middleware returns 404 for non-existent org
      expect(res.status).toBe(404);
    });
  });
});
