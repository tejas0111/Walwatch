import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { projectRoutes } from '../routes/projects.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Project routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/projects', projectRoutes);

    const user = await createTestUser({ email: 'projects-test@test.com' });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Projects Org',
      slug: `projects-org-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: 'owner' });
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

  let createdProjectId: string;

  it('creates a project (201)', async () => {
    const res = await authed('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Project', slug: 'my-project' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('My Project');
    expect(body.slug).toBe('my-project');
    expect(body.orgId).toBe(orgId);
    createdProjectId = body.id;
  });

  it('lists projects (200, includes created)', async () => {
    const res = await authed('/api/projects');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects.length).toBeGreaterThanOrEqual(1);
    expect(body.projects.some((p: { id: string }) => p.id === createdProjectId)).toBe(true);
  });

  it('gets project by id (200)', async () => {
    const res = await authed(`/api/projects/${createdProjectId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdProjectId);
    expect(body.name).toBe('My Project');
  });

  it('updates project (200)', async () => {
    const res = await authed(`/api/projects/${createdProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Project' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Project');
  });

  it('deletes project (200)', async () => {
    const db = getDb();
    const [p] = await db.insert(projects).values({
      orgId,
      name: 'Delete Me',
      slug: `delete-${Date.now()}`,
    }).returning();

    const res = await authed(`/api/projects/${p.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Project deleted');
  });

  it('rejects duplicate slug in same org (500)', async () => {
    const res = await authed('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate', slug: 'my-project' }),
    });
    expect(res.status).toBe(500);
  });

  it('rejects without auth (401)', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth', slug: 'no-auth' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects without X-Org-Id (400)', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'No Org', slug: 'no-org' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-member (403)', async () => {
    const otherUser = await createTestUser({ email: `non-member-${Date.now()}@test.com` });
    const otherToken = generateToken(otherUser.id);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ name: 'Non Member', slug: 'non-member' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer creating (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-create-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ name: 'Viewer Create', slug: 'viewer-create' }),
    });
    expect(res.status).toBe(403);
  });
});
