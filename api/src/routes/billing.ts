import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import pino from 'pino';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg, requireRole } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { getDb } from '../db/index.js';
import { subscriptions, usageRecords, invoices, projects } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';

import { AppError, ErrorCodes } from '../lib/errors.js';
import { validateTransition } from '../lib/state-machine.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
} from '../lib/cursor-pagination.js';

const log = pino({ name: 'billing-routes' });
const VALID_PLANS = ['free', 'pro', 'team', 'enterprise'] as const;

/**
 * Per-plan resource limits.
 * Spec 27: Downgrade must check limits before allowing the change.
 */
const PLAN_LIMITS: Record<string, { maxProjects: number }> = {
  free: { maxProjects: 1 },
  pro: { maxProjects: 5 },
  team: { maxProjects: 20 },
  enterprise: { maxProjects: Infinity },
};

const router = new Hono();

router.use('*', requireAuth);

/**
 * @route GET /api/billing/subscription
 * @description Get the current subscription plan (auto-creates 'free' if none exists)
 * @auth Bearer token required
 * @returns { Subscription }
 */
router.get('/subscription', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();

    let [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
    if (!sub) {
      [sub] = await db.insert(subscriptions).values({ orgId, plan: 'free', status: 'active' }).returning();
    }

    return c.json({ subscription: sub });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code, failureClass: error.failureClass, requestId: c.get('requestId') } }, error.statusCode as ContentfulStatusCode);
    log.error({ error }, 'Failed to get subscription');
    return c.json({ error: { message: 'Internal server error', code: ErrorCodes.INTERNAL_ERROR, failureClass: 'systemic', requestId: c.get('requestId') } }, 500);
  }
});

/**
 * @route POST /api/billing/subscription
 * @description Create or update the subscription plan (upsert)
 * @auth Bearer token required (owner or admin)
 * @body { plan: 'free'|'pro'|'team'|'enterprise' }
 * @returns { Subscription }
 */
router.post('/subscription', requireOrg, requireRole('owner', 'admin'), zValidator('json', z.object({
  plan: z.enum(VALID_PLANS),
})), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { plan } = c.req.valid('json');
  const db = getDb();

  const now = new Date();
  const periodEnd = plan === 'free' ? null : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  try {
    // Get current subscription to detect downgrade
    const [currentSub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.orgId, orgId)).limit(1);

    if (currentSub && currentSub.plan !== plan) {
      validateTransition('subscription', currentSub.plan, plan);
      // Spec 27: Downgrade Below Current Usage.
      // Check if the current number of projects exceeds the target plan's limit.
      const currentPlanRank = VALID_PLANS.indexOf(currentSub.plan as any);
      const targetPlanRank = VALID_PLANS.indexOf(plan);
      const isDowngrade = targetPlanRank < currentPlanRank;

      if (isDowngrade) {
        const targetLimit = PLAN_LIMITS[plan]?.maxProjects ?? Infinity;
        const activeProjectCount = await db.select({ count: sql<number>`COUNT(*)` })
          .from(projects)
          .where(and(
            eq(projects.orgId, orgId),
            sql`${projects.status} IS DISTINCT FROM 'archived'`,
            sql`${projects.status} IS DISTINCT FROM 'deleted'`,
          ))
          .then(r => Number(r[0]?.count ?? 0));

        if (activeProjectCount > targetLimit) {
          // Deterministically select excess projects (most-recently-created-first per Spec 27)
          // and disclose which would be affected.
          const excess = activeProjectCount - targetLimit;
          const projectsToArchive = await db.select({
            id: projects.id,
            name: projects.name,
            createdAt: projects.createdAt,
          })
            .from(projects)
            .where(and(
              eq(projects.orgId, orgId),
              sql`${projects.status} IS DISTINCT FROM 'archived'`,
              sql`${projects.status} IS DISTINCT FROM 'deleted'`,
            ))
            .orderBy(desc(projects.createdAt))
            .limit(excess);

          return c.json({
            error: {
              message: `Cannot downgrade to '${plan}': ${activeProjectCount} active projects exceed the ${plan} plan limit of ${targetLimit}.`,
              code: ErrorCodes.VALIDATION_ERROR,
              failureClass: 'persistent',
              requestId: c.get('requestId'),
              details: {
                currentPlan: currentSub.plan,
                targetPlan: plan,
                activeProjects: activeProjectCount,
                maxProjects: targetLimit,
                excessCount: excess,
                // Disclosed before confirmation (Spec 27): list projects that would be archived
                projectsToArchive: projectsToArchive.map(p => ({
                  id: p.id,
                  name: p.name,
                  createdAt: p.createdAt?.toISOString(),
                })),
              },
            },
          }, 400);
        }
      }
    }

    const [sub] = await db.insert(subscriptions).values({
      orgId, plan, status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    }).onConflictDoUpdate({
      target: subscriptions.orgId,
      set: {
        plan, status: 'active',
        currentPeriodEnd: periodEnd,
      },
    }).returning();

    await logAudit(c, 'subscription.updated', 'subscription', sub.id, { plan });
    return c.json(sub);
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code, failureClass: error.failureClass, requestId: c.get('requestId') } }, error.statusCode as ContentfulStatusCode);
    log.error({ error }, 'Failed to update subscription');
    return c.json({ error: { message: 'Internal server error', code: ErrorCodes.INTERNAL_ERROR, failureClass: 'systemic', requestId: c.get('requestId') } }, 500);
  }
});

/**
 * @route GET /api/billing/invoices
 * @description List invoices for the organization
 * @auth Bearer token required (owner or admin)
 * @returns { invoices: Invoice[] }
 */
router.get('/invoices', requireOrg, requireRole('owner', 'admin'), async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();

    // Cursor-based pagination (Spec 14)
    const { cursor, limit } = parsePagination(c.req.query('cursor'), c.req.query('limit'));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const fetchLimit = limit + 1;

    const cursorWhere = buildCursorWhere(decodedCursor, invoices.createdAt, invoices.id, 'desc');
    const baseConditions = eq(invoices.orgId, orgId);
    const finalWhere = cursorWhere ? and(baseConditions, cursorWhere) : baseConditions;
    const orderBy = buildCursorOrderBy(invoices.createdAt, invoices.id, 'desc');

    const items = await db.select()
      .from(invoices)
      .where(finalWhere)
      .orderBy(...orderBy)
      .limit(fetchLimit);

    const paginated = wrapPaginatedResponse(items, limit, (i) => i.id, (i) => i.createdAt.toISOString());

    return c.json({
      invoices: paginated.data,
      pagination: { nextCursor: paginated.nextCursor, hasMore: paginated.hasMore },
    });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code, failureClass: error.failureClass, requestId: c.get('requestId') } }, error.statusCode as ContentfulStatusCode);
    log.error({ error }, 'Failed to get invoices');
    return c.json({ error: { message: 'Internal server error', code: ErrorCodes.INTERNAL_ERROR, failureClass: 'systemic', requestId: c.get('requestId') } }, 500);
  }
});

/**
 * @route GET /api/billing/usage
 * @description Get aggregated usage metrics
 * @auth Bearer token required
 * @returns { usage: { metric: string, total: number }[] }
 */
router.get('/usage', requireOrg, async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();

    const metrics = await db.select({
      metric: usageRecords.metric,
      total: sql<number>`SUM(value)`,
    })
      .from(usageRecords)
      .where(eq(usageRecords.orgId, orgId))
      .groupBy(usageRecords.metric);

    return c.json({ usage: metrics });
  } catch (error) {
    if (error instanceof AppError) return c.json({ error: { message: error.message, code: error.code, failureClass: error.failureClass, requestId: c.get('requestId') } }, error.statusCode as ContentfulStatusCode);
    log.error({ error }, 'Failed to get usage');
    return c.json({ error: { message: 'Internal server error', code: ErrorCodes.INTERNAL_ERROR, failureClass: 'systemic', requestId: c.get('requestId') } }, 500);
  }
});

export { router as billingRoutes };
