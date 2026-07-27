import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { getDb } from '../db/index.js';
import { costEngine } from '../lib/cost-engine.js';

const router = new Hono();

router.use('*', requireAuth);

router.post('/simulate', requireOrg, zValidator('json', z.object({
  blobIds: z.array(z.string()).min(1).max(100),
  policyId: z.string().uuid().optional(),
  extensionEpochs: z.number().int().positive().default(1),
})), async (c) => {
  const { blobIds, extensionEpochs } = c.req.valid('json');
  const estimates = await Promise.all(
    blobIds.map(blobId =>
      costEngine.estimateRenewalCost(blobId, extensionEpochs).catch(e => ({ blobId, error: e.message }))
    )
  );
  return c.json({ simulation: true, estimate: estimates });
});

export { router as costSimulationRoutes };
