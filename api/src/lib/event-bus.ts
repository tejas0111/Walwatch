/**
 * Event Bus (spec 26 Event Definitions)
 *
 * Typed event system covering all defined events across the codebase.
 * Provides:
 *   1. Event type definitions matching spec 26 naming (resource.action)
 *   2. In-memory event emitter with subscriber management
 *   3. Database persistence for alert_events
 *   4. Webhook dispatch pipeline
 *
 * Every event carries:
 *   - event name (resource.action)
 *   - timestamp
 *   - target entity type + ID
 *   - actor (human/API-key/system)
 */

import { getDb } from '../db/index.js';
import { alertEvents, webhooks, notifications as notificationsTable, activityFeed, eventLog } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { URL } from 'url';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

// ── Event Name Constants (spec 26) ────────────────────────────

export const EventNames = {
  // Blob events
  BLOB_DISCOVERED: 'blob.discovered',
  BLOB_VERIFIED: 'blob.verified', // TODO: emit this when a verification system is implemented (discovered→verified transition)
  BLOB_TRACKED: 'blob.tracked',
  BLOB_PROTECTED: 'blob.protected',
  BLOB_UNPROTECTED: 'blob.unprotected',
  BLOB_EXPIRING: 'blob.expiring',
  BLOB_RENEWING: 'blob.renewing',
  BLOB_RENEWED: 'blob.renewed',
  BLOB_EXPIRED: 'blob.expired',
  BLOB_ARCHIVED: 'blob.archived',
  BLOB_DELETED: 'blob.deleted',

  // Renewal events
  RENEWAL_ESTIMATED: 'renewal.estimated',
  RENEWAL_STARTED: 'renewal.started',
  RENEWAL_SUCCEEDED: 'renewal.succeeded',
  RENEWAL_RETRYING: 'renewal.retrying',
  RENEWAL_FAILED_FINAL: 'renewal.failed_final',
  RENEWAL_BLOCKED_BY_BUDGET: 'renewal.blocked_by_budget',
  RENEWAL_MANUAL_OVERRIDE: 'renewal.manual_override',
  RENEWAL_OVERRIDE_CREATED: 'renewal.override_created',

  // Policy events
  POLICY_CREATED: 'policy.created',
  POLICY_ACTIVATED: 'policy.activated',
  POLICY_PAUSED: 'policy.paused',
  POLICY_ARCHIVED: 'policy.archived',
  POLICY_THRESHOLD_BREACHED: 'policy.threshold_breached',

  // Budget & cost events
  BUDGET_CREATED: 'budget.created',
  BUDGET_ACTIVATED: 'budget.activated',
  BUDGET_ARCHIVED: 'budget.archived',
  BUDGET_THRESHOLD_CROSSED: 'budget.threshold_crossed',
  BUDGET_WINDOW_CLOSED: 'budget.window_closed',
  BUDGET_WINDOW_ROLLED_OVER: 'budget.window_rolled_over',
  SPENDING_LIMIT_BLOCKED: 'spending_limit.blocked',
  SPENDING_LIMIT_CREATED: 'spending_limit.created',
  SPENDING_LIMIT_ACTIVATED: 'spending_limit.activated',
  SPENDING_LIMIT_PAUSED: 'spending_limit.paused',
  SPENDING_LIMIT_ARCHIVED: 'spending_limit.archived',

  // Alert & notification events
  ALERT_RULE_CREATED: 'alert_rule.created',
  ALERT_RULE_PAUSED: 'alert_rule.paused',
  ALERT_RULE_DELETED: 'alert_rule.deleted',
  ALERT_EVENT_FIRED: 'alert_event.fired',
  ALERT_EVENT_DELIVERED: 'alert_event.delivered',
  ALERT_EVENT_DELIVERY_FAILED: 'alert_event.delivery_failed',
  ALERT_EVENT_ESCALATED: 'alert_event.escalated',
  ALERT_EVENT_ACKNOWLEDGED: 'alert_event.acknowledged',

  // Webhook events
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_FAILING: 'webhook.failing',
  WEBHOOK_DISABLED: 'webhook.disabled',
  WEBHOOK_REENABLED: 'webhook.reenabled',
  WEBHOOK_DELETED: 'webhook.deleted',

  // API Key & Permission events
  API_KEY_CREATED: 'api_key.created',
  API_KEY_ROTATED: 'api_key.rotated',
  API_KEY_REVOKED: 'api_key.revoked',
  MEMBER_INVITED: 'member.invited',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_REMOVED: 'member.removed',
  DELEGATION_GRANTED: 'delegation.granted',
  DELEGATION_REVOKED: 'delegation.revoked',
  DELEGATION_USED: 'delegation.used',

  // Job & System events
  JOB_COMPLETED: 'job.completed',
  JOB_FAILED_FINAL: 'job.failed_final',
  SCHEDULE_MISSED: 'schedule.missed',
  SCHEDULE_MISSED_CRITICAL: 'schedule.missed_critical',
  SCHEDULE_CAUGHT_UP: 'schedule.caught_up',
  SYSTEM_DEGRADED: 'system.degraded',
  SYSTEM_RECOVERED: 'system.recovered',
  SYSTEM_SCAN_TRIGGERED: 'system.scan_triggered',
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];

// ── Actor Types ────────────────────────────────────────────────

export type EventActor =
  | { type: 'system' }
  | { type: 'human'; userId: string }
  | { type: 'api_key'; keyId: string; keyPrefix: string }
  | { type: 'admin'; adminId: string; reason?: string };

// ── Event Payload ──────────────────────────────────────────────

export interface BaseEventPayload {
  eventName: EventName;
  timestamp: string;  // ISO 8601
  actor: EventActor;
  orgId: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  traceId?: string;
}

export type TypedEventPayload<T extends EventName = EventName> = BaseEventPayload & {
  eventName: T;
};

// ── Subscriber Types ───────────────────────────────────────────

export type EventHandler = (event: BaseEventPayload) => Promise<void> | void;

export interface Subscription {
  id: string;
  eventNames: EventName[];
  handler: EventHandler;
  description?: string;
}

// ── Event Bus ──────────────────────────────────────────────────

let subscriptionCounter = 0;
const subscribers = new Map<string, Subscription>();

/**
 * Subscribe to one or more event types.
 * Returns an unsubscribe function.
 */
export function subscribe(
  eventNames: EventName | EventName[],
  handler: EventHandler,
  description?: string,
): () => void {
  const names = Array.isArray(eventNames) ? eventNames : [eventNames];
  const id = `sub_${++subscriptionCounter}`;
  subscribers.set(id, { id, eventNames: names, handler, description });
  return () => { subscribers.delete(id); };
}

/**
 * Emit an event to all matching subscribers.
 * Errors from handlers are caught and logged — they never propagate.
 */
export async function emit(event: BaseEventPayload): Promise<void> {
  // 1. Persist to event_log first (durable log before dispatch)
  try {
    const db = getDb();
    await db.insert(eventLog).values({
      eventName: event.eventName,
      payload: event.details ?? null,
      actorId: event.actor
        ? 'userId' in event.actor ? event.actor.userId
          : 'keyId' in event.actor ? event.actor.keyId
          : 'adminId' in event.actor ? event.actor.adminId
          : null
        : null,
      entityId: event.entityId,
      entityType: event.entityType,
      orgId: event.orgId,
      traceId: event.traceId ?? (event.details?.traceId as string | undefined),
    });
  } catch (err) {
    console.error('Failed to persist event to event_log:', err);
  }

  // 2. Dispatch to subscribers
  const promises: Promise<void>[] = [];
  for (const sub of subscribers.values()) {
    if (sub.eventNames.includes(event.eventName) || sub.eventNames.includes('*' as EventName)) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (err) {
        console.error(`[event-bus] Subscriber ${sub.id} failed for ${event.eventName}:`, err);
      }
    }
  }
  await Promise.allSettled(promises);
}

/**
 * Get all active subscriptions (for introspection/debugging).
 */
export function getSubscriptions(): Subscription[] {
  return Array.from(subscribers.values());
}

/**
 * Clear all subscribers (useful for testing).
 */
export function clearSubscribers(): void {
  subscribers.clear();
}

// ── Webhook Dispatch ───────────────────────────────────────────

const PRIVATE_IP_RANGES = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((r) => r.test(ip));
}

async function isInternalHostname(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return isPrivateIP(hostname);
  try {
    const addresses = await lookup(hostname);
    return isPrivateIP(addresses.address);
  } catch {
    return false;
  }
}

interface WebhookRecord {
  id: string;
  orgId: string;
  url: string;
  secret: string | null;
  events: string[];
  status: string;
}

/**
 * Built-in subscriber: dispatch events to configured webhooks.
 * Activated by calling `startWebhookDispatcher()`.
 */
export async function dispatchToWebhooks(event: BaseEventPayload): Promise<void> {
  try {
    const db = getDb();
    const activeWebhooks = await db.select().from(webhooks)
      .where(
        and(
          eq(webhooks.orgId, event.orgId),
          eq(webhooks.status, 'active'),
          sql`${event.eventName} = ANY(${webhooks.events})`,
        ),
      );

    for (const wh of activeWebhooks) {
      // Fire-and-forget webhook delivery with a timeout
      deliverWebhook(wh, event).catch((err) => {
        console.error(`[event-bus] Webhook ${wh.id} delivery failed:`, err);
      });
    }
  } catch (err) {
    console.error('[event-bus] Webhook dispatch error:', err);
  }
}

async function deliverWebhook(
  wh: WebhookRecord,
  event: BaseEventPayload,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(wh.url);
  } catch {
    console.error(`[event-bus] Webhook ${wh.id} has invalid URL: ${wh.url}`);
    return;
  }

  if (parsed.protocol !== 'https:') {
    console.error(`[event-bus] Webhook ${wh.id} must use HTTPS protocol`);
    return;
  }

  if (await isInternalHostname(parsed.hostname)) {
    console.error(`[event-bus] Webhook ${wh.id} URL must point to an external service`);
    return;
  }

  const payload = JSON.stringify({
    event: event.eventName,
    timestamp: event.timestamp,
    actor: event.actor,
    entity: {
      type: event.entityType,
      id: event.entityId,
    },
    details: event.details || {},
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AutoRenewalKeeper/1.0',
  };

  // HMAC signing for webhook payload verification
  if (wh.secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(wh.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    headers['X-Signature-256'] = sigHex;
  }

  try {
    const response = await fetch(wh.url, {
      method: 'POST',
      headers,
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[event-bus] Webhook ${wh.id} returned ${response.status}`);
      // Track failure count (update the webhook record)
      try {
        const db = getDb();
        await db.update(webhooks)
          .set({
            lastFailureAt: new Date(),
            failureCount: sql`${webhooks.failureCount} + 1`,
          })
          .where(eq(webhooks.id, wh.id));
      } catch { /* best effort */ }
    } else {
      try {
        const db = getDb();
        await db.update(webhooks)
          .set({
            lastSuccessAt: new Date(),
            failureCount: 0,
          })
          .where(eq(webhooks.id, wh.id));
      } catch { /* best effort */ }
    }
  } catch (err) {
    console.error(`[event-bus] Webhook ${wh.id} error:`, err);
  }
}

// ── Persistence ────────────────────────────────────────────────

/**
 * Built-in subscriber: persist events to the alert_events table.
 * Activated by calling `startEventPersistence()`.
 */
export async function persistAlertEvent(event: BaseEventPayload): Promise<void> {
  try {
    const db = getDb();

    // Dedup: skip if already exists (prevents double-write from keeper direct SQL + event bus)
    const message = `${event.entityType}.${event.entityId}: ${event.eventName}`;
    const existing = await db.select({ id: alertEvents.id }).from(alertEvents)
      .where(and(
        eq(alertEvents.eventType, event.eventName),
        eq(alertEvents.orgId, event.orgId),
        eq(alertEvents.message, message),
      )).limit(1).then(r => r[0]);
    if (existing) return;

    // Map event severity based on event name
    const severity = determineSeverity(event.eventName);

    // Create alert_event record
    await db.insert(alertEvents).values({
      orgId: event.orgId,
      eventType: event.eventName,
      severity,
      message,
      details: {
        ...(event.details || {}),
        actor: event.actor,
        entityType: event.entityType,
        entityId: event.entityId,
      },
      status: 'fired',
      firedAt: new Date(event.timestamp),
    });
  } catch (err) {
    console.error('[event-bus] Failed to persist alert event:', err);
  }
}

/**
 * Built-in subscriber: persist events to the activity_feed table (Spec 18).
 * Activated by calling `startEventPersistence()`.
 * This is best-effort — the feed is prunable and NOT a compliance surface.
 */
export async function persistActivityFeed(event: BaseEventPayload): Promise<void> {
  try {
    const db = getDb();

    // Dedup: skip if already exists (prevents double-write from keeper direct SQL + event bus)
    const existing = await db.select({ id: activityFeed.id }).from(activityFeed)
      .where(and(
        eq(activityFeed.action, event.eventName),
        eq(activityFeed.orgId, event.orgId),
        eq(activityFeed.resourceId, event.entityId),
      )).limit(1).then(r => r[0]);
    if (existing) return;

    const summary = buildFeedSummary(event);
    await db.insert(activityFeed).values({
      orgId: event.orgId,
      action: event.eventName,
      resourceType: event.entityType,
      resourceId: event.entityId,
      actorType: event.actor?.type === 'human' ? 'human' : event.actor?.type === 'admin' ? 'admin' : 'system',
      actorId: (event.actor && 'userId' in event.actor ? event.actor.userId : event.actor && 'keyId' in event.actor ? event.actor.keyId : null) as string | null,
      summary,
      details: event.details || {},
      traceId: event.traceId ?? (event.details?.traceId as string | undefined) ?? null,
    });
  } catch (err) {
    console.warn('[event-bus] Activity feed write failed (best-effort):', err);
  }
}

function buildFeedSummary(event: BaseEventPayload): string {
  const resourceLabel = event.entityType.replace(/_/g, ' ');
  const actionWords = event.eventName.replace(/\./g, ' ');
  if (event.details?.name) return `${actionWords} — ${event.details.name}`;
  if (event.details?.address) return `${actionWords} — ${event.details.address}`;
  return `${actionWords} on ${resourceLabel}`;
}

function determineSeverity(eventName: EventName): string {
  if (eventName.includes('failed') || eventName.includes('blocked') ||
      eventName.includes('degraded') || eventName.includes('missed')) {
    return 'error';
  }
  if (eventName.includes('expiring') || eventName.includes('threshold') ||
      eventName.includes('warning') || eventName.includes('failing')) {
    return 'warning';
  }
  if (eventName.includes('deleted') || eventName.includes('revoked') ||
      eventName.includes('removed')) {
    return 'info';
  }
  return 'info';
}

// ── Startup ────────────────────────────────────────────────────

let initialized = false;

/**
 * Initialize the event bus with default subscribers:
 * 1. Webhook dispatch
 * 2. Alert event persistence
 *
 * Safe to call multiple times — only initializes once.
 */
export function initEventBus(): void {
  if (initialized) return;
  initialized = true;

  // Subscribe to ALL events for webhook dispatch
  subscribe('*' as EventName, dispatchToWebhooks, 'Dispatch events to configured webhooks');

  // Subscribe to ALL events for persistence
  subscribe('*' as EventName, persistAlertEvent, 'Persist events to alert_events table');

  // Subscribe to ALL events for activity feed (Spec 18 — Three Distinct Surfaces)
  subscribe('*' as EventName, persistActivityFeed, 'Persist events to activity_feed table');

  console.log('[event-bus] Initialized with webhook dispatch + persistence + activity feed subscribers');
}

// ── Convenience Emitters ───────────────────────────────────────

/**
 * Create a BaseEventPayload with the current timestamp.
 */
export function createEvent(
  eventName: EventName,
  orgId: string,
  entityType: string,
  entityId: string,
  actor: EventActor,
  details?: Record<string, unknown>,
  traceId?: string,
): BaseEventPayload {
  return {
    eventName,
    timestamp: new Date().toISOString(),
    actor,
    orgId,
    entityType,
    entityId,
    details,
    traceId,
  };
}

/**
 * Emit a blob lifecycle event.
 */
export function emitBlobEvent(
  state: 'discovered' | 'verified' | 'tracked' | 'protected' | 'unprotected' | 'expiring' | 'renewing' | 'renewed' | 'expired' | 'archived' | 'deleted',
  orgId: string,
  blobId: string,
  actor: EventActor,
  details?: Record<string, unknown>,
  traceId?: string,
): BaseEventPayload {
  const eventName = `blob.${state}` as EventName;
  const event = createEvent(eventName, orgId, 'blob_registration', blobId, actor, details, traceId);
  emit(event).catch((err) => console.error('[event-bus] emitBlobEvent failed:', err));
  return event;
}

/**
 * Emit a renewal lifecycle event.
 */
export function emitRenewalEvent(
  subState: 'estimated' | 'started' | 'succeeded' | 'retrying' | 'failed_final' | 'blocked_by_budget' | 'manual_override' | 'override_created',
  orgId: string,
  renewalJobId: string,
  actor: EventActor,
  details?: Record<string, unknown>,
  traceId?: string,
): BaseEventPayload {
  const eventName = `renewal.${subState}` as EventName;
  const event = createEvent(eventName, orgId, 'renewal_job', renewalJobId, actor, details, traceId);
  emit(event).catch((err) => console.error('[event-bus] emitRenewalEvent failed:', err));
  return event;
}

export default {
  EventNames,
  subscribe,
  emit,
  emitBlobEvent,
  emitRenewalEvent,
  createEvent,
  initEventBus,
  dispatchToWebhooks,
  persistAlertEvent,
  persistActivityFeed,
  clearSubscribers,
  getSubscriptions,
};
