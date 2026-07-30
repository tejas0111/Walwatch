import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';

const router = new Hono();

router.use('*', requireAuth);

export { router as keyRoutes };
