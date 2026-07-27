import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { vaultRoutes } from '../routes/vaults.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers } from '../db/schema.js';

describe('Response Shape Validation', () => {
  let app: Hono;
  let authToken: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/vaults', vaultRoutes);

    const user = await createTestUser({ email: 'shapes@test.com' });
    userId = user.id;
    authToken = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Shape Test Org',
      slug: `shape-org-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId, userId, role: 'owner' });
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe('Health endpoint', () => {
    it('returns expected shape', async () => {
      const appWithHealth = new Hono();
      appWithHealth.get('/health', async (c) => {
        let dbStatus = 'connected';
        try {
          const db = getDb();
          await db.execute('SELECT 1');
        } catch {
          dbStatus = 'error';
        }
        return c.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: '0.1.0',
          db: dbStatus,
        });
      });
      const res = await appWithHealth.request('/health');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('db');
      expect(typeof data.status).toBe('string');
      expect(typeof data.timestamp).toBe('string');
      expect(typeof data.uptime).toBe('number');
      expect(typeof data.db).toBe('string');
    });
  });

  describe('POST /api/auth/register', () => {
    it('returns expected shape on success', async () => {
      const email = `reg-shape-${Date.now()}@test.com`;
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Shape' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('user');
      expect(data.user).toHaveProperty('id');
      expect(data.user).toHaveProperty('email');
      expect(data.user.email).toBe(email);
      expect(typeof data.token).toBe('string');
    });

    it('returns error shape on duplicate', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'shapes@test.com', password: 'password123' }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns expected shape on success', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'shapes@test.com', password: 'password123' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('user');
      expect(data.user).toHaveProperty('id');
      expect(data.user).toHaveProperty('email');
      expect(typeof data.token).toBe('string');
    });

    it('returns error shape on failure', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'shapes@test.com', password: 'wrong' }),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('GET /api/orgs', () => {
    it('returns expected list shape', async () => {
      const res = await app.request('/api/orgs', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('organizations');
      expect(Array.isArray(data.organizations)).toBe(true);
      if (data.organizations.length > 0) {
        const org = data.organizations[0];
        expect(org).toHaveProperty('id');
        expect(org).toHaveProperty('name');
        expect(org).toHaveProperty('slug');
        expect(org).toHaveProperty('role');
        expect(typeof org.id).toBe('string');
        expect(typeof org.name).toBe('string');
        expect(typeof org.slug).toBe('string');
      }
    });
  });

  describe('POST /api/orgs', () => {
    it('returns expected creation shape', async () => {
      const slug = `create-shape-${Date.now()}`;
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name: 'Create Shape', slug }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('slug');
      expect(data).toHaveProperty('createdAt');
      expect(typeof data.id).toBe('string');
      expect(typeof data.name).toBe('string');
      expect(data.name).toBe('Create Shape');
      expect(data.slug).toBe(slug);
    });
  });

  describe('GET /api/vaults/:walletAddress', () => {
    it('returns expected vault list shape', async () => {
      const res = await app.request('/api/vaults/0xtestwallet');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('vaults');
      expect(Array.isArray(data.vaults)).toBe(true);
    });
  });

  describe('Error shapes', () => {
    it('returns error string on 401', async () => {
      const res = await app.request('/api/orgs');
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    });

    it('returns error string on validation failure', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bad', password: '123' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });
  });
});
