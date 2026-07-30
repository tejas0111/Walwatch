import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { alertRoutes } from '../routes/alerts.js';
import { authRoutes } from '../routes/auth.js';
import { orgRoutes } from '../routes/orgs.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createTestUser, generateToken } from './helpers.js';
import { getDb } from '../db/index.js';
import { organizations, orgMembers, notificationChannels, alertRules } from '../db/schema.js';

describe('Alert routes', () => {
  let app: Hono;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    await setupTestDb();
    app = new Hono();
    app.route('/api/auth', authRoutes);
    app.route('/api/orgs', orgRoutes);
    app.route('/api/alerts', alertRoutes);

    const user = await createTestUser({ email: `alerts-test-${Date.now()}@test.com` });
    userId = user.id;
    token = generateToken(user.id);

    const db = getDb();
    const [org] = await db.insert(organizations).values({
      name: 'Alerts Org',
      slug: `alerts-org-${Date.now()}`,
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

  let createdChannelId: string;
  let createdRuleId: string;

  // Channel CRUD (4 tests)

  it('creates a notification channel (201)', async () => {
    const res = await authed('/api/alerts/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email',
        name: 'Admin Email',
        config: { email: 'admin@example.com' },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Admin Email');
    expect(body.type).toBe('email');
    expect(body.config.email).toBe('admin@example.com');
    expect(body.orgId).toBe(orgId);
    expect(body.enabled).toBe(true);
    createdChannelId = body.id;
  });

  it('lists notification channels (200)', async () => {
    const res = await authed('/api/alerts/channels');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels.length).toBeGreaterThanOrEqual(1);
    expect(body.channels.some((c: { id: string }) => c.id === createdChannelId)).toBe(true);
  });

  it('updates a notification channel (200)', async () => {
    const res = await authed(`/api/alerts/channels/${createdChannelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Channel', enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Channel');
    expect(body.enabled).toBe(false);
  });

  it('deletes a notification channel (200)', async () => {
    const db = getDb();
    const [channel] = await db.insert(notificationChannels).values({
      orgId,
      type: 'slack',
      name: 'Delete Me',
      config: { webhook: 'https://hooks.slack.com/test' },
    }).returning();

    const res = await authed(`/api/alerts/channels/${channel.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Channel deleted');
  });

  // Alert Rule CRUD (4 tests)

  it('creates an alert rule (201)', async () => {
    const res = await authed('/api/alerts/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Blob Expiry Warning',
        trigger: 'blob_expiring',
        channelIds: [createdChannelId],
        projectIds: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Blob Expiry Warning');
    expect(body.trigger).toBe('blob_expiring');
    expect(body.channelIds).toContain(createdChannelId);
    expect(body.orgId).toBe(orgId);
    expect(body.enabled).toBe(true);
    createdRuleId = body.id;
  });

  it('lists alert rules (200)', async () => {
    const res = await authed('/api/alerts/rules');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules.length).toBeGreaterThanOrEqual(1);
    expect(body.rules.some((r: { id: string }) => r.id === createdRuleId)).toBe(true);
  });

  it('updates an alert rule (200)', async () => {
    const res = await authed(`/api/alerts/rules/${createdRuleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Rule', enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Rule');
    expect(body.enabled).toBe(false);
  });

  it('deletes an alert rule (200)', async () => {
    const db = getDb();
    const [rule] = await db.insert(alertRules).values({
      orgId,
      name: 'Delete Me',
      trigger: 'renewal_failed',
      channelIds: [],
    }).returning();

    const res = await authed(`/api/alerts/rules/${rule.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Rule deleted');
  });

  // Auth & authorization tests (3 tests)

  it('rejects without auth (401)', async () => {
    const res = await app.request('/api/alerts/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', name: 'No Auth', config: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-member (403)', async () => {
    const otherUser = await createTestUser({ email: `non-member-alert-${Date.now()}@test.com` });
    const otherToken = generateToken(otherUser.id);
    const res = await app.request('/api/alerts/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ type: 'email', name: 'Non Member', config: {} }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer creating channel (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-alert-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/alerts/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ type: 'email', name: 'Viewer Create', config: {} }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects viewer creating rule (403)', async () => {
    const viewerUser = await createTestUser({ email: `viewer-rule-${Date.now()}@test.com` });
    const db = getDb();
    await db.insert(orgMembers).values({ orgId, userId: viewerUser.id, role: 'viewer' });
    const viewerToken = generateToken(viewerUser.id);
    const res = await app.request('/api/alerts/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({ name: 'Viewer Rule', trigger: 'blob_expiring', channelIds: [] }),
    });
    expect(res.status).toBe(403);
  });
});
