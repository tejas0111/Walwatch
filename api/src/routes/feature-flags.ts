import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { eq, inArray } from 'drizzle-orm';
import { featureFlags, organizations } from '../db/schema.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { logAuditSystem } from '../middleware/audit.js';

/**
 * Get the admin identity from the X-Admin-Key header.
 * Uses key prefix as identifier (never log full keys).
 */
function getAdminId(c: { req: { header: (name: string) => string | undefined } }): string {
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  return `admin:${adminKey.substring(0, 8)}`;
}

const featureFlagRoutes = new Hono();

featureFlagRoutes.use('*', requireAdmin);

featureFlagRoutes.get('/', async (c) => {
  const flags = await getDb().select().from(featureFlags).orderBy(featureFlags.name);
  return c.json({ flags });
});

featureFlagRoutes.post('/', async (c) => {
  const body = await c.req.json();

  if (body.orgIds && Array.isArray(body.orgIds) && body.orgIds.length > 0) {
    const existing = await getDb().select({ id: organizations.id })
      .from(organizations).where(inArray(organizations.id, body.orgIds));
    const found = new Set(existing.map(o => o.id));
    const missing = body.orgIds.filter((id: string) => !found.has(id));
    if (missing.length > 0) {
      return c.json({ error: { message: `Organizations not found: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' } }, 400);
    }
  }

  const [flag] = await getDb().insert(featureFlags).values({
    name: body.name,
    description: body.description,
    enabled: body.enabled ?? false,
    type: body.type ?? 'release',
    config: body.config ?? {},
    orgIds: body.orgIds ?? [],
  }).returning();

  // Spec 29: flag state change is itself an Audit Event
  const adminId = getAdminId(c);
  await logAuditSystem(
    'system',
    'feature_flag.created',
    'feature_flag',
    flag.id,
    { name: flag.name, enabled: flag.enabled, type: flag.type, orgIds: body.orgIds, adminId },
  );

  return c.json(flag, 201);
});

featureFlagRoutes.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();

  if (body.orgIds && Array.isArray(body.orgIds) && body.orgIds.length > 0) {
    const existing = await getDb().select({ id: organizations.id })
      .from(organizations).where(inArray(organizations.id, body.orgIds));
    const found = new Set(existing.map(o => o.id));
    const missing = body.orgIds.filter((id: string) => !found.has(id));
    if (missing.length > 0) {
      return c.json({ error: { message: `Organizations not found: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' } }, 400);
    }
  }

  const [oldFlag] = await getDb().select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);

  const [flag] = await getDb().update(featureFlags)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(featureFlags.id, id))
    .returning();
  if (!flag) return c.json({ error: { message: 'Flag not found', code: 'NOT_FOUND' } }, 404);

  // Spec 29: flag state change is itself an Audit Event
  const adminId = getAdminId(c);
  await logAuditSystem(
    'system',
    'feature_flag.updated',
    'feature_flag',
    flag.id,
    {
      name: flag.name,
      previouslyEnabled: oldFlag?.enabled,
      nowEnabled: flag.enabled,
      changes: body,
      orgIds: body.orgIds,
      adminId,
    },
  );

  return c.json(flag);
});

featureFlagRoutes.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const [existing] = await getDb().select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
  if (!existing) return c.json({ error: { message: 'Flag not found', code: 'NOT_FOUND' } }, 404);

  // Audit before deletion to capture the flag's final state
  const adminId = getAdminId(c);
  await logAuditSystem(
    'system',
    'feature_flag.deleted',
    'feature_flag',
    existing.id,
    { name: existing.name, enabled: existing.enabled, type: existing.type, adminId },
  );

  await getDb().delete(featureFlags).where(eq(featureFlags.id, id));
  return c.json({ status: 'deleted' });
});

featureFlagRoutes.get('/:id/check', async (c) => {
  const { id } = c.req.param();
  const orgId = c.req.query('orgId');
  const flag = await getDb().select().from(featureFlags).where(eq(featureFlags.id, id)).then(r => r[0]);
  if (!flag) return c.json({ error: { message: 'Flag not found', code: 'NOT_FOUND' } }, 404);

  // Spec 29: flagged-off feature must not be reachable (fails closed)
  const isActive = flag.enabled && (!orgId || !flag.orgIds || flag.orgIds.length === 0 || flag.orgIds.includes(orgId));
  return c.json({ name: flag.name, enabled: flag.enabled, isActiveForOrg: isActive, orgId });
});

export { featureFlagRoutes };
