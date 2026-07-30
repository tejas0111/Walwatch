# Phase 4: Event Bus & Notifications

> **For implementers:** Part of the master plan. Depends on Phase 3 for durable queue integration.

**Goal:** Fix 15 events never emitted, move alert_event lifecycle to event bus, implement flapping dedup, multi-level escalation chain, activity feed integration for delivery failures, and PostgreSQL-backed durable event bus.

---

### Task 4.1: Emit 15 missing events through event bus

**Files:**
- Modify: `api/src/routes/orgs.ts` (member events)
- Modify: `api/src/routes/wallets.ts` (delegation events)
- Modify: `api/src/routes/api-keys.ts` (rotation events)
- Modify: `keeper/src/index.ts` (webhook/job/system events)
- Modify: `api/src/lib/event-bus.ts` (add missing EventName constants if needed)

**Changes:**
Add `emit(createEvent(...))` calls for these events that are defined in `EventNames` but never emitted:
- `member.invited` — in `orgs.ts` member invite path
- `member.role_changed` — in `orgs.ts` role change path
- `member.removed` — in `orgs.ts` member removal path
- `delegation.used` — in keeper when delegation is consumed
- `api_key.rotated` — in api-keys.ts rotate endpoint (Task 1.6)
- `job.completed` — in keeper job completion path
- `job.failed_final` — in keeper job failure path
- `system.degraded` — in keeper health check degradation path
- `system.recovered` — in keeper health check recovery path
- `webhook.failing` — in webhook delivery failure path
- `budget.window_rolled_over` — in budget rollover handler (Task 2.6)
- `schedule.missed_critical` — already emitted, verify

- [ ] **Implement:** Add emit() calls for all missing events
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: emit 15 missing events through event bus"`

---

### Task 4.2: alert_event lifecycle via emit() instead of raw SQL

**Files:**
- Modify: `keeper/src/notification-engine.ts`
- Modify: `keeper/src/index.ts`

**Changes:**
Replace raw SQL status updates in notification delivery paths with `emit(createEvent('alert_event.delivered', ...))` and `emit(createEvent('alert_event.delivery_failed', ...))`. The alert event status should be updated through the event bus subscriber, not via direct INSERT/UPDATE.

- [ ] **Implement:** Replace raw SQL with emit() for alert_event lifecycle
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: alert_event lifecycle uses event bus emit()"`

---

### Task 4.3: Notification dedup grouping (flapping conditions)

**Files:**
- Modify: `keeper/src/notification-engine.ts`

**Changes:**
Implement flapping detection: within the dedup window, if the same entity generates alternating alert events (e.g., expiring→renewing→expiring), merge them into a single summary notification: "Blob X flapped between expiring/renewing 3 times in the last 10 minutes". Track flapping state in memory or a small DB table. The tunable dedup window remains configurable.

- [ ] **Implement:** Flapping detection and summary notification
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add notification flapping dedup grouping"`

---

### Task 4.4: Multi-level escalation chain

**Files:**
- Modify: `api/src/db/schema.ts` (alert_rules add escalation_channels)
- Create: migration file 0032
- Modify: `keeper/src/notification-engine.ts`

**Changes:**
1. Add `escalation_channels` column to `alert_rules` (jsonb array of channel IDs in priority order).
2. Implement escalation: primary channel → if failed after max retries → try next channel in escalation list → if all failed → mark as escalated and surface in dashboard.
3. Allow fallback to email if configured and no other channel succeeds.

- [ ] **Implement:** Schema, migration, multi-level escalation logic
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add multi-level notification escalation chain"`

---

### Task 4.5: Delivery failures written to activity_feed

**Files:**
- Modify: `keeper/src/notification-engine.ts`

**Changes:**
After notification delivery failure (after retries exhausted), add `INSERT INTO activity_feed` with: `entity_type: 'notification'`, `entity_id: channel.id`, `event_type: 'delivery_failed'`, `severity: 'error'`, `metadata: { channelType, target, error }`.

- [ ] **Implement:** Add activity_feed write on delivery failure
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: write notification delivery failures to activity_feed"`

---

### Task 4.6: Durable event bus (PostgreSQL-backed)

**Files:**
- Modify: `api/src/lib/event-bus.ts`
- Create: migration file 0033 (event_log table)

**Changes:**
Transform the in-memory EventBus to dual-mode: events are both dispatched to in-memory subscribers AND persisted to an `event_log` table. Add a background consumer that processes persisted events for webhook delivery and activity feed updates. This way, events survive process restart.

The `event_log` table: `id (uuid PK)`, `event_name (text)`, `payload (jsonb)`, `actor_id (text)`, `entity_id (text)`, `entity_type (text)`, `recorded_at (timestamptz)`, `org_id (uuid FK)`, `processed (boolean default false)`.

- [ ] **Implement:** Dual-mode event bus, event_log table, background consumer
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add PostgreSQL-backed durable event bus"`
