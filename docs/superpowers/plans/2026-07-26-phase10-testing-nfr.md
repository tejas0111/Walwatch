# Phase 10: Testing & Non-Functional Requirements

> **For implementers:** Part of the master plan. Depends on Phases 1–9 (all features implemented before testing). Last phase.

**Goal:** Add state machine tests for 7 untested machines, idempotency/concurrency tests, multi-tenancy isolation tests, failure-injection tests, scale/performance tests, permission resolution tests, fix userFacingMessage test. Add latency guardrails, data freshness enforcement, DR plan documentation, and backup strategy.

---

### Task 10.1: State machine tests (7 untested machines)

**Files:**
- Modify: `api/src/__tests__/state-machines.test.ts`

**Changes:**
Add test suites for these state machines (currently registered but untested):
- **Policy**: states `active→paused→active`, `active→archived`; test valid and invalid transitions
- **Webhook**: states `created→active→failing→disabled`, `disabled→active`
- **Schedule**: states `active→paused→active`
- **Organization**: states `active→suspended→active`, `active→deleted`
- **Project**: states `active→archived→active`, `active→deleted`
- **Wallet**: states `active→delegation_revoked→active`, `active→deleted`
- **Notification**: states `queued→sent→delivered`, `sent→failed`

Each suite tests: every allowed transition, every forbidden transition, and that unknown transitions throw.

- [ ] **Implement:** Tests for 7 untested state machines
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/state-machines.test.ts`
- [ ] **Commit:** `git commit -m "test: add state machine tests for 7 untested machines"`

---

### Task 10.2: Idempotency/concurrency tests

**Files:**
- Create: `api/src/__tests__/idempotency.test.ts`

**Changes:**
Write tests proving:
1. Same idempotency key → same response (no duplicate execution)
2. Different idempotency key → new execution
3. Concurrent requests with same key → only one execution (lock-based)
4. Idempotency key expires after TTL → new execution allowed
5. Different actors with same key → no collision (scoped by actor)

These tests should mock the DB and verify that the idempotency middleware correctly returns cached responses for repeat keys.

- [ ] **Implement:** Idempotency/concurrency tests
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/idempotency.test.ts`
- [ ] **Commit:** `git commit -m "test: add idempotency and concurrency tests"`

---

### Task 10.3: Multi-tenancy isolation tests

**Files:**
- Create: `api/src/__tests__/tenancy.test.ts`

**Changes:**
Write tests proving:
1. Org A cannot access Org B's resources
2. Project-level scoping correctly restricts within org
3. Adversarial test: attempt cross-tenant access via modified orgId in URL
4. Deleted org resources are inaccessible
5. Archived project resources are inaccessible

Mock the auth middleware to simulate different org contexts and verify data isolation.

- [ ] **Implement:** Multi-tenancy isolation tests
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/tenancy.test.ts`
- [ ] **Commit:** `git commit -m "test: add multi-tenancy isolation tests"`

---

### Task 10.4: Failure-injection tests

**Files:**
- Create: `api/src/__tests__/failure-injection.test.ts`

**Changes:**
Write tests that deliberately fail external dependencies and verify:
1. Publisher failure → fallback to next publisher in priority
2. Notification channel failure → escalation chain activates
3. Database connection error → proper error classification (Transient)
4. Network timeout during renewal → proper retry behavior
5. Rate limit exceeded → proper 429 response

Use dependency injection or mock fixtures to simulate failures.

- [ ] **Implement:** Failure-injection tests
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/failure-injection.test.ts`
- [ ] **Commit:** `git commit -m "test: add failure-injection tests"`

---

### Task 10.5: Scale/performance tests

**Files:**
- Create: `api/src/__tests__/performance.test.ts`

**Changes:**
Write basic performance tests against realistic data volumes:
1. Dashboard summary with 10K blobs under management
2. List endpoints with cursor pagination at high page counts
3. Policy resolution for blob in deep hierarchy
4. Cost estimation for batch of 100 blobs

These are smoke tests (not production benchmarks) that verify the system doesn't have obvious O(n²) or N+1 query issues.

- [ ] **Implement:** Scale/performance smoke tests
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/performance.test.ts`
- [ ] **Commit:** `git commit -m "test: add scale and performance smoke tests"`

---

### Task 10.6: Permission resolution tests

**Files:**
- Create: `api/src/__tests__/permissions.test.ts`

**Changes:**
Write tests covering:
1. Every role/capability-grant combination
2. "No permission check ever fails open" invariant
3. Project-level role overrides org-level role
4. Team membership additive permissions
5. API key permission is bounded by creator (cannot exceed)
6. Viewer read-only on all scoped resources
7. Audit log access separately grantable
8. Owner cannot be removed if last owner

- [ ] **Implement:** Permission resolution tests
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/permissions.test.ts`
- [ ] **Commit:** `git commit -m "test: add permission resolution tests"`

---

### Task 10.7: Fix userFacingMessage test

**Files:**
- Already fixed in Phase 8, verify it passes

- [ ] **Verify:** `cd api && npx vitest run api/src/__tests__/error-classification.test.ts`
- [ ] **Commit:** `git commit -m "fix: userFacingMessage returns default for unclassified errors"` (if not already committed)

---

### Task 10.8: Latency guardrails

**Files:**
- Create: `keeper/src/latency-monitor.ts`

**Changes:**
Implement a latency monitoring module that:
1. Measures p50/p95/p99 latency for key operations (renewal execution, dashboard queries, policy resolution)
2. Logs warnings when latency exceeds defined thresholds
3. Emits events when SLO violations are detected

Thresholds (from spec 22): interactive reads < 1s, dashboard load < 2s, renewal execution < 30s.

- [ ] **Implement:** Latency monitoring and alerting
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add latency monitoring with SLO guardrails"`

---

### Task 10.9: Data freshness enforcement

**Files:**
- Modify: `api/src/routes/dashboard.ts`
- Modify: `api/src/lib/stores/dashboard-store.ts` (if exists)

**Changes:**
Implement actual data freshness tracking:
1. Add `computedAt` timestamp to cached dashboard data
2. Staleness is computed as `now() - computedAt`
3. Bounded freshness: if staleness > max acceptable age, return 503 or serve stale with warning header
4. Configurable max staleness per dashboard panel type
5. Remove the `cacheLayer: 'direct_db'` stub

- [ ] **Implement:** Data freshness tracking and enforcement
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add data freshness enforcement to dashboard"`

---

### Task 10.10: DR/RTO/RPO plan documentation

**Files:**
- Modify: `BUILD_STATUS.md`

**Changes:**
Document the disaster recovery plan:
- RPO: effectively zero for committed transactions (PostgreSQL WAL + synchronous replication)
- RTO: < 5 minutes for single-instance failure (auto-failover), < 1 hour for region-level failure
- Backup strategy: daily full backups, hourly WAL archiving, 30-day retention
- Restoration testing: quarterly automated restore verification
- Document in BUILD_STATUS.md or a new DR.md

- [ ] **Implement:** DR plan documentation
- [ ] **Commit:** `git commit -m "docs: add disaster recovery plan"`

---

### Task 10.11: Final security review

**Files:**
- All files modified across all 10 phases

- [ ] **Run:** security-review skill against all modified files
- [ ] **Address:** Any HIGH/MEDIUM confidence findings
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit && cd ../sdk && npx tsc --noEmit && cd ../cli && npx tsc --noEmit`
- [ ] **Test:** `cd api && npx vitest run`
- [ ] **Commit:** any remaining fixes
