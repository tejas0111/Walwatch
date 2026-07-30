import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { billingRoutes } from '../routes/billing.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { subscriptions, invoices, usageRecords, organizations, orgMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('Billing routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/billing', billingRoutes);

    const user = await createTestUser({ email: 'billing-test@test.com' });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Billing Test Org',
      slug: `billing-test-${Date.now()}`,
    }).returning();
    orgId = org.id;
    await db.insert(orgMembers).values({ orgId, userId, role: 'owner' });
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

  describe('GET /api/billing/subscription', () => {
    it('returns current subscription (auto-creates free plan)', async () => {
      const res = await authed('/api/billing/subscription');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.orgId).toBe(orgId);
      expect(body.plan).toBe('free');
      expect(body.status).toBe('active');
    });
  });

  describe('POST /api/billing/subscription', () => {
    it('changes plan to pro', async () => {
      const res = await authed('/api/billing/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Org-Id': orgId },
        body: JSON.stringify({ plan: 'pro' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plan).toBe('pro');
      expect(body.currentPeriodEnd).toBeTruthy();
    });

    it('rejects invalid plan', async () => {
      const res = await authed('/api/billing/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Org-Id': orgId },
        body: JSON.stringify({ plan: 'invalid' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/billing/invoices', () => {
    it('lists invoices', async () => {
      const db = getDb();
      const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
      await db.insert(invoices).values({ orgId, subscriptionId: sub.id, amount: 1000 });

      const res = await authed('/api/billing/invoices');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invoices.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/billing/usage', () => {
    it('returns current usage metrics', async () => {
      const db = getDb();
      await db.insert(usageRecords).values({ orgId, metric: 'api_calls', value: 42 });

      const res = await authed('/api/billing/usage');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.usage)).toBe(true);
    });
  });

  describe('Auth and role enforcement', () => {
    it('rejects without auth', async () => {
      const res = await app.request('/api/billing/subscription');
      expect(res.status).toBe(401);
    });

    it('rejects non-member', async () => {
      const otherUser = await createTestUser({ email: `other-billing-${Date.now()}@test.com` });
      const otherToken = generateToken(otherUser.id);
      const res = await app.request('/api/billing/subscription', {
        headers: { Authorization: `Bearer ${otherToken}`, 'X-Org-Id': orgId },
      });
      expect(res.status).toBe(403);
    });

    it('viewer cannot change plan', async () => {
      const viewerUser = await createTestUser({ email: `viewer-billing-${Date.now()}@test.com` });
      const db = getDb();
      await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
      const viewerToken = generateToken(viewerUser.id);
      const res = await app.request('/api/billing/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${viewerToken}`, 'X-Org-Id': orgId },
        body: JSON.stringify({ plan: 'pro' }),
      });
      expect(res.status).toBe(403);
    });
  });
});
