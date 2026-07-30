import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { analyticsRoutes } from '../routes/analytics.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, projects, blobRegistrations, policies, wallets, auditLogs } from '../db/schema.js';

describe('Analytics routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/analytics', analyticsRoutes);

    const user = await createTestUser({ email: `analytics-test-${Date.now()}@test.com` });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Analytics Org',
      slug: `analytics-org-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: 'owner' });

    const [project] = await db.insert(projects).values({
      orgId, name: 'Test Project', slug: `test-project-${Date.now()}`,
    }).returning();

    await db.insert(blobRegistrations).values([
      { orgId, projectId: project.id, blobId: 'blob-1', name: 'Blob 1', sizeBytes: 1000, status: 'active' },
      { orgId, projectId: project.id, blobId: 'blob-2', name: 'Blob 2', sizeBytes: 2000, status: 'active' },
      { orgId, projectId: project.id, blobId: 'blob-3', name: 'Blob 3', sizeBytes: 500, status: 'archived' },
    ]);

    await db.insert(policies).values([
      { orgId, name: 'Policy 1', renewThreshold: 100, renewExtension: 1000, rules: [] },
    ]);

    await db.insert(wallets).values([
      { orgId, address: '0xwallet1', label: 'Wallet 1' },
      { orgId, address: '0xwallet2', label: 'Wallet 2' },
    ]);

    await db.insert(auditLogs).values([
      { orgId, userId, action: 'blob.renewal', resourceType: 'blob_registration', resourceId: 'id-1' },
      { orgId, userId, action: 'blob.renewal', resourceType: 'blob_registration', resourceId: 'id-2' },
      { orgId, userId, action: 'blob.created', resourceType: 'blob_registration', resourceId: 'id-3' },
    ]);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  function authed(path: string) {
    return app.request(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Org-Id': orgId,
      },
    });
  }

  it('returns overview stats (200)', async () => {
    const res = await authed('/api/analytics/overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalBlobs).toBe(3);
    expect(body.activeBlobs).toBe(2);
    expect(body.totalProjects).toBe(1);
    expect(body.totalPolicies).toBe(1);
    expect(body.totalWallets).toBe(2);
  });

  it('returns storage stats (200)', async () => {
    const res = await authed('/api/analytics/storage');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalSizeBytes).toBe(3500);
    expect(body.blobCount).toBe(3);
    expect(body.byStatus.length).toBe(2);
  });

  it('returns renewal stats (200)', async () => {
    const res = await authed('/api/analytics/renewals');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRenewals).toBe(2);
  });

  it('returns costs stub (200)', async () => {
    const res = await authed('/api/analytics/costs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Coming soon');
    expect(body.data).toEqual([]);
  });

  it('returns forecasts stub (200)', async () => {
    const res = await authed('/api/analytics/forecasts');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Coming soon');
    expect(body.data).toEqual([]);
  });
});
