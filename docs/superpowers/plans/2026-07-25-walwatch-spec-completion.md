# WalWatch Spec Completion Implementation Plan

> REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Implement all remaining spec-gap functionality across all 35 Reading Order modules.

**Architecture:** Event-driven extension of existing Hono API + Keeper background worker. Event System (spec 26) is built first as the foundational dependency. Each engine (Scheduler, Webhook, Dashboard) then consumes/produces events through the shared bus.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, Sui SDK, node-cron, TypeScript

## Global Constraints

- Every event carries: name, timestamp, entity type+ID, actor — per spec 26
- Every API response uses standardized error shape per spec 20
- Every DB table has `id` UUID PK, `created_at`, `updated_at`, soft-delete columns
- All routes use `requireAuth` + `requireOrg` + `requireRole` middleware
- All mutations call `logAudit`
- TypeScript strict mode throughout
- All 5 packages must compile with `npx tsc --noEmit`

---

### Task 1: Event System (spec 26)

**Files:**
- Create: `api/src/lib/event-bus.ts`
- Create: `api/src/lib/event-types.ts`
- Create: `api/src/routes/events.ts`
- Modify: `api/src/index.ts` (register events route)
- Modify: `api/src/middleware/audit.ts` (emit events alongside audit logs)
- Modify: `api/src/db/schema.ts` (event_subscriptions table for webhooks)

**Interfaces:**
- Consumes: existing `logAudit` middleware, existing schema tables
- Produces: `EventBus` class, typed event definitions, `/api/events/*` routes

**Architecture:**
- `EventBus` is a singleton that emits typed events to both DB (`event_log` table) and in-process subscribers
- Each event has shape: `{ name: string, timestamp: Date, entityType: string, entityId: string, actor: string, data?: Record<string, unknown> }`
- In-process subscribers (webhook engine, notification engine) register via `EventBus.on(eventName, handler)`
- Events are persisted to `event_log` table for replay/audit
- The 40+ events from spec 26 are defined as string constants in `event-types.ts`

**Migration:** `0017_event_log` — `event_log` table, `event_subscriptions` table

---

### Task 2: Scheduler Engine (spec 10)

**Files:**
- Create: `api/src/routes/schedules.ts`
- Create: `keeper/src/scheduler.ts`
- Modify: `keeper/src/index.ts` (use scheduler instead of raw cron)
- Modify: `api/src/index.ts` (register schedules route)
- Modify: `api/src/db/schema.ts` (schedules table)

**Interfaces:**
- Consumes: EventBus from Task 1
- Produces: DB-backed schedule definitions, missed-run tracking, catch-up logic

**Architecture:**
- `schedules` table: id, orgId, name, type (system/user), cron_expr, last_run_at, last_completed_at, enabled, min_interval_ms
- Scheduler reads schedules from DB, evaluates which are due, enqueues jobs
- Tracks last-completed window per schedule for idempotency
- Emits `schedule.missed`, `schedule.caught_up` events via EventBus

**Migration:** `0018_schedules` — schedules table

---

### Task 3: Webhook Engine (spec 12, 26)

**Files:**
- Create: `keeper/src/webhook-engine.ts`
- Modify: `keeper/src/notification.ts` (integrate DB channels)
- Modify: `keeper/src/db-writer.ts` (webhook delivery tracking)
- Modify: `keeper/src/index.ts` (start webhook engine)

**Interfaces:**
- Consumes: EventBus from Task 1, notification_channels table, EventBus events
- Produces: Webhook delivery with retry, HMAC signing, status tracking

**Architecture:**
- WebhookEngine subscribes to EventBus events
- For each event, looks up matching webhook notification_channels
- POSTs event payload to webhook URL with HMAC-SHA256 signature header
- Retries on failure (3 attempts, exponential backoff)
- Tracks delivery status in `webhook_deliveries` table
- Disables channel after 10 consecutive failures
- Emits `webhook.failing`, `webhook.disabled`, `webhook.reenabled` events

**Migration:** `0019_webhook_deliveries`

---

### Task 4: Blob Lifecycle Enforcement (spec 07, 25)

**Files:**
- Create: `api/src/lib/blob-lifecycle.ts`
- Modify: `api/src/routes/blobs.ts` (use lifecycle state machine)

**Interfaces:**
- Consumes: existing blobRegistrations table, EventBus
- Produces: Enforced state machine with valid/invalid transition rules

**Architecture:**
- `BlobLifecycle` class with `transition(blob, toStatus)` method
- Valid transitions: pending→discovered, discovered→verified, verified→tracked, tracked→protected, protected→expiring, expiring→renewing, renewing→renewed→tracked, tracked/expiring→expired, expired→deleted
- Rejects invalid transitions (e.g. pending→expired) with 422
- Emits events at each transition (blob.discovered, blob.verified, etc.)

---

### Task 5: Dashboard "Needs Attention" Endpoint (spec 13)

**Files:**
- Create: `api/src/routes/dashboard.ts`
- Modify: `api/src/index.ts` (register dashboard route)

**Interfaces:**
- Consumes: existing analytics routes, blob registrations, renewal jobs
- Produces: Aggregated "needs attention" data

**Architecture:**
- `GET /api/dashboard/summary` returns one JSON response with:
  - blob counts by health (healthy/at_risk/expiring/expired)
  - storage under management (total bytes)
  - recent spend vs budget
  - next-to-expire blobs (top 10)
  - failed items needing attention (failed renewals, failed notifications, blocked-by-budget)
- Query-based aggregation, no caching layer yet

---

### Task 6: Renewal Engine Queue-Driven (spec 08)

**Files:**
- Modify: `keeper/src/index.ts` (read from renewal_jobs queue)
- Modify: `keeper/src/executor.ts` (update job status)
- Modify: `api/src/routes/renewal-jobs.ts` (enqueue jobs)

**Interfaces:**
- Consumes: renewal_jobs table, vault-mapper.ts
- Produces: Keeper reads from DB queue instead of scanning chain directly

**Architecture:**
- Keeper scan cycle: reads from `renewal_jobs WHERE status='queued'` instead of scanning chain directly
- Scanner writes due vaults as queued jobs via API
- Executor updates job status: queued→processing→succeeded/failed
- Manual retry/cancel via existing `/renewal-jobs/:id/retry` and `/renewal-jobs/:id/cancel`

---

### Task 7: Admin Tools (spec 29)

**Files:**
- Create: `api/src/routes/admin.ts`
- Modify: `api/src/index.ts` (register admin routes)

**Architecture:**
- `GET /api/admin/health` — system health check
- `GET /api/admin/metrics` — operational metrics
- `GET /api/admin/queues` — queue depth per job type
- `POST /api/admin/trigger-scan` — manual scan cycle trigger
- `requireRole('admin')` only — defined in spec as owner-level access

---

### Task 8: Edge Cases and Decision Rules (specs 23, 27)

**Files:**
- Create: `specs/.process/edge_cases.md`
- Create: `specs/.process/decision_rules.md`

These are reference documents, not code. Write them based on patterns already established in the codebase and spec.

---

### Task 9: Testing (spec 21)

- Write tests for each new component following existing patterns
- 7 categories: unit correctness, state machine, idempotency, multi-tenancy isolation, permission resolution, failure injection, scale/performance
- Integration tests blocked (no Docker) — unit and mocking tests only

---

## Self-Review Checklist

- Spec 07 (Blob Lifecycle): Task 4 — state machine enforcement
- Spec 08 (Renewal Engine): Task 6 — queue-driven processing
- Spec 10 (Scheduler): Task 2 — DB-backed declarative schedules
- Spec 12 (Notification/Webhook): Task 3 — webhook engine
- Spec 13 (Dashboard Rules): Task 5 — aggregation endpoint
- Spec 15 (UI System): NOT covered — frontend is separate project
- Spec 19 (Scalability): Architectural principles already followed
- Spec 21 (Testing): Task 9 — test coverage
- Spec 22 (Non-Functional): Deferred — requires perf testing infra
- Spec 23 (Decision Rules): Task 8 — reference doc
- Spec 24: N/A
- Spec 25 (State Machines): Task 4 — blob lifecycle enforcement
- Spec 26 (Event Definitions): Task 1 — event system
- Spec 27 (Edge Cases): Task 8 — reference doc
- Spec 28 (CLI/SDK): Already implemented
- Spec 29 (Admin/Internal Tools): Task 7 — admin routes
