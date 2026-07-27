import { createMiddleware } from 'hono/factory';
import { resolveEffectivePermissions, Capability } from '../lib/permissions.js';
import { ErrorCodes } from '../lib/errors.js';

export function requireCapability(...capabilities: Capability[]) {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const { capabilities: userCaps } = await resolveEffectivePermissions(userId, orgId);
    const hasAny = capabilities.some(cap => userCaps.includes(cap));
    if (!hasAny) {
      return c.json({ error: { message: 'Forbidden: insufficient permissions', code: ErrorCodes.FORBIDDEN, failureClass: 'persistent', requestId: c.get('requestId') } }, 403);
    }
    await next();
  });
}
