import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { apiKeyRoutes } from '../routes/api-keys.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { orgMembers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('API Key routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;
  let rawKey: string;
  let keyId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/api-keys', apiKeyRoutes);

    const user = await createTestUser({ email: 'apikeys-test@test.com' });
    userId = user.id;
    token = generateToken(user.id);

    const res = await app.request('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'API Key Org', slug: 'api-key-org' }),
    });
    const org = await res.json();
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  function authed(path: string, init?: RequestInit) {
    return app.request(path, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'X-Org-Id': orgId },
    });
  }

  describe('POST /api/api-keys', () => {
    it('creates a key and returns raw key (201)', async () => {
      const res = await authed('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Key' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.rawKey).toBeTruthy();
      expect(body.rawKey).toMatch(/^wak_/);
      expect(body.keyPrefix).toBe(body.rawKey.slice(0, 12));
      expect(body.name).toBe('Test Key');
      rawKey = body.rawKey;
      keyId = body.id;
    });

    it('viewer cannot create a key (403)', async () => {
      const viewerUser = await createTestUser({ email: `viewer-key-${Date.now()}@test.com` });
      const viewerToken = generateToken(viewerUser.id);
      const db = getDb();
      await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });

      const res = await app.request('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${viewerToken}`, 'X-Org-Id': orgId },
        body: JSON.stringify({ name: 'Viewer Key' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/api-keys', () => {
    it('lists keys showing prefix not full key (200)', async () => {
      const res = await authed('/api/api-keys');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.apiKeys.length).toBeGreaterThanOrEqual(1);
      for (const key of body.apiKeys) {
        expect(key.keyPrefix).toBeTruthy();
        expect(key.keyPrefix).toMatch(/^wak_/);
        expect(key.rawKey).toBeUndefined();
      }
    });
  });

  describe('DELETE /api/api-keys/:id', () => {
    it('revokes a key (200)', async () => {
      const res = await authed(`/api/api-keys/${keyId}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('API key revoked');
    });
  });

  describe('API key authentication', () => {
    let secondKey: string;

    beforeAll(async () => {
      const res = await authed('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Auth Test Key' }),
      });
      const body = await res.json();
      secondKey = body.rawKey;
    });

    it('authenticates with valid API key (200)', async () => {
      const res = await app.request('/api/api-keys', {
        headers: { 'X-API-Key': secondKey, 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(200);
    });

    it('rejects wrong API key (401)', async () => {
      const res = await app.request('/api/api-keys', {
        headers: { 'X-API-Key': 'wak_wrongkey1234567890abcdef', 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(401);
    });

    it('rejects without auth (401)', async () => {
      const res = await app.request('/api/api-keys', {
        headers: { 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Cross-org API key rejection', () => {
    it('rejects non-member via API key (403)', async () => {
      const otherUser = await createTestUser({ email: `other-org-key-${Date.now()}@test.com` });
      const otherToken = generateToken(otherUser.id);

      const orgRes = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` },
        body: JSON.stringify({ name: 'Other Org', slug: `other-org-${Date.now()}` }),
      });
      const otherOrg = await orgRes.json();

      const keyRes = await app.request('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}`, 'X-Org-Id': otherOrg.id },
        body: JSON.stringify({ name: 'Other Key' }),
      });
      const keyBody = await keyRes.json();

      const res = await app.request('/api/api-keys', {
        headers: { 'X-API-Key': keyBody.rawKey, 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(403);
    });
  });
});
