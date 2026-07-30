import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { getDb } from '../db/index.js';
import { blobRegistrations, projects, policies, wallets, auditLogs } from '../db/schema.js';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { escapeLike } from '../lib/escape-like.js';

const router = new Hono();

router.use('*', requireAuth);

async function overviewHandler(c: any) {
  const orgId = c.get('orgId');
  const db = getDb();

  const [[blobCount], [activeBlobCount], [projectCount], [policyCount], [walletCount]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(blobRegistrations).where(eq(blobRegistrations.orgId, orgId)),
    db.select({ count: sql<number>`count(*)` }).from(blobRegistrations).where(and(eq(blobRegistrations.orgId, orgId), eq(blobRegistrations.status, 'active'))),
    db.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.orgId, orgId)),
    db.select({ count: sql<number>`count(*)` }).from(policies).where(eq(policies.orgId, orgId)),
    db.select({ count: sql<number>`count(*)` }).from(wallets).where(eq(wallets.orgId, orgId)),
  ]);

  return c.json({
    totalBlobs: Number(blobCount.count),
    activeBlobs: Number(activeBlobCount.count),
    totalProjects: Number(projectCount.count),
    totalPolicies: Number(policyCount.count),
    totalWallets: Number(walletCount.count),
  });
}

router.get('/', requireOrg, overviewHandler);

router.get('/overview', requireOrg, overviewHandler);

router.get('/storage', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  const [storageStats] = await db.select({
    totalSize: sql<number>`COALESCE(SUM(size_bytes), 0)`,
    avgSize: sql<number>`COALESCE(AVG(size_bytes), 0)`,
    blobCount: sql<number>`count(*)`,
  }).from(blobRegistrations).where(eq(blobRegistrations.orgId, orgId));

  const byStatus = await db.select({
    status: blobRegistrations.status,
    count: sql<number>`count(*)`,
    totalSize: sql<number>`COALESCE(SUM(size_bytes), 0)`,
  }).from(blobRegistrations)
    .where(eq(blobRegistrations.orgId, orgId))
    .groupBy(blobRegistrations.status);

  return c.json({
    totalSizeBytes: Number(storageStats.totalSize),
    averageSizeBytes: Math.round(Number(storageStats.avgSize)),
    blobCount: Number(storageStats.blobCount),
    byStatus,
  });
});

router.get('/renewals', requireOrg, async (c) => {
  const orgId = c.get('orgId');
  const db = getDb();

  const [renewalStats] = await db.select({
    count: sql<number>`count(*)`,
  }).from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), ilike(auditLogs.action, '%renewal%')));

  return c.json({
    totalRenewals: Number(renewalStats.count),
  });
});

router.get('/costs', requireOrg, async (c) => {
  return c.json({ message: 'Coming soon', data: [] });
});

router.get('/forecasts', requireOrg, async (c) => {
  return c.json({ message: 'Coming soon', data: [] });
});

export { router as analyticsRoutes };