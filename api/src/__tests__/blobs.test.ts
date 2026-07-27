import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { blobRoutes } from '../routes/blobs.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { projectRoutes } from '../routes/projects.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, projects, blobRegistrations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Blob registration routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/projects', projectRoutes);
    app.route('/api/blobs', blobRoutes);

    const user = await createTestUser({ email: 'blobs-test@test.com' });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Blobs Org',
      slug: `blobs-org-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: 'owner' });

    const [project] = await db.insert(projects).values({
      orgId,
      name: 'Blobs Project',
      slug: `blobs-project-${Date.now()}`,
    }).returning();
    projectId = project.id;
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

  let createdBlobId: string;

  it('registers a blob (201)', async () => {
    const res = await authed('/api/blobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        blobId: 'blob-001',
        name: 'My Blob',
        sizeBytes: 1024,
        contentType: 'text/plain',
        tags: ['important', 'backup'],
        metadata: { source: 'test' },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.blobId).toBe('blob-001');
    expect(body.name).toBe('My Blob');
    expect(body.orgId).toBe(orgId);
    expect(body.projectId).toBe(projectId);
    expect(body.tags).toEqual(['important', 'backup']);
    createdBlobId = body.id;
  });

  it('lists blobs (200)', async () => {
    const res = await authed('/api/blobs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blobs.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.blobs.some((b: { id: string }) => b.id === createdBlobId)).toBe(true);
  });

  it('gets blob by id (200)', async () => {
    const res = await authed(`/api/blobs/${createdBlobId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdBlobId);
    expect(body.name).toBe('My Blob');
  });

  it('updates blob name/tags (200)', async () => {
    const res = await authed(`/api/blobs/${createdBlobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Blob', tags: ['archived'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Blob');
    expect(body.tags).toEqual(['archived']);
  });

  it('deletes blob (200)', async () => {
    const db = getDb();
    const [blob] = await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: `delete-me-${Date.now()}`,
      name: 'Delete Me',
    }).returning();

    const res = await authed(`/api/blobs/${blob.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Blob registration deleted');
  });

  it('searches blobs by name (200, filtered)', async () => {
    const db = getDb();
    await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: 'match-001',
      name: 'SearchTarget',
    });

    const res = await authed('/api/blobs?search=SearchTarget');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blobs.length).toBeGreaterThanOrEqual(1);
    expect(body.blobs.every((b: { name: string }) => b.name === 'SearchTarget')).toBe(true);
  });

  it('filters by status (200)', async () => {
    const db = getDb();
    await db.insert(blobRegistrations).values({
      orgId,
      projectId,
      blobId: 'archived-001',
      name: 'Archived Blob',
      status: 'archived',
    });

    const res = await authed('/api/blobs?status=archived');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blobs.length).toBeGreaterThanOrEqual(1);
    expect(body.blobs.every((b: { status: string }) => b.status === 'archived')).toBe(true);
  });

  it('rejects without auth (401)', async () => {
    const res = await app.request('/api/blobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, blobId: 'no-auth' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-member (403)', async () => {
    const otherUser = await createTestUser({ email: `non-member-blob-${Date.now()}@test.com` });
    const otherToken = generateToken(otherUser.id);
    const res = await app.request('/api/blobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ projectId, blobId: 'non-member' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer creating (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-blob-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/blobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ projectId, blobId: 'viewer-create' }),
    });
    expect(res.status).toBe(403);
  });

  it('exports blobs (200)', async () => {
    const res = await authed('/api/blobs/export');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blobs).toBeDefined();
    expect(Array.isArray(body.blobs)).toBe(true);
  });
});
