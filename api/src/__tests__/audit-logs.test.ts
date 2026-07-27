import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { auditLogRoutes } from '../routes/audit-logs.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { blobRoutes } from '../routes/blobs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, projects, auditLogs } from '../db/schema.js';

describe('Audit Log routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/blobs', blobRoutes);
    app.route('/api/audit-logs', auditLogRoutes);

    const user = await createTestUser({ email: `audit-test-${Date.now()}@test.com` });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Audit Org',
      slug: `audit-org-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: 'owner' });

    const [project] = await db.insert(projects).values({
      orgId, name: 'Audit Project', slug: `audit-project-${Date.now()}`,
    }).returning();

    // Create blobs via API to generate audit logs
    for (let i = 0; i < 3; i++) {
      await app.request('/api/blobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Org-Id': orgId,
        },
        body: JSON.stringify({
          projectId: project.id,
          blobId: `audit-blob-${i}`,
          name: `Audit Blob ${i}`,
          sizeBytes: 100,
        }),
      });
    }

    // Insert a direct audit log with a distinct action for filtering
    await db.insert(auditLogs).values({
      orgId,
      userId,
      action: 'policy.created',
      resourceType: 'policy',
      resourceId: 'test-policy-id',
    });
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

  it('lists audit logs for the org (200)', async () => {
    const res = await authed('/api/audit-logs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs.length).toBeGreaterThanOrEqual(4);
    expect(body.total).toBeGreaterThanOrEqual(4);
  });

  it('filters logs by action (200)', async () => {
    const res = await authed('/api/audit-logs?action=policy.created');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs.length).toBe(1);
    expect(body.logs[0].action).toBe('policy.created');
  });

  it('rejects non-member (403)', async () => {
    const otherUser = await createTestUser({ email: `non-member-audit-${Date.now()}@test.com` });
    const otherToken = generateToken(otherUser.id);
    const res = await app.request('/api/audit-logs', {
      headers: {
        Authorization: `Bearer ${otherToken}`,
        'X-Org-Id': orgId,
      },
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-audit-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/audit-logs', {
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
    });
    expect(res.status).toBe(403);
  });
});
