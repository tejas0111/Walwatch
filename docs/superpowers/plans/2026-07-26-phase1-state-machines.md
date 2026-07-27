# Phase 1: State Machine Completeness & Missing Endpoints

> **For implementers:** Part of the master plan at `2026-07-26-walwatch-feature-gaps-master.md`. Each task is independent. Use TDD per subagent-driven-development.

**Goal:** Register 4 unregistered state machines, add 4 missing state transition endpoints, add schedule lifecycle endpoints, implement invariant stubs, and add soft-delete cleanup.

---

### Task 1.1: Register Organization state machine

**Files:**
- Modify: `api/src/lib/state-machine.ts`
- Modify: `api/src/routes/orgs.ts`

**Changes:**
1. In `state-machine.ts`, add an `organization` machine with states `active → suspended → deleted`. Valid transitions: `active→suspended`, `suspended→active`, `active→deleted`, `suspended→deleted`. Forbidden: `deleted→*`.
2. In `orgs.ts`, replace ad-hoc status checks with `validateTransition('organization', currentStatus, newStatus)` calls at lines 138-141, 157-159, 186-188.

- [ ] **Implement:** Register `organization` in state machine registry, add `allTransitions` entry, convert route checks
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git add -A && git commit -m "feat: register organization state machine"`

---

### Task 1.2: Register Project state machine

**Files:**
- Modify: `api/src/lib/state-machine.ts`
- Modify: `api/src/routes/projects.ts`

**Changes:**
1. Register `project` machine with states `active → archived → deleted`. Transitions: `active→archived`, `archived→active`, `active→deleted`, `archived→deleted`. Forbidden: `deleted→*`.
2. Replace ad-hoc checks in `projects.ts` at lines 163-164, 186-187, 209.

- [ ] **Implement:** Register project machine, convert route checks
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: register project state machine"`

---

### Task 1.3: Register Wallet state machine

**Files:**
- Modify: `api/src/lib/state-machine.ts`
- Modify: `api/src/routes/wallets.ts`

**Changes:**
1. Register `wallet` machine with states `active → delegation_revoked → deleted`. Transitions: `active→delegation_revoked`, `delegation_revoked→active`, `active→deleted`. Also allow `active→disconnected` if that status exists.
2. Replace ad-hoc checks in `wallets.ts` at lines 127, 143, 159, 185.

- [ ] **Implement:** Register wallet machine, convert route checks
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: register wallet state machine"`

---

### Task 1.4: Register Notification state machine

**Files:**
- Modify: `api/src/lib/state-machine.ts`

**Changes:**
1. The `StateMachineName` type already has `'notification'` at line 28. Register it with states `queued → sent → delivered | failed`. The `queued→sent` is auto, `sent→delivered` on delivery success, `sent→failed` on permanent failure.
2. Wire into `keeper/src/notification-engine.ts` where statuses are set.

- [ ] **Implement:** Register notification machine, wire into notification engine
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: register notification state machine"`

---

### Task 1.5: Add SpendingLimit activate/pause endpoints

**Files:**
- Modify: `api/src/routes/spending-limits.ts`

**Changes:**
Add endpoints:
- `POST /spending-limits/:id/activate` — transitions `defined→active`
- `POST /spending-limits/:id/pause` — transitions `active↔paused`
Both must: validate transition, update DB, log audit, emit event, return updated entity.

- [ ] **Implement:** Add activate and pause endpoints
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add spending limit activate/pause endpoints"`

---

### Task 1.6: Add API Key rotate endpoint

**Files:**
- Modify: `api/src/routes/api-keys.ts`

**Changes:**
Add `POST /api-keys/:id/rotate` — transitions `active→rotated`, generates new key, emits `api_key.rotated` event, logs audit. The old key is immediately invalidated.

- [ ] **Implement:** Add rotate endpoint
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add api key rotate endpoint"`

---

### Task 1.7: Add AlertEvent escalate endpoint

**Files:**
- Modify: `api/src/routes/alerts.ts`

**Changes:**
Add `POST /alert-events/:id/escalate` — transitions `delivery_failed_final→escalated`. Records the escalation step, emits `alert_event.escalated` event. Logs audit.

- [ ] **Implement:** Add escalate endpoint
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add alert event escalate endpoint"`

---

### Task 1.8: Add Schedule pause/activate endpoints

**Files:**
- Modify: `api/src/routes/schedules.ts`

**Changes:**
Add endpoints:
- `POST /schedules/:id/pause` — transitions `active→paused`
- `POST /schedules/:id/activate` — transitions `paused→active`
Must check schedule exists, validate transition, update DB, log audit.

- [ ] **Implement:** Add pause/activate endpoints
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add schedule pause/activate endpoints"`

---

### Task 1.9: Add Subscription state machine

**Files:**
- Modify: `api/src/lib/state-machine.ts`

**Changes:**
Register `subscription` machine with states `free→pro→team→enterprise` (and downgrade path `*→free`). Transitions: `free→pro`, `pro→team`, `team→enterprise`, `*→free`. Wire into billing routes where subscription status is changed.

- [ ] **Implement:** Register subscription machine, wire into billing
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add subscription state machine"`

---

### Task 1.10: Implement ensureNoOrphanedBlobs

**Files:**
- Modify: `api/src/lib/invariant-check.ts`

**Changes:**
Replace the stub `ensureNoOrphanedBlobs` with real implementation: query `blob_registrations LEFT JOIN wallets ON ... WHERE wallets.id IS NULL AND blob_registrations.deleted_at IS NULL`. For each orphan found, transition blob to `archived` and emit an alert event. Log the detection.

- [ ] **Implement:** Replace stub with real orphan detection query
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: implement ensureNoOrphanedBlobs invariant"`

---

### Task 1.11: Soft-delete grace period cleanup job

**Files:**
- Create/Modify: `keeper/src/cleanup-jobs.ts` (new)
- Modify: `keeper/src/index.ts` (register cleanup handler)
- Modify: `api/src/db/schema.ts` (add grace_period_days to entities if missing)

**Changes:**
Create a cleanup job that runs on a schedule: queries soft-deleted records (`deleted_at IS NOT NULL`) where `deleted_at + grace_period < now()` and performs hard deletion (or archival to cold storage). Configurable per entity type. Register as a new schedule in the scheduler.

- [ ] **Implement:** Create cleanup job, register as schedule
- [ ] **Compile:** `cd keeper && npx tsc --noEmit && cd ../api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add soft-delete grace period cleanup job"`
