/**
 * Experiments API (spec 29)
 *
 * Structured A/B or staged rollout of behavioral changes.
 * Every experiment's assignment is recorded for attribution.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../db/index.js';
import { experiments, experimentAssignments } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { logAuditSystem } from '../middleware/audit.js';

const router = new Hono();

const createExperimentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  variants: z.array(z.string()).optional(),
  targetingRules: z.record(z.unknown()).optional(),
});

const updateExperimentSchema = z.object({
  description: z.string().optional(),
  variants: z.array(z.string()).optional(),
  targetingRules: z.record(z.unknown()).optional(),
});

const assignChangeSchema = z.object({
  orgId: z.string().uuid(),
  variant: z.string().min(1),
});

function getAdminId(c: { req: { header: (name: string) => string | undefined } }): string {
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  return `admin:${adminKey.substring(0, 8)}`;
}

// ── Admin-only: create experiment ──────────────────────────────────

router.post('/', requireAdmin, zValidator('json', createExperimentSchema), async (c) => {
  const input = c.req.valid('json');
  const db = getDb();

  const [existing] = await db.select().from(experiments)
    .where(eq(experiments.name, input.name)).limit(1);
  if (existing) {
    return c.json({ error: { message: 'Experiment with this name already exists', code: 'CONFLICT' } }, 409);
  }

  const [experiment] = await db.insert(experiments).values({
    name: input.name,
    description: input.description ?? null,
    variants: input.variants ?? [],
    targetingRules: input.targetingRules ?? {},
  }).returning();

  const adminId = getAdminId(c);
  await logAuditSystem(
    c.get('orgId') || 'system', 'experiment.created', 'experiment', experiment.name,
    { name: experiment.name, description: experiment.description, variants: experiment.variants, adminId },
  );

  return c.json(experiment, 201);
});

// ── Admin-only: update experiment ──────────────────────────────────

router.patch('/:name', requireAdmin, zValidator('json', updateExperimentSchema), async (c) => {
  const { name } = c.req.param();
  const input = c.req.valid('json');
  const db = getDb();

  const [experiment] = await db.update(experiments)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(experiments.name, name))
    .returning();
  if (!experiment) return c.json({ error: { message: 'Experiment not found', code: 'NOT_FOUND' } }, 404);

  const adminId = getAdminId(c);
  await logAuditSystem(
    c.get('orgId') || 'system', 'experiment.updated', 'experiment', experiment.name,
    { name: experiment.name, changes: input, adminId },
  );

  return c.json(experiment);
});

// ── Admin-only: delete experiment ──────────────────────────────────

router.delete('/:name', requireAdmin, async (c) => {
  const { name } = c.req.param();
  const db = getDb();

  const [existing] = await db.select().from(experiments)
    .where(eq(experiments.name, name)).limit(1);
  if (!existing) return c.json({ error: { message: 'Experiment not found', code: 'NOT_FOUND' } }, 404);

  await db.delete(experiments).where(eq(experiments.name, name));

  const adminId = getAdminId(c);
  await logAuditSystem(
    c.get('orgId') || 'system', 'experiment.deleted', 'experiment', name,
    { name, adminId },
  );

  return c.json({ status: 'deleted' });
});

// ── Admin-only: change variant assignment ─────────────────────────

async function handleAssign(c: any) {
  const { name } = c.req.param();
  const { orgId, variant } = c.req.valid('json');
  const db = getDb();

  const [existing] = await db.select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentName, name), eq(experimentAssignments.orgId, orgId)))
    .limit(1);

  let assignment;
  if (existing) {
    [assignment] = await db.update(experimentAssignments)
      .set({ variant })
      .where(eq(experimentAssignments.id, existing.id))
      .returning();
  } else {
    [assignment] = await db.insert(experimentAssignments).values({ experimentName: name, orgId, variant }).returning();
  }

  const adminId = getAdminId(c);
  await logAuditSystem(
    orgId, 'experiment.assigned', 'experiment_assignment', assignment.id,
    { experimentName: name, variant, previousVariant: existing?.variant ?? null, adminId },
  );

  return c.json(assignment);
}

router.patch('/:name/assign', requireAdmin, zValidator('json', assignChangeSchema), handleAssign);

router.post('/:name/assign', requireAdmin, zValidator('json', assignChangeSchema), async (c) => {
  return handleAssign(c);
});

// ── Admin-only: list all experiments ──────────────────────────────

router.get('/', requireAdmin, async (c) => {
  const db = getDb();
  const list = await db.select().from(experiments).orderBy(experiments.name);
  return c.json({ experiments: list });
});

// ── Admin-only: get experiment assignments ────────────────────────

router.get('/:name', requireAdmin, async (c) => {
  const { name } = c.req.param();
  const db = getDb();
  const assignments = await db.select()
    .from(experimentAssignments)
    .where(eq(experimentAssignments.experimentName, name))
    .orderBy(experimentAssignments.assignedAt);
  return c.json({ experimentName: name, assignments });
});



// ── Authenticated: get the variant for the current org ────────────

router.get('/:name/variant', requireAuth, requireOrg, async (c) => {
  const { name } = c.req.param();
  const orgId = c.get('orgId');
  const db = getDb();

  const [assignment] = await db.select()
    .from(experimentAssignments)
    .where(and(
      eq(experimentAssignments.experimentName, name),
      eq(experimentAssignments.orgId, orgId),
    ))
    .limit(1);

  if (!assignment) {
    return c.json({ experimentName: name, variant: null, assigned: false });
  }

  return c.json({
    experimentName: assignment.experimentName,
    variant: assignment.variant,
    assigned: true,
  });
});

export { router as experimentRoutes };
