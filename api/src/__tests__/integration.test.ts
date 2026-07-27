import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { apiKeyRoutes } from '../routes/api-keys.js';
import { vaultRoutes } from '../routes/vaults.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers } from '../db/schema.js';
import { createTestUser, generateToken } from './helpers.js';

describe('Integration: Critical Path', () => {
  let app: Hono;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/api-keys', apiKeyRoutes);
    app.route('/api/vaults', vaultRoutes);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  let authToken: string;
  let orgId: string;
  let apiKey: string;

  describe('User Registration', () => {
    it('should register a new user', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'integration@test.com', password: 'Test123!', name: 'Integration User' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.token).toBeTruthy();
      expect(data.user.email).toBe('integration@test.com');
      authToken = data.token;
    });

    it('should reject duplicate registration', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'integration@test.com', password: 'Test123!', name: 'Integration User' }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe('Email already registered');
    });

    it('should reject registration with invalid email', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'notanemail', password: 'Test123!', name: 'Bad Email' }),
      });
      expect(res.status).toBe(400);
    });

    it('should reject registration with short password', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'short@test.com', password: '123', name: 'Short PW' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Authentication', () => {
    it('should login with valid credentials', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'integration@test.com', password: 'Test123!' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeTruthy();
      expect(data.user.email).toBe('integration@test.com');
    });

    it('should reject login with wrong password', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'integration@test.com', password: 'WrongPassword!' }),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it('should reject login with non-existent email', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@test.com', password: 'Test123!' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Organization CRUD', () => {
    it('should create an organization', async () => {
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name: 'Integration Org', slug: 'integration-org' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      orgId = data.id;
      expect(orgId).toBeTruthy();
      expect(data.name).toBe('Integration Org');
    });

    it('should list user organizations', async () => {
      const res = await app.request('/api/orgs', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.organizations.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject org creation without auth', async () => {
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Auth', slug: 'no-auth' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('API Keys', () => {
    it('should create an API key', async () => {
      const res = await app.request('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, 'X-Org-Id': orgId },
        body: JSON.stringify({ name: 'Integration Key' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      apiKey = data.rawKey;
      expect(apiKey).toBeTruthy();
      expect(apiKey.startsWith('wak_')).toBe(true);
    });

    it('should list API keys', async () => {
      const res = await app.request('/api/api-keys', {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.apiKeys.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Vault Endpoints', () => {
    it('should list vaults (empty) for a wallet address', async () => {
      const res = await app.request('/api/vaults/0xtestwallet');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('vaults');
      expect(Array.isArray(data.vaults)).toBe(true);
    });

    it('should get vault history (empty)', async () => {
      const res = await app.request('/api/vaults/0xnonexistent/history');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('history');
      expect(data).toHaveProperty('page');
      expect(data).toHaveProperty('limit');
      expect(Array.isArray(data.history)).toBe(true);
    });
  });

  describe('Protected Route Access', () => {
    it('should reject unauthenticated access to org routes', async () => {
      const res = await app.request('/api/orgs');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated access to api-key routes', async () => {
      const res = await app.request('/api/api-keys');
      expect(res.status).toBe(401);
    });

    it('should reject invalid auth token', async () => {
      const res = await app.request('/api/orgs', {
        headers: { Authorization: 'Bearer invalidtoken123' },
      });
      expect(res.status).toBe(401);
    });
  });
});
