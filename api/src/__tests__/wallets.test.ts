import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { walletRoutes } from '../routes/wallets.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, wallets } from '../db/schema.js';

describe('Wallet routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/wallets', walletRoutes);

    const user = await createTestUser({ email: `wallets-test-${Date.now()}@test.com` });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Wallets Org',
      slug: `wallets-org-${Date.now()}`,
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

  let createdWalletId: string;

  it('creates a wallet (201)', async () => {
    const res = await authed('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '0x1234567890abcdef',
        label: 'Main Wallet',
        type: 'owned',
        isDefault: true,
        spendingLimit: 1000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.address).toBe('0x1234567890abcdef');
    expect(body.label).toBe('Main Wallet');
    expect(body.type).toBe('owned');
    expect(body.isDefault).toBe(true);
    expect(body.spendingLimit).toBe(1000);
    expect(body.orgId).toBe(orgId);
    createdWalletId = body.id;
  });

  it('lists wallets (200)', async () => {
    const res = await authed('/api/wallets');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallets.length).toBeGreaterThanOrEqual(1);
    expect(body.wallets.some((w: { id: string }) => w.id === createdWalletId)).toBe(true);
  });

  it('gets wallet by id (200)', async () => {
    const res = await authed(`/api/wallets/${createdWalletId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdWalletId);
    expect(body.address).toBe('0x1234567890abcdef');
  });

  it('updates wallet (200)', async () => {
    const res = await authed(`/api/wallets/${createdWalletId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Updated Wallet', spendingLimit: 2000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.label).toBe('Updated Wallet');
    expect(body.spendingLimit).toBe(2000);
  });

  it('deletes wallet (200)', async () => {
    const db = getDb();
    const [wallet] = await db.insert(wallets).values({
      orgId,
      address: '0xdeadbeef',
      label: 'Delete Me',
    }).returning();

    const res = await authed(`/api/wallets/${wallet.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Wallet removed');
  });

  it('refreshes balance (200)', async () => {
    const res = await authed(`/api/wallets/${createdWalletId}/refresh-balance`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Balance refreshed');
    expect(typeof body.balance).toBe('number');
  });

  it('rejects without auth (401)', async () => {
    const res = await app.request('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0xnoauth' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-member (403)', async () => {
    const otherUser = await createTestUser({ email: `non-member-wallet-${Date.now()}@test.com` });
    const otherToken = generateToken(otherUser.id);
    const res = await app.request('/api/wallets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ address: '0xnonmember' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer creating (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-wallet-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/wallets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ address: '0xviewerwallet' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects duplicate address in same org (409)', async () => {
    const res = await authed('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x1234567890abcdef' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});
