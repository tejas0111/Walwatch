import { Context, Next } from 'hono';
import { getDb } from '../db/index.js';
import { organizations, orgMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { ErrorCodes } from '../lib/errors.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    role: string;
    requestId: string;
    authMethod: string;
  }
}

// TODO: spec 06 granular capability system - requires architectural discussion

export async function requireOrg(c: Context, next: Next) {
  const userId = c.get('userId');
  const orgId = c.req.param('id') || c.req.header('X-Org-Id');
  if (!orgId) {
    return c.json({ error: { message: 'Organization ID is required', code: ErrorCodes.VALIDATION_ERROR, failureClass: 'persistent', requestId: c.get('requestId') } }, 400);
  }

  const db = getDb();
  const [org] = await db.select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) {
    return c.json({ error: { message: 'Organization not found', code: ErrorCodes.NOT_FOUND, failureClass: 'persistent', requestId: c.get('requestId') } }, 404);
  }

  if (org.status === 'suspended') {
    return c.json({ error: { message: 'Organization is suspended', code: ErrorCodes.FORBIDDEN, failureClass: 'persistent', requestId: c.get('requestId') } }, 403);
  }

  const [membership] = await db.select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: { message: 'Not a member of this organization', code: ErrorCodes.FORBIDDEN, failureClass: 'persistent', requestId: c.get('requestId') } }, 403);
  }

  c.set('orgId', orgId);
  if (c.get('authMethod') !== 'api-key') {
    c.set('role', membership.role);
  }
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const userRole = c.get('role');
    if (!roles.includes(userRole)) {
      return c.json({ error: { message: `Requires one of roles: ${roles.join(', ')}`, code: ErrorCodes.FORBIDDEN, failureClass: 'persistent', requestId: c.get('requestId') } }, 403);
    }
    await next();
  };
}
