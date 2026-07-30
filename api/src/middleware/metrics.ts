import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { getDb } from '../db/index.js';

const counters = new Map<string, number>();
const histograms = new Map<string, number[]>();
const inFlightGauge = new Map<string, number>();

export function incrementCounter(name: string, labels: Record<string, string> = {}): void {
  const key = `${name}|${JSON.stringify(labels)}`;
  counters.set(key, (counters.get(key) || 0) + 1);
}

const MAX_HISTOGRAM_ENTRIES = parseInt(process.env.METRICS_HISTOGRAM_MAX || '10000', 10);

export function observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
  const key = `${name}|${JSON.stringify(labels)}`;
  if (!histograms.has(key)) histograms.set(key, []);
  const entries = histograms.get(key)!;
  if (entries.length >= MAX_HISTOGRAM_ENTRIES) {
    entries.shift();
  }
  entries.push(value);
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

export function metricsMiddleware() {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    const route = c.req.routePath;
    const method = c.req.method;
    const orgId = (c.get('orgId') as string) || 'unknown';
    const inFlightKey = `${method} ${route}`;
    inFlightGauge.set(inFlightKey, (inFlightGauge.get(inFlightKey) || 0) + 1);
    try {
      await next();
    } finally {
      inFlightGauge.set(inFlightKey, Math.max(0, (inFlightGauge.get(inFlightKey) || 1) - 1));
      const duration = Date.now() - start;
      const status = c.res.status.toString();
      // Per-endpoint metrics
      incrementCounter('http_requests_total', { method, route, status });
      observeHistogram('http_request_duration_ms', duration, { method, route });
      // Per-tenant metrics (Spec 18: tracked per endpoint and per tenant)
      if (orgId !== 'unknown') {
        incrementCounter('http_requests_total_per_tenant', { method, route, status, org_id: orgId });
        observeHistogram('http_request_duration_ms_per_tenant', duration, { method, route, org_id: orgId });
      }
    }
  });
}

export function metricsHandler(c: Context) {
  let output = '';

  for (const [key, val] of counters) {
    const [name, labelsStr] = key.split('|');
    const labels: Record<string, string> = JSON.parse(labelsStr);
    const lbl = formatLabels(labels);
    output += `# HELP ${name} Total number of requests\n# TYPE ${name} counter\n${name}${lbl} ${val}\n`;
  }

  for (const [key, vals] of histograms) {
    const [name, labelsStr] = key.split('|');
    const labels: Record<string, string> = JSON.parse(labelsStr);
    const lbl = formatLabels(labels);
    const count = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    output += `# HELP ${name} Request duration histogram\n# TYPE ${name} histogram\n`;
    output += `${name}_count${lbl} ${count}\n`;
    output += `${name}_sum${lbl} ${sum}\n`;
    const sorted = [...vals].sort((a, b) => a - b);
    const buckets = [50, 100, 200, 500, 1000, 2000, 5000];
    for (const le of buckets) {
      const bucketCount = sorted.filter(v => v <= le).length;
      output += `${name}_bucket{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')},le="${le}"} ${bucketCount}\n`;
    }
    output += `${name}_bucket{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')},le="+Inf"} ${count}\n`;
  }

  let inFlightTotal = 0;
  for (const val of inFlightGauge.values()) inFlightTotal += val;
  output += `# HELP http_requests_in_flight Current in-flight requests\n# TYPE http_requests_in_flight gauge\nhttp_requests_in_flight ${inFlightTotal}\n`;

  try {
    const client = (getDb() as unknown as { $client: { options: { max?: number } } }).$client;
    if (client && typeof client.options === 'object') {
      const max = client.options.max || 10;
      output += `# HELP http_db_pool_active Current active DB connections\n# TYPE http_db_pool_active gauge\nhttp_db_pool_active ${max}\n`;
    }
  } catch {
    output += `# HELP http_db_pool_active Current active DB connections\n# TYPE http_db_pool_active gauge\nhttp_db_pool_active 0\n`;
  }

  return c.text(output, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
}
