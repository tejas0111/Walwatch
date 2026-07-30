import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { createMiddleware } from 'hono/factory';
import pino from 'pino';

import { vaultRoutes } from './routes/vaults.js';
import { authRoutes } from './routes/auth.js';
import { keyRoutes } from './routes/keys.js';
import { orgRoutes } from './routes/orgs.js';
import { projectRoutes } from './routes/projects.js';
import { blobRoutes } from './routes/blobs.js';
import { policyRoutes } from './routes/policies.js';
import { walletRoutes } from './routes/wallets.js';
import { alertRoutes } from './routes/alerts.js';
import { analyticsRoutes } from './routes/analytics.js';
import { auditLogRoutes } from './routes/audit-logs.js';
import { activityFeedRoutes } from './routes/activity-feed.js';
import { billingRoutes } from './routes/billing.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { publisherRoutes } from './routes/publishers.js';
import { aggregatorRoutes } from './routes/aggregators.js';
import { budgetRoutes } from './routes/budgets.js';
import { spendingLimitRoutes } from './routes/spending-limits.js';
import { teamRoutes } from './routes/teams.js';
import { renewalJobRoutes } from './routes/renewal-jobs.js';
import { costSimulationRoutes } from './routes/cost-engine.js';
import { invitationRoutes } from './routes/invitations.js';
import { webhookRoutes } from './routes/webhooks.js';
import { alertEventRoutes } from './routes/alert-events.js';
import { scheduleRoutes } from './routes/schedules.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { adminRoutes } from './routes/admin.js';
import { featureFlagRoutes } from './routes/feature-flags.js';
import { experimentRoutes } from './routes/experiments.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { metricsMiddleware, metricsHandler } from './middleware/metrics.js';
import { getDb } from './db/index.js';
import { withRetry } from './lib/retry.js';
import { config } from './config.js';
import { setupGracefulShutdown } from './lib/graceful-shutdown.js';
import { createPoolFromEnv } from './lib/sui-pool.js';
import { startBalanceMonitor, stopBalanceMonitor } from './services/gas-wallet-service.js';
import { initEventBus } from './lib/event-bus.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { rateLimit } from './middleware/rate-limit.js';
import { AppError, FailureClasses, userFacingMessage } from './lib/errors.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const log = pino({ name: 'auto-renewal-api' });

const app = new Hono();

// Initialize event bus (webhook dispatch + persistence subscribers)
initEventBus();

// ── Global middleware ──────────────────────────────────────────────
app.use('*', requestId);
app.use('*', compress());
app.use('*', requestLogger());
app.use('*', metricsMiddleware());

// CORS — configurable via ALLOWED_ORIGINS env var
// When no origins are configured, skip CORS entirely to block all cross-origin requests.
if (config.allowedOrigins.length > 0) {
  app.use('*', cors({
    origin: config.allowedOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Org-Id', 'X-API-Key', 'X-Request-Id'],
    maxAge: 86400,
  }));
}

// Idempotency middleware for safe retries on mutating requests
app.use('*', idempotencyMiddleware);

// Global body size limit — uses Hono's streaming body check (not spoofable Content-Length header)
// Auth routes allow up to 10 KB; all others up to 1 MB
app.use('/api/auth/*', bodyLimit({ maxSize: 10 * 1024 }));
app.use('*', bodyLimit({ maxSize: 1024 * 1024 }));

// Security headers
app.use('*', createMiddleware(async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('X-XSS-Protection', '0');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.nodeEnv === 'production') {
    c.res.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}));

// ── Health check (before auth middleware) ──────────────────────────
app.get('/health', async (c) => {
  const checks: Record<string, string> = {};

  // DB check
  try {
    const db = getDb();
    await db.execute('SELECT 1');
    checks.db = 'connected';
  } catch {
    checks.db = 'error';
  }

  // Sui RPC check — uses pool for multi-endpoint failover
  try {
    const pool = createPoolFromEnv({ threshold: 2, timeout: 10_000 });
    await pool.call(async (client) => {
      await withRetry(async () => {
        await client.getLatestCheckpointSequenceNumber();
      }, { maxRetries: 2, label: 'health-sui-rpc', baseDelay: 500 });
    });
    checks.suiRpc = 'connected';
  } catch {
    checks.suiRpc = 'error';
  }

  // Keeper check
  checks.keeper = 'unknown';
  if (config.keeperHealthUrl) {
    try {
      const resp = await fetch(`${config.keeperHealthUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      checks.keeper = resp.ok ? 'connected' : 'error';
    } catch {
      checks.keeper = 'error';
    }
  } else {
    checks.keeper = 'not_configured';
  }

  const allOk = Object.values(checks).every((s) => s === 'connected' || s === 'not_configured');
  const statusCode = allOk ? 200 : 503;
  return c.json({ status: allOk ? 'ok' : 'degraded' }, statusCode);
});

// ── Metrics (restrict to localhost in production) ──────────────────
// Uses actual socket remote address (most reliable) plus x-forwarded-for
// as fallback for proxied deployments. Requires trusted reverse proxy
// to set x-forwarded-for correctly in production.
app.get('/metrics', (c, next) => {
  const isProd = config.nodeEnv === 'production';
  if (!isProd) return next();

  // Check actual socket connection first (most reliable, not spoofable)
  // @hono/node-server injects `incoming` on c.env, but it's not in Hono's default types
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  const socketAddr = env.incoming?.socket?.remoteAddress || '';
  const isSocketLocal = socketAddr === '127.0.0.1' || socketAddr === '::1' || socketAddr === '::ffff:127.0.0.1';

  // Fallback: only trust proxy headers if X-Forwarded-By confirms the proxy identity
  const forwardedBy = c.req.header('x-forwarded-by');
  const isProxyLocal = forwardedBy
    ? (() => {
        const forwarded = c.req.header('x-forwarded-for');
        const ip = forwarded ? forwarded.split(',')[0].trim() : c.req.header('x-real-ip') || '';
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      })()
    : false;

  if (!isSocketLocal && !isProxyLocal) {
    const reqId = c.get('requestId') as string | undefined;
    return c.json({ error: { message: 'Metrics endpoint is restricted to localhost', code: 'FORBIDDEN', failureClass: FailureClasses.PERSISTENT, requestId: reqId } }, 403);
  }
  return next();
}, metricsHandler);

// ── Global rate limiting for all API routes ──────────────────────
// Spec 14: Rate limits enforced per API Key / per Organization.
// General API: 1000 requests per minute. Auth endpoints have stricter limits.
app.use('/api/*', rateLimit({ windowMs: 60 * 1000, max: 1000 }));
app.use('/api/v1/*', rateLimit({ windowMs: 60 * 1000, max: 1000 }));

// ── API routes (v1) ──────────────────────────────────────────────
// Spec 14: API explicitly versioned. v1 is the current version.
// Breaking changes require a new version (v2, etc.) with concurrent support.
const API_PREFIX = '/api/v1';

app.route(`${API_PREFIX}/vaults`, vaultRoutes);
app.route(`${API_PREFIX}/auth`, authRoutes);
app.route(`${API_PREFIX}/keys`, keyRoutes);
app.route(`${API_PREFIX}/orgs`, orgRoutes);
app.route(`${API_PREFIX}/projects`, projectRoutes);
app.route(`${API_PREFIX}/blobs`, blobRoutes);
app.route(`${API_PREFIX}/policies`, policyRoutes);
app.route(`${API_PREFIX}/wallets`, walletRoutes);
app.route(`${API_PREFIX}/alerts`, alertRoutes);
app.route(`${API_PREFIX}/analytics`, analyticsRoutes);
app.route(`${API_PREFIX}/audit-logs`, auditLogRoutes);
app.route(`${API_PREFIX}/activity-feed`, activityFeedRoutes);
app.route(`${API_PREFIX}/billing`, billingRoutes);
app.route(`${API_PREFIX}/api-keys`, apiKeyRoutes);
app.route(`${API_PREFIX}/publishers`, publisherRoutes);
app.route(`${API_PREFIX}/aggregators`, aggregatorRoutes);
app.route(`${API_PREFIX}/budgets`, budgetRoutes);
app.route(`${API_PREFIX}/spending-limits`, spendingLimitRoutes);
app.route(`${API_PREFIX}/teams`, teamRoutes);
app.route(`${API_PREFIX}/renewal-jobs`, renewalJobRoutes);
app.route(`${API_PREFIX}/cost-engine`, costSimulationRoutes);
app.route(`${API_PREFIX}/invitations`, invitationRoutes);
app.route(`${API_PREFIX}/webhooks`, webhookRoutes);
app.route(`${API_PREFIX}/alert-events`, alertEventRoutes);
app.route(`${API_PREFIX}/schedules`, scheduleRoutes);
app.route(`${API_PREFIX}/dashboard`, dashboardRoutes);
app.route(`${API_PREFIX}/admin`, adminRoutes);
app.route(`${API_PREFIX}/admin/flags`, featureFlagRoutes);
app.route(`${API_PREFIX}/experiments`, experimentRoutes);

// ── Deprecated API compatibility headers ───────────────────────
// Spec 29: Legacy /api/* routes get Sunset + Deprecation headers.
// /api/v1/* routes are exempt.
app.use('/api/*', createMiddleware(async (c, next) => {
  if (c.req.path.startsWith('/api/v1')) return next();
  await next();
  c.res.headers.set('Sunset', 'Sat, 31 Dec 2025 23:59:59 GMT');
  c.res.headers.set('Deprecation', 'true');
  c.res.headers.set('Link', '</api/v1>; rel="deprecation"');
}));

// ── Legacy /api/* routes (backward compatible) ──────────────────
// Deprecated: will be removed in a future version.
// Clients should migrate to /api/v1/*.
app.route('/api/vaults', vaultRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/keys', keyRoutes);
app.route('/api/orgs', orgRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/blobs', blobRoutes);
app.route('/api/policies', policyRoutes);
app.route('/api/wallets', walletRoutes);
app.route('/api/alerts', alertRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/audit-logs', auditLogRoutes);
app.route('/api/activity-feed', activityFeedRoutes);
app.route('/api/billing', billingRoutes);
app.route('/api/api-keys', apiKeyRoutes);
app.route('/api/publishers', publisherRoutes);
app.route('/api/aggregators', aggregatorRoutes);
app.route('/api/budgets', budgetRoutes);
app.route('/api/spending-limits', spendingLimitRoutes);
app.route('/api/teams', teamRoutes);
app.route('/api/renewal-jobs', renewalJobRoutes);
app.route('/api/cost-engine', costSimulationRoutes);
app.route('/api/invitations', invitationRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/alert-events', alertEventRoutes);
app.route('/api/schedules', scheduleRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin/flags', featureFlagRoutes);
app.route('/api/experiments', experimentRoutes);

// ── 404 fallback (standardized error shape per Spec 14 & 20) ──
app.notFound((c) => {
  return c.json({
    error: {
      message: `Route ${c.req.method} ${c.req.path} not found`,
      code: 'NOT_FOUND',
      failureClass: FailureClasses.PERSISTENT,
      requestId: c.get('requestId') as string | undefined,
    },
  }, 404);
});

// ── Global error handler (standardized error shape per Spec 14 & 20) ──
app.onError((err, c) => {
  const requestId = (c.get('requestId') as string) || 'unknown';
  log.error({ err, requestId, method: c.req.method, path: c.req.path }, 'Unhandled error');

  // If it's an AppError, use its code, status, and failure class
  if (err instanceof AppError) {
    return c.json({
      error: {
        // Spec 20: Use class-appropriate user-facing message
        message: userFacingMessage(err),
        code: err.code || 'INTERNAL_ERROR',
        failureClass: err.failureClass,
        requestId,
        ...(err.partialResults ? { results: err.partialResults } : {}),
      },
    }, err.statusCode as ContentfulStatusCode);
  }

  // Non-AppError: treat as unclassified → Persistent (conservative assumption per Spec 20)
  // Don't expose internal error details in production
  const message = config.nodeEnv === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  return c.json({
    error: {
      message,
      code: 'INTERNAL_ERROR',
      failureClass: FailureClasses.PERSISTENT,
      requestId,
    },
  }, 500);
});

// ── Start server ──────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '3001', 10);

// Start gas wallet balance monitor (checks every 5 min)
startBalanceMonitor();

const server = serve({
  fetch: app.fetch,
  port,
}, (info: { port: number }) => {
  log.info({ port: info.port }, 'Auto-renewal API server started');
});

setupGracefulShutdown(server);

process.on('SIGTERM', stopBalanceMonitor);
process.on('SIGINT', stopBalanceMonitor);

export { app };
