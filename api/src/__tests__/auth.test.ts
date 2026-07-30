import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../routes/auth.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { generateToken, createTestUser } from './helpers.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

describe('Auth routes', () => {
  let app: Hono;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe('POST /api/auth/register', () => {
    it('registers a new user', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@test.com', password: 'password123', name: 'New' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.user.email).toBe('new@test.com');
      expect(body.token).toBeTruthy();
    });

    it('rejects duplicate email', async () => {
      await createTestUser({ email: 'dup@test.com' });
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dup@test.com', password: 'password123' }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects invalid email', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'notanemail', password: 'password123' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects short password', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', password: '123' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials', async () => {
      await createTestUser({ email: 'login@test.com' });
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@test.com', password: 'password123' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTruthy();
    });

    it('rejects wrong password', async () => {
      await createTestUser({ email: 'wrongpw@test.com' });
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'wrongpw@test.com', password: 'wrongpassword' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects non-existent email', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@test.com', password: 'password123' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user with valid JWT', async () => {
      const user = await createTestUser({ email: 'me@test.com' });
      const token = generateToken(user.id);
      const res = await app.request('/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe('me@test.com');
    });

    it('rejects missing token', async () => {
      const res = await app.request('/api/auth/me', { method: 'GET' });
      expect(res.status).toBe(401);
    });

    it('rejects expired token', async () => {
      const user = await createTestUser({ email: 'expired@test.com' });
      const expiredToken = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '0s' });
      const res = await app.request('/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('rejects without token', async () => {
      const res = await app.request('/api/auth/logout', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('logs out with valid token', async () => {
      const user = await createTestUser({ email: 'logout@test.com' });
      const token = generateToken(user.id);
      const res = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Logged out');
    });
  });
});
