import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { orgRoutes } from '../routes/orgs.js';
import { authRoutes } from '../routes/auth.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, auditLogs } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('Org routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    const user = await createTestUser({ email: 'orgs-test@test.com' });
    userId = user.id;
    token = generateToken(user.id);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  function authed(path: string, init?: RequestInit) {
    return app.request(path, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }

  describe('POST /api/orgs', () => {
    it('creates an org and sets creator as owner', async () => {
      const res = await authed('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Org', slug: 'test-org' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('Test Org');
      expect(body.slug).toBe('test-org');
    });

    it('rejects duplicate slug', async () => {
      const res = await authed('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Another', slug: 'test-org' }),
      });
      expect(res.status).toBe(500);
    });

    it('rejects without auth', async () => {
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Auth', slug: 'no-auth' }),
      });
      expect(res.status).toBe(401);
    });

    it('writes audit log on org creation', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).where(eq(organizations.slug, 'test-org')).limit(1);
      const logs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'org.created'), eq(auditLogs.orgId, org.id)));
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].userId).toBe(userId);
    });
  });

  describe('GET /api/orgs', () => {
    it('lists user orgs', async () => {
      const res = await authed('/api/orgs');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.organizations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/orgs/:id', () => {
    it('returns org details', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await authed(`/api/orgs/${org.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBeTruthy();
    });

    it('rejects non-member', async () => {
      const otherUser = await createTestUser({ email: 'other-org@test.com' });
      const otherToken = generateToken(otherUser.id);
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await app.request(`/api/orgs/${org.id}`, {
        headers: { Authorization: `Bearer ${otherToken}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/orgs/:id', () => {
    it('updates org name as owner', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await authed(`/api/orgs/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Org' }),
      });
      expect(res.status).toBe(200);
    });

    it('writes audit log on org update', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const logs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'org.updated'), eq(auditLogs.orgId, org.id)));
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].details).toBeTruthy();
    });
  });

  describe('DELETE /api/orgs/:id (soft-delete)', () => {
    it('soft-deletes org as owner', async () => {
      const res = await authed('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Soft Delete Me', slug: `soft-del-${Date.now()}` }),
      });
      const org = await res.json();
      const delRes = await authed(`/api/orgs/${org.id}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const db = getDb();
      const [dbOrg] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
      expect(dbOrg.status).toBe('deleted');
      expect(dbOrg.deletedAt).toBeTruthy();
    });

    it('soft-deleted org preserves memberships', async () => {
      const res = await authed('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Membership Check', slug: `membership-${Date.now()}` }),
      });
      const org = await res.json();
      const db = getDb();
      await authed(`/api/orgs/${org.id}`, { method: 'DELETE' });
      const members = await db.select().from(orgMembers)
        .where(eq(orgMembers.orgId, org.id)).limit(1);
      expect(members.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects access to soft-deleted org', async () => {
      const res = await authed('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Access Check', slug: `access-${Date.now()}` }),
      });
      const org = await res.json();
      await authed(`/api/orgs/${org.id}`, { method: 'DELETE' });
      const getRes = await authed(`/api/orgs/${org.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('POST /api/orgs/:id/restore', () => {
    it('restores a soft-deleted org', async () => {
      const res = await authed('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Restore Me', slug: `restore-${Date.now()}` }),
      });
      const org = await res.json();
      await authed(`/api/orgs/${org.id}`, { method: 'DELETE' });
      const restoreRes = await authed(`/api/orgs/${org.id}/restore`, { method: 'POST' });
      expect(restoreRes.status).toBe(200);
      const db = getDb();
      const [dbOrg] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
      expect(dbOrg.status).toBe('active');
      expect(dbOrg.deletedAt).toBeNull();
    });

    it('rejects restore of non-deleted org', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).where(eq(organizations.status, 'active')).limit(1);
      const res = await authed(`/api/orgs/${org.id}/restore`, { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/orgs/:id/suspend and unsuspend', () => {
    it('suspends and unsuspends an org', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).where(eq(organizations.status, 'active')).limit(1);
      const suspendRes = await authed(`/api/orgs/${org.id}/suspend`, { method: 'POST' });
      expect(suspendRes.status).toBe(200);
      const [suspendedOrg] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
      expect(suspendedOrg.status).toBe('suspended');
      expect(suspendedOrg.suspendedAt).toBeTruthy();

      const unsuspendRes = await authed(`/api/orgs/${org.id}/unsuspend`, { method: 'POST' });
      expect(unsuspendRes.status).toBe(200);
      const [activeOrg] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
      expect(activeOrg.status).toBe('active');
      expect(activeOrg.suspendedAt).toBeNull();
    });

    it('rejects access to suspended org', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).where(eq(organizations.status, 'active')).limit(1);
      await authed(`/api/orgs/${org.id}/suspend`, { method: 'POST' });
      const getRes = await authed(`/api/orgs/${org.id}`);
      expect(getRes.status).toBe(403);
      const body = await getRes.json();
      expect(body.error).toMatch(/suspended/i);
      await authed(`/api/orgs/${org.id}/unsuspend`, { method: 'POST' });
    });

    it('rejects unsuspend of non-suspended org', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).where(eq(organizations.status, 'active')).limit(1);
      const res = await authed(`/api/orgs/${org.id}/unsuspend`, { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('Member management', () => {
    it('adds a member by email', async () => {
      const newUser = await createTestUser({ email: `invite-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await authed(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUser.email, role: 'member' }),
      });
      expect(res.status).toBe(201);
    });

    it('lists members', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await authed(`/api/orgs/${org.id}/members`, {
        headers: {},
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects duplicate member', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await authed(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'orgs-test@test.com', role: 'member' }),
      });
      expect(res.status).toBe(409);
    });

    it('writes audit log on member invited', async () => {
      const newUser = await createTestUser({ email: `audit-invite-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      await authed(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUser.email, role: 'member' }),
      });
      const logs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'member.invited'), eq(auditLogs.orgId, org.id)));
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Role enforcement', () => {
    it('member cannot delete org', async () => {
      const memberUser = await createTestUser({ email: `member-role-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      await db.insert(orgMembers).values({ orgId: org.id, userId: memberUser.id, role: 'member' });
      const memberToken = generateToken(memberUser.id);
      const res = await app.request(`/api/orgs/${org.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('viewer cannot delete org', async () => {
      const viewerUser = await createTestUser({ email: `viewer-del-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      await db.insert(orgMembers).values({ orgId: org.id, userId: viewerUser.id, role: 'viewer' });
      const viewerToken = generateToken(viewerUser.id);
      const res = await app.request(`/api/orgs/${org.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('viewer cannot invite members', async () => {
      const viewerUser = await createTestUser({ email: `viewer-invite-${Date.now()}@test.com` });
      const targetUser = await createTestUser({ email: `target-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      await db.insert(orgMembers).values({ orgId: org.id, userId: viewerUser.id, role: 'viewer' });
      const viewerToken = generateToken(viewerUser.id);
      const res = await app.request(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${viewerToken}` },
        body: JSON.stringify({ email: targetUser.email, role: 'member' }),
      });
      expect(res.status).toBe(403);
    });

    it('viewer cannot update member roles', async () => {
      const viewerUser = await createTestUser({ email: `viewer-patch-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const [ownerMember] = await db.select().from(orgMembers)
        .where(eq(orgMembers.orgId, org.id)).limit(1);
      await db.insert(orgMembers).values({ orgId: org.id, userId: viewerUser.id, role: 'viewer' });
      const viewerToken = generateToken(viewerUser.id);
      const res = await app.request(`/api/orgs/${org.id}/members/${ownerMember.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${viewerToken}` },
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Last-owner protection', () => {
    it('cannot demote the last owner', async () => {
      const singleOwnerUser = await createTestUser({ email: `single-owner-${Date.now()}@test.com` });
      const ownerToken = generateToken(singleOwnerUser.id);
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'Single Owner', slug: `single-owner-${Date.now()}` }),
      });
      const org = await res.json();

      const patchRes = await app.request(`/api/orgs/${org.id}/members/${singleOwnerUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(patchRes.status).toBe(400);
      const body = await patchRes.json();
      expect(body.error).toMatch(/last owner/i);
    });

    it('cannot remove the last owner', async () => {
      const singleOwnerUser = await createTestUser({ email: `single-owner-2-${Date.now()}@test.com` });
      const ownerToken = generateToken(singleOwnerUser.id);
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'Single Owner 2', slug: `single-owner-2-${Date.now()}` }),
      });
      const org = await res.json();

      const delRes = await app.request(`/api/orgs/${org.id}/members/${singleOwnerUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      expect(delRes.status).toBe(400);
      const body = await delRes.json();
      expect(body.error).toMatch(/last owner/i);
    });
  });

  describe('Admin role restrictions', () => {
    it('admin cannot promote a member to owner', async () => {
      const adminUser = await createTestUser({ email: `admin-role-${Date.now()}@test.com` });
      const targetUser = await createTestUser({ email: `promote-target-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      await db.insert(orgMembers).values({ orgId: org.id, userId: adminUser.id, role: 'admin' });
      await db.insert(orgMembers).values({ orgId: org.id, userId: targetUser.id, role: 'member' });
      const adminToken = generateToken(adminUser.id);
      const res = await app.request(`/api/orgs/${org.id}/members/${targetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ role: 'owner' }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/only owners/i);
    });
  });

  describe('GET /api/orgs/:id/audit-logs', () => {
    it('returns audit logs for the org', async () => {
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      const res = await authed(`/api/orgs/${org.id}/audit-logs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.auditLogs).toBeDefined();
      expect(Array.isArray(body.auditLogs)).toBe(true);
    });

    it('rejects member from viewing audit logs', async () => {
      const memberUser = await createTestUser({ email: `member-audit-${Date.now()}@test.com` });
      const db = getDb();
      const [org] = await db.select().from(organizations).limit(1);
      await db.insert(orgMembers).values({ orgId: org.id, userId: memberUser.id, role: 'member' });
      const memberToken = generateToken(memberUser.id);
      const res = await app.request(`/api/orgs/${org.id}/audit-logs`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      expect(res.status).toBe(403);
    });
  });
});
