# WalWatch Feature Gaps — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan phase-by-phase, task-by-task. Each phase is a separate sub-plan file. Use security-review skill at Phase 7 and final review.

**Goal:** Implement all 60+ missing feature gaps identified across specs 01–29, transforming the codebase from bug-fixed prototype to spec-complete production system.

**Architecture:** 10 independent phases organized by dependency. Phases 1–2 (Foundation & Data Integrity) first. Phases 3–4 (Jobs & Events) next. Phases 5–8 (Automation, Engines, Security, Observability) in parallel after their dependencies. Phases 9–10 (API/CLI, Testing) last.

**Tech Stack:** Hono + Drizzle ORM (PostgreSQL), Commander CLI, TypeScript SDK, in-memory EventBus (to be upgraded), in-memory JobMonitor (to be persisted)

---

## Phase 1: State Machine Completeness & Missing Endpoints

**Sub-plan:** `2026-07-26-phase1-state-machines.md`

**Depends on:** Nothing
**Parallelizable:** Yes

| Task | Gap | Files |
|------|-----|-------|
| 1.1 | Register Organization state machine | `api/src/lib/state-machine.ts`, routes |
| 1.2 | Register Project state machine | `api/src/lib/state-machine.ts`, routes |
| 1.3 | Register Wallet state machine | `api/src/lib/state-machine.ts`, routes |
| 1.4 | Register Notification state machine | `api/src/lib/state-machine.ts` |
| 1.5 | Add SpendingLimit activate/pause endpoints | `api/src/routes/spending-limits.ts` |
| 1.6 | Add API Key rotate endpoint | `api/src/routes/api-keys.ts` |
| 1.7 | Add AlertEvent escalate endpoint | `api/src/routes/alerts.ts` |
| 1.8 | Add Schedule pause/activate endpoints | `api/src/routes/schedules.ts` |
| 1.9 | Add Subscription state machine | `api/src/lib/state-machine.ts` |
| 1.10 | Implement ensureNoOrphanedBlobs | `api/src/lib/invariant-check.ts` |
| 1.11 | Soft-delete grace period cleanup job | `keeper/src/` + schedule |

---

## Phase 2: Data Integrity & Audit

**Sub-plan:** `2026-07-26-phase2-data-integrity.md`

**Depends on:** Phase 1
**Parallelizable:** Partially

| Task | Gap | Files |
|------|-----|-------|
| 2.1 | Transactional audit + state changes (wrap in BEGIN/COMMIT) | All route files |
| 2.2 | cost_records ledger table | `api/src/db/schema.ts`, migration |
| 2.3 | Budget spent derived from cost_records | `api/src/lib/cost-engine.ts` |
| 2.4 | DB-level audit log immutability | migration + trigger |
| 2.5 | Spending limit XOR scoping | `api/src/db/schema.ts`, migration, routes |
| 2.6 | Budget window rollover handler | `api/src/lib/cost-engine.ts` |

---

## Phase 3: Background Jobs & Queue

**Sub-plan:** `2026-07-26-phase3-jobs-queue.md`

**Depends on:** Phase 1
**Parallelizable:** Yes (runs parallel to Phase 2)

| Task | Gap | Files |
|------|-----|-------|
| 3.1 | Formal queue abstraction layer | `api/src/lib/background-jobs.ts`, `api/src/lib/queue.ts` |
| 3.2 | job_executions persistent table | `api/src/db/schema.ts`, migration, keeper |
| 3.3 | Job priority system (priority column) | schema, keeper polling query |
| 3.4 | Dead-letter queue isolation | keeper, migration |
| 3.5 | Stale-job recovery with blob state rollback | `keeper/src/index.ts` |

---

## Phase 4: Event Bus & Notifications

**Sub-plan:** `2026-07-26-phase4-events-notifications.md`

**Depends on:** Phase 3 (for durable queue integration)
**Parallelizable:** No (depends on queue)

| Task | Gap | Files |
|------|-----|-------|
| 4.1 | Emit 15 missing events through event bus | `api/src/routes/*.ts`, `keeper/src/` |
| 4.2 | alert_event lifecycle via emit() not raw SQL | `keeper/src/notification-engine.ts` |
| 4.3 | Notification dedup grouping (flapping conditions) | `keeper/src/notification-engine.ts` |
| 4.4 | Multi-level escalation chain | `api/src/db/schema.ts`, notification-engine |
| 4.5 | Delivery failures written to activity_feed | `keeper/src/notification-engine.ts` |
| 4.6 | Durable event bus (PostgreSQL-backed) | `api/src/lib/event-bus.ts` |

---

## Phase 5: Blob Lifecycle Automation

**Sub-plan:** `2026-07-26-phase5-blob-automation.md`

**Depends on:** Phase 1 (state machines registered)
**Parallelizable:** Yes (parallel to Phases 3-4)

| Task | Gap | Files |
|------|-----|-------|
| 5.1 | Automated discovered→verified→tracked pipeline | `keeper/src/scanner.ts`, scheduler |
| 5.2 | Automated tracked↔protected (policy match/unmatch) | `keeper/src/`, policy-engine integration |
| 5.3 | Automated expiring→expired transition | `keeper/src/scheduler.ts` |
| 5.4 | expiry_check uses policy engine inheritance | `keeper/src/scheduler.ts`, `api/src/lib/policy-engine.ts` |

---

## Phase 6: Engine Fixes & Scheduling

**Sub-plan:** `2026-07-26-phase6-engine-fixes.md`

**Depends on:** Phase 1
**Parallelizable:** Yes (parallel to Phases 2-5)

| Task | Gap | Files |
|------|-----|-------|
| 6.1 | Budget check in scan cycle before on-chain write | `keeper/src/index.ts`, `keeper/src/executor.ts` |
| 6.2 | publisherPriorityOverride consumed in renewal path | `keeper/src/publisher-selector.ts`, `keeper/src/executor.ts` |
| 6.3 | Eliminate duplicate budget check logic | `keeper/src/executor.ts`, `api/src/lib/cost-engine.ts` |
| 6.4 | Per-policy retry configuration | `api/src/db/schema.ts`, policy-engine, keeper |
| 6.5 | Policy preview endpoint (hypothetical blob) | `api/src/routes/policies.ts` |
| 6.6 | Remove dead policyMatchesScope code | `api/src/lib/policy-engine.ts` |
| 6.7 | Scheduler catch-up ALL missed windows | `keeper/src/scheduler.ts` |
| 6.8 | Priority-based catch-up queuing | `keeper/src/scheduler.ts` |
| 6.9 | Missed-run escalation distinguishes critical | `keeper/src/scheduler.ts` |
| 6.10 | Estimate staleness & confidence metadata | `api/src/lib/cost-engine.ts` |
| 6.11 | Simulation endpoint | `api/src/routes/cost-engine.ts` |
| 6.12 | Spending-limit override mechanism | `api/src/routes/renewal-jobs.ts`, audit |

---

## Phase 7: Security & Permissions

**Sub-plan:** `2026-07-26-phase7-security-permissions.md`

**Depends on:** Phase 1
**Parallelizable:** Yes (parallel to Phases 2-6)

| Task | Gap | Files |
|------|-----|-------|
| 7.1 | Capability grant system (8 grants) | `api/src/db/schema.ts`, migration, `api/src/middleware/auth.ts` |
| 7.2 | Project-level role/permission system | `api/src/db/schema.ts`, migration, routes |
| 7.3 | Permission resolution rules (5 rules) | `api/src/lib/permissions.ts` (new) |
| 7.4 | API key permission bounded by creator | `api/src/routes/api-keys.ts` |
| 7.5 | Viewer role consistency | `api/src/routes/*.ts` audit |
| 7.6 | Service Account role | `api/src/routes/api-keys.ts` |
| 7.7 | Audit log access as separate grant | `api/src/routes/audit-logs.ts`, schema |
| 7.8 | Webhook payload signing (HMAC-SHA256) | `keeper/src/channels/webhook.ts` |
| 7.9 | Secret rotation support | `api/src/lib/encryption.ts`, routes |
| 7.10 | Delegated signing authority | wallet routes, keeper |
| 7.11 | Anomaly/abuse detection | `keeper/src/` |
| 7.12 | Redis-backed rate limiter | `api/src/middleware/rate-limit.ts` |

**Security review checkpoint:** After Task 7.12, run security-review skill against all modified files.

---

## Phase 8: Observability & Error Handling

**Sub-plan:** `2026-07-26-phase8-observability-errors.md`

**Depends on:** Phase 3 (queue for systematic alerting)
**Parallelizable:** Yes (parallel to Phases 5-7)

| Task | Gap | Files |
|------|-----|-------|
| 8.1 | Distributed trace propagation (API→keeper) | `api/src/middleware/request-id.ts`, keeper |
| 8.2 | Systemic error → operational alert | `api/src/lib/errors.ts`, subscriber |
| 8.3 | Recovery paths on Persistent errors | `api/src/lib/error-response.ts` |
| 8.4 | General compensating action framework | `api/src/lib/errors.ts` |
| 8.5 | Fix userFacingMessage regression | `api/src/__tests__/error-classification.test.ts` |

---

## Phase 9: API, CLI & SDK Completeness

**Sub-plan:** `2026-07-26-phase9-api-cli-sdk.md`

**Depends on:** Phases 1-2 (state machines + data integrity)
**Parallelizable:** Yes (can overlap with Phases 6-8)

| Task | Gap | Files |
|------|-----|-------|
| 9.1 | Idempotency scoped per actor+endpoint | `api/src/middleware/idempotency.ts` |
| 9.2 | Offset→cursor pagination on schedule_runs | `api/src/routes/schedules.ts` |
| 9.3 | Deprecated API compatibility (Sunset headers) | `api/src/index.ts` |
| 9.4 | OpenAPI specification | `api/openapi.yaml` (new) |
| 9.5 | Filtering on list endpoints | Multiple route files |
| 9.6 | Activity Feed CLI command | `cli/src/index.ts` |
| 9.7 | CLI renew command triggers renewal | `cli/src/index.ts` |
| 9.8 | Experiments CLI commands | `cli/src/index.ts` |
| 9.9 | Admin metrics/tenants/retry-job CLI commands | `cli/src/index.ts` |
| 9.10 | Spending limit lifecycle CLI commands | `cli/src/index.ts` |
| 9.11 | Budget lifecycle CLI commands | `cli/src/index.ts` |
| 9.12 | Policy lifecycle CLI commands | `cli/src/index.ts` |
| 9.13 | Activity Feed SDK type + method | `sdk/src/types.ts`, `sdk/src/client.ts` |
| 9.14 | Experiments SDK methods | `sdk/src/client.ts` |
| 9.15 | Admin SDK methods (metrics, tenants, retry-job) | `sdk/src/client.ts` |
| 9.16 | Feature flag org-scoping via API | `api/src/routes/feature-flags.ts` |
| 9.17 | Experiment CRUD (create/update/delete) | `api/src/routes/experiments.ts` |
| 9.18 | Admin retry-job budget snapshot | `api/src/lib/admin-actions.ts` |
| 9.19 | Admin support ticket ID tracking | `api/src/routes/admin.ts` |

---

## Phase 10: Testing & Non-Functional

**Sub-plan:** `2026-07-26-phase10-testing-nfr.md`

**Depends on:** Phases 1-9 (all features implemented before testing them)
**Parallelizable:** No (last phase)

| Task | Gap | Files |
|------|-----|-------|
| 10.1 | State machine tests (7 untested machines) | `api/src/__tests__/state-machines.test.ts` |
| 10.2 | Idempotency/concurrency tests | `api/src/__tests__/idempotency.test.ts` (new) |
| 10.3 | Multi-tenancy isolation tests | `api/src/__tests__/tenancy.test.ts` (new) |
| 10.4 | Failure-injection tests | `api/src/__tests__/failure-injection.test.ts` (new) |
| 10.5 | Scale/performance tests | `api/src/__tests__/performance.test.ts` (new) |
| 10.6 | Permission resolution tests | `api/src/__tests__/permissions.test.ts` (new) |
| 10.7 | Fix userFacingMessage test | `api/src/__tests__/error-classification.test.ts` |

---

## Execution Order

```
Phase 1 (Foundation)
  ├── Phase 2 (Data Integrity)
  ├── Phase 3 (Jobs & Queue)
  │     └── Phase 4 (Events & Notifications)
  ├── Phase 5 (Blob Automation)
  ├── Phase 6 (Engine Fixes)
  ├── Phase 7 (Security & Permissions) → Security Review
  │     └── Phase 8 (Observability & Errors)
  └── Phase 9 (API, CLI, SDK)
        └── Phase 10 (Testing & NFR)
```

## Global Constraints

- All 5 packages must compile with `npx tsc --noEmit` after every task
- Existing 71+ unit tests must remain passing
- Follow existing code conventions (Hono routes, Drizzle queries, Commander commands)
- Use `logAudit`/`logAuditSystem` for audit logging
- Use `emit(createEvent(...))` for event bus emissions
- Use standardized error shapes with `requestId` and `failureClass`
- Security review must pass before Phase 7 is considered complete
- Commit after each task with descriptive message
