# Phase 6: Engine Fixes & Scheduling

> **For implementers:** Part of the master plan. Depends on Phase 1. Parallel to Phases 2–5.

**Goal:** Fix budget check in scan cycle, consume publisherPriorityOverride, eliminate duplicate budget check logic, add per-policy retry config, add policy preview endpoint, remove dead code, fix scheduler catch-up, add priority-based queuing, critical schedule escalation, cost estimate staleness, simulation endpoint, spending-limit override.

---

### Task 6.1: Budget check in scan cycle before on-chain write

**Files:**
- Modify: `keeper/src/index.ts`

**Changes:**
In the scan cycle's renewal execution path (where `executor.executeRenewal(vault)` is called directly), add a budget check call before it. Use the existing `checkBudgetBeforeRenewal` from executor or delegate to `costEngine.checkBudgetBeforeExecution`. If the budget check blocks, emit the appropriate event and skip that vault rather than attempting the on-chain write.

- [ ] **Implement:** Add budget check before scan-cycle renewal execution
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: add budget check before scan-cycle on-chain write"`

---

### Task 6.2: publisherPriorityOverride consumed in renewal path

**Files:**
- Modify: `keeper/src/publisher-selector.ts`
- Modify: `keeper/src/executor.ts`
- Modify: `keeper/src/index.ts`

**Changes:**
Thread the resolved policy's `publisherPriorityOverride` through:
1. `resolvePublisherForRenewal()` receives optional `publisherPriorityOverride` param
2. If provided, use it as the preferred publisher priority instead of the project default
3. Fall back to project-level publisher assignment if override is null or the preferred publisher is unhealthy

- [ ] **Implement:** Thread publisherPriorityOverride through renewal path
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: consume publisherPriorityOverride from resolved policy"`

---

### Task 6.3: Eliminate duplicate budget check logic

**Files:**
- Modify: `keeper/src/executor.ts`
- Modify: `api/src/lib/cost-engine.ts`

**Changes:**
Refactor `executor.ts:checkBudgetBeforeRenewal` to delegate to `costEngine.checkBudgetBeforeExecution`. Remove the duplicated `BudgetCheckResult` type and budget/spending-limit queries from executor. Ensure both paths (queue-based and scan-cycle) call the same centralized budget check function.

- [ ] **Implement:** Delegate executor budget check to cost-engine
- [ ] **Compile:** `cd keeper && npx tsc --noEmit && cd ../api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "refactor: eliminate duplicate budget check logic"`

---

### Task 6.4: Per-policy retry configuration

**Files:**
- Modify: `api/src/db/schema.ts` (policies table)
- Create: migration file 0034
- Modify: `api/src/lib/policy-engine.ts`
- Modify: `keeper/src/index.ts`

**Changes:**
1. Add `max_retries` column to `policies` table (default 5).
2. Include `maxRetries` in `ResolvedPolicy` type.
3. When creating renewal jobs, propagate the policy's `maxRetries` to the job's `maxAttempts`.
4. Allow user to configure via `PATCH /policies/:id`.

- [ ] **Implement:** Schema, migration, propagation to renewal jobs
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add per-policy retry configuration"`

---

### Task 6.5: Policy preview endpoint

**Files:**
- Modify: `api/src/routes/policies.ts`

**Changes:**
Add `POST /policies/resolve` endpoint that accepts `{ orgId, projectId, walletId?, tags? }` and returns the effective policy without requiring a blob registration. Uses `policyEngine.resolveFromScope()` or similar to preview inheritance resolution.

- [ ] **Implement:** Preview endpoint
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add policy preview endpoint"`

---

### Task 6.6: Remove dead policyMatchesScope code

**Files:**
- Modify: `api/src/lib/policy-engine.ts`

**Changes:**
Remove the private method `policyMatchesScope` (lines ~243-249) which is never called anywhere. Also verify there are no other dead code paths.

- [ ] **Implement:** Remove dead code
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "chore: remove dead policyMatchesScope method"`

---

### Task 6.7: Scheduler catch-up ALL missed windows

**Files:**
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Replace the single-window catch-up in `handleMissedRuns` with a loop that catches up ALL missed windows, up to a configurable batch limit (e.g., 50). Compute the number of missed windows from `last_completed_at` and `interval`, then queue catch-up jobs for each in reverse chronological order (most recent first).

- [ ] **Implement:** Multi-window catch-up with batch limit
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: scheduler catch-up handles all missed windows"`

---

### Task 6.8: Priority-based catch-up queuing

**Files:**
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Instead of executing catch-up jobs inline (same priority as real-time jobs), queue them with lower priority using the job queue from Phase 3. Non-critical catch-ups (user schedules) get lower priority than critical system schedules.

- [ ] **Implement:** Priority-based catch-up queuing
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: priority-based catch-up job queuing"`

---

### Task 6.9: Missed-run escalation distinguishes critical vs. non-critical

**Files:**
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Add a `critical` flag to schedule definitions. Only system-defined critical schedules (expiry checks, budget rollover) trigger operational alerts when missed. Non-critical schedules (user discovery scans) log a warning but don't escalate. Make `MISSED_WINDOW_ESCALATION_THRESHOLD` higher for non-critical (e.g., 10 instead of 3).

- [ ] **Implement:** Critical flag, differentiated escalation
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: missed-run escalation distinguishes critical schedules"`

---

### Task 6.10: Estimate staleness & confidence metadata

**Files:**
- Modify: `api/src/lib/cost-engine.ts`

**Changes:**
Add a staleness computation to `CostEstimate`: if the estimate was computed more than N blocks ago, mark it as `stale`. Add a `confidence` field (`'fresh' | 'stale' | 'recomputed'`). Expose `stalenessMs` as actual duration since computation, not always 0.

- [ ] **Implement:** Staleness computation, confidence metadata
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add estimate staleness and confidence metadata"`

---

### Task 6.11: Simulation endpoint

**Files:**
- Create: `api/src/routes/cost-engine.ts` (if not exists) or add to existing
- Modify: `api/src/index.ts` (register route)

**Changes:**
Add `POST /cost-engine/simulate` that accepts `{ blobIds: string[], policyId?: string }` and returns estimated costs using the same logic as `estimateRenewalCost()`. Response must be explicitly labeled as `{ simulation: true, estimate: {...} }` to distinguish from real estimates.

- [ ] **Implement:** Simulation endpoint
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add cost simulation endpoint"`

---

### Task 6.12: Spending-limit override mechanism

**Files:**
- Modify: `api/src/routes/renewal-jobs.ts` (or admin.ts)
- Modify: `api/src/lib/cost-engine.ts`

**Changes:**
Add `POST /renewal-jobs/:id/override` endpoint that:
1. Records the override as an audited action (who, when, why justification)
2. Creates a new superseding renewal job that bypasses the spending limit check
3. Writes a prominent activity feed entry linking the override to the unblocked renewal
4. Emits an event

- [ ] **Implement:** Override endpoint, audit, activity feed, event
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add spending-limit override mechanism"`
