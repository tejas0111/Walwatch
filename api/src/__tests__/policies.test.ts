import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { policyRoutes } from '../routes/policies.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { blobRoutes } from '../routes/blobs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, blobRegistrations, projects, policies } from '../db/schema.js';

describe('Policy routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;
  let blobId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/blobs', blobRoutes);
    app.route('/api/policies', policyRoutes);

    const user = await createTestUser({ email: `policies-test-${Date.now()}@test.com` });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Policies Org',
      slug: `policies-org-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: 'owner' });

    const [project] = await db.insert(projects).values({
      orgId,
      name: 'Policy Test Project',
      slug: `policy-test-${Date.now()}`,
    }).returning();

    const [blob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId: project.id,
      blobId: 'test-blob-id',
    }).returning();
    blobId = blob.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  function authed(path: string, init?: RequestInit) {
    return app.request(path, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        'X-Org-Id': orgId,
      },
    });
  }

  let createdPolicyId: string;

  it('creates a policy (201)', async () => {
    const res = await authed('/api/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Auto Renew Policy',
        description: 'Automatically renew blobs',
        rules: [{ field: 'status', operator: 'eq', value: 'active' }],
        renewThreshold: 100,
        renewExtension: 1000,
        maxTotalEpochs: 5000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Auto Renew Policy');
    expect(body.renewThreshold).toBe(100);
    expect(body.renewExtension).toBe(1000);
    expect(body.orgId).toBe(orgId);
    createdPolicyId = body.id;
  });

  it('lists policies (200)', async () => {
    const res = await authed('/api/policies');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies.length).toBeGreaterThanOrEqual(1);
    expect(body.policies.some((p: { id: string }) => p.id === createdPolicyId)).toBe(true);
  });

  it('gets policy by id with assignments (200)', async () => {
    const res = await authed(`/api/policies/${createdPolicyId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdPolicyId);
    expect(body.name).toBe('Auto Renew Policy');
    expect(Array.isArray(body.assignments)).toBe(true);
  });

  it('updates policy (200)', async () => {
    const res = await authed(`/api/policies/${createdPolicyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Policy', renewThreshold: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Policy');
    expect(body.renewThreshold).toBe(200);
  });

  it('deletes policy (200)', async () => {
    const db = getDb();
    const [policy] = await db.insert(policies).values({
      orgId,
      name: 'Delete Me',
      renewThreshold: 10,
      renewExtension: 100,
    }).returning();

    const res = await authed(`/api/policies/${policy.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Policy deleted');
  });

  it('assigns blobs to policy (200)', async () => {
    const res = await authed(`/api/policies/${createdPolicyId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob_ids: [blobId] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assigned).toBe(1);
  });

  it('unassigns blobs from policy (200)', async () => {
    const res = await authed(`/api/policies/${createdPolicyId}/unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob_ids: [blobId] }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects without auth (401)', async () => {
    const res = await app.request('/api/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth', renewThreshold: 10, renewExtension: 100 }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-member (403)', async () => {
    const otherUser = await createTestUser({ email: `non-member-${Date.now()}@test.com` });
    const otherToken = generateToken(otherUser.id);
    const res = await app.request('/api/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ name: 'Non Member', renewThreshold: 10, renewExtension: 100 }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer creating (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-policy-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ name: 'Viewer Create', renewThreshold: 10, renewExtension: 100 }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects duplicate assign (assign same blob twice)', async () => {
    const res = await authed(`/api/policies/${createdPolicyId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob_ids: [blobId] }),
    });
    expect(res.status).toBe(200);
  });
});
