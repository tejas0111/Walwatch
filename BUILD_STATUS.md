# BUILD_STATUS.md — WalWatch Implementation Tracker

Last updated: 2026-07-26T07:00 UTC
Session status: All 29 specs audited against implementation — gaps found and fixed

## Audit Session

Executed a full spec-by-spec audit (07–29) using subagent-driven development.
Each spec was checked against implementation, gaps identified and fixed, then
compilation verified across all 5 packages.

| Batch | Specs | Key Fixes Applied |
|-------|-------|-------------------|
| 1 | 01–06 | (Previous session) Idempotency middleware, wallet unique index, keeper event emission, invariant enforcement |
| 2 | 07–09 | Blob lifecycle transitions (deletedAt, rollback on failure); publisher selection with health/fallback; policy engine inheritance/conflict resolution/autoRenewalEnabled/budgetRef fields added |
| 3 | 10–12 | Scheduler handler registry, missed-run escalation; cost engine soft-vs-hard budget split, estimate staleness; notification engine cross-tenant validation, dedup window, encryption readiness |
| 4 | 13–16 | Dashboard needs-attention merging, data freshness, panel-level error isolation; API cursor pagination, versioning, idempotency scoping, standardized errors; background job retryability classification, stale-job recovery |
| 5 | 17–20 | Encryption at rest (AES-256-GCM), channel secret stripping, operator attribution; activity feed surface, trace IDs, estimate accuracy metrics; 4-class error taxonomy, transient→persistent escalation |
| 6 | 21–24 | (Reference/testing specs — verified, no code changes needed) |
| 7 | 25–29 | State machine alignment (renewal trimmed to 7 transitions, API key rotated→revoked); event catalog cleanup (SPENDING_LIMIT_OVERRIDE → RENEWAL_MANUAL_OVERRIDE); edge cases (wallet disconnect, channel deletion escalation, downgrade enforcement); SDK error shapes + missing type params, CLI confirmations + feature flag commands, experiments API, admin attribution + justification required; admin-scripts event-bus migration; feature flag schema column fix |

## Packages

- **API** (Hono + Drizzle): Routes, engines, middleware, schemas — all specs audited
- **Keeper** (Background worker): Scheduler, notification engine, renewal executor, scanner, publisher selector
- **SDK** (TypeScript client): Types + client methods for all entities; no business logic leak
- **CLI** (Commander): Full command suite with JSON output, destructive confirmations, all entity groups
- **Contracts** (Move): Compiles clean

## Key Milestones

- **25 migration files** (0000–0025) covering all entities + audit fixes
- **All state machines** aligned with Spec 25: blob (10 states), renewal (7 states + manual override), policy (4 states), alert rule/event, webhook, API key, budget, spending limit
- **Event catalog** (Spec 26): 57 events defined in EventBus, all emitted with actor attribution
- **Encryption at rest**: AES-256-GCM for webhook secrets + notification channel credentials
- **Cursor-based pagination** across all list endpoints (keyset pagination, limit+1 hasMore detection)
- **API versioning**: `/api/v1/*` with deprecated `/api/*` compatibility layer
- **Experiments API** (Spec 29): admin CRUD + variant assignment + audit trail
- **Activity Feed** (Spec 18): dedicated table + event bus subscriber, cursor-paginated endpoint
- **Publisher selector** (Spec 08): priority ordering, health checks, project→org fallback

## Module List

### Group 1: Core Foundation (specs 03, 05, 06)
| Module | Spec File(s) | Status | Notes |
|--------|-------------|--------|-------|
| 1. Organization | 03, 05, 06 | `done` | Soft-delete, lifecycle endpoints, role rename, last-owner deletion guard, downgrade enforcement. Mig 0012. |
| 2. Project | 03, 05, 06 | `done` | Soft-delete, archive/restore lifecycle, org-suspended check. Mig 0013. |
| 3. Wallet | 03, 05, 06 | `done` | Soft-delete, projectId unique index (fixed), delegation-revoke, disconnect→tracked. Mig 0014. |
| 4. Policy | 03, 05, 06, 09 | `done` | State machine, scope, inheritance resolution, conflict resolution (Explicit>Specific>Latest>Default), autoRenewalEnabled, budget references. |
| 5. Alert Rule | 03, 05, 06, 12 | `done` | Soft-delete, status lifecycle, dedup window, cross-tenant validation. Mig 0015. |
| 6. Notification Channel | 03, 05, 06, 12 | `done` | Soft-delete, encryption at rest, credential stripping from read endpoints. Mig 0015. |
| 7. API Key | 03, 05, 06, 17 | `done` | Soft-delete, role column, status lifecycle (Created→Active→Rotated→Revoked), immediate revocation. Mig 0015. |

### Group 2: Data Layer & Architecture (specs 04, 05, 14)
| Module | Spec File(s) | Status | Notes |
|--------|-------------|--------|-------|
| 8. Architecture/API | 04, 14 | `done` | Hono app, global idempotency/rate-limit/audit middleware, cursor pagination, API versioning, standardized errors. |
| 9. Data Model Invariants | 05 | `done` | Unique wallet (per-project), no concurrent renewal (DB partial unique index), org chain, immutable cost records. Mig 0018–0022. |
| 10. Audit Event | 03, 05, 18, 26 | `done` | auditLogs table + logAudit middleware + traceId correlation + activity feed subscriber. |

### Group 3: Core Engines (specs 07, 08, 09, 10, 11, 25, 26)
| Module | Spec File(s) | Status | Notes |
|--------|-------------|--------|-------|
| 11. Blob Lifecycle | 07, 03, 25, 26 | `done` | 10-state machine, automatic vs manual enforcement, rollback on failed renewal, soft-delete with deletedAt. |
| 12. Renewal Engine | 08, 03, 25, 26 | `done` | Queue-driven pipeline, budget check before every execution, publisher selection (priority+health+fallback), exponential backoff, individual attempt records, dedup+idempotency. |
| 13. Policy Engine | 09, 03, 05, 25, 26 | `done` | Inheritance resolution (Org→Project→Wallet→Blob/tag), conflict resolution order, deterministic evaluation, system default fallback, policy snapshot. |
| 14. Scheduler | 10, 16 | `done` | DB-backed schedules, handler registry (extensible), advisory-lock cross-instance safety, missed-run detection+escalation, run history, system-enforced min interval. |
| 15. Cost Engine | 11, 05, 25, 26 | `done` | Estimate-before-execute, soft (Budget) vs hard (Spending Limit) enforcement, estimate staleness check, immutable actual costs, wallet-scoped limits. |
| 16. Budget | 03, 11, 25, 26 | `done` | State machine (Defined→Active↔Window_Closed→Archived), soft ceiling (alert+proceed), window rollover, spent tracking from immutable records. |
| 17. Spending Limit | 03, 11, 25, 26 | `done` | State machine (Defined→Active↔Paused→Archived), hard block with reference to specific limit ID, scope enforcement wallet→project→org. |

### Group 4: Delivery & UI (specs 12, 13, 15, 16, 28, 29)
| Module | Spec File(s) | Status | Notes |
|--------|-------------|--------|-------|
| 18. Notification Engine | 12, 03, 16, 26 | `done` | Channel abstraction (email/discord/slack/webhook), tunable dedup, retry with jitter, cross-tenant validation, escalation chain, audit trail. |
| 19. Alert Rule/Event | 03, 12, 25, 26 | `done` | alertRules table, alert event lifecycle (Fired→Delivered/Acknowledged/delivery_failed/escalated), dedup window, noise control. |
| 20. Webhook | 03, 12, 25, 26 | `done` | State machine (Created→Active→Failing→Disabled→Deleted), secret encryption+signed payloads, event dispatch via EventBus. |
| 21. Dashboard Rules | 13, 15 | `done` | GET /dashboard/summary: health rollups, storage, spend vs budget, next-to-expire, combined needs-attention (4 sources), panel-level error isolation, data freshness metadata, empty-state guidance. |
| 22. UI System | 15 | `not_started` | Frontend project (separate). |
| 23. Background Jobs | 16 | `done` | Queue-driven pipeline, restartability (stale-job recovery), retryable vs non-retryable classification, poison-pill isolation, per-job entity tracking, queue latency metrics. |
| 24. CLI | 28 | `done` | Full command suite (all entity groups), JSON output, destructive confirmations, built on SDK. |
| 25. SDK | 28 | `done` | Types + client methods for all entities, structured error classes, fireAndPoll/fireAndAwait, X-API-Version header. |
| 26. Admin/Internal Tools | 29 | `done` | Admin routes (health, queues, trigger-scan, retry-job), feature flags (audited state changes), experiments API (CRUD + assignment + audit). |

### Group 5: Cross-Cutting (specs 17-22)
| Module | Spec File(s) | Status | Notes |
|--------|-------------|--------|-------|
| 27. Security | 17 | `done` | Auth+RBAC, API key hashing, encryption at rest (AES-256-GCM), credential stripping, operator attribution, input validation. |
| 28. Observability | 18 | `done` | Audit logs (immutable, traceId), activity feed (dedicated table+subscriber), operational metrics (per-tenant latency/error rates, estimate accuracy, queue depth). |
| 29. Scalability | 19 | `done` | Stateless components, multi-tenancy invariant, cursor pagination for all list endpoints, incremental processing. |
| 30. Error Handling | 20 | `done` | 4-class taxonomy (Transient/Persistent/Partial/Systemic), retryable classification, transient→persistent escalation, recovery paths, standardized error shape. |
| 31. Testing | 21 | `done` | 71+ unit tests (state-machines, event-bus, error-classification), 3 DB-backed test files, dashboard tests (11 tests). |
| 32. Non-Functional | 22 | `done` | All 5 packages compile clean. Latency guardrails (interactive <1s, dashboard <2s, renewal <30s), data freshness tracking with staleness headers, DR plan documented below. |

### Group 6: Reference (specs 23, 24, 26, 27)
| Module | Spec File(s) | Status | Notes |
|--------|-------------|--------|-------|
| 33. Event Definitions | 26 | `done` | 57 events in EventBus, all carry actor+entity+timestamp, used by webhooks + activity feed. |
| 34. Edge Cases | 27 | `done` | Concurrent policy edit (snapshot), budget window rollover (check stands), wallet disconnect (tracked+alert), member removal (keys independent), publisher failure (on-chain verify), tie-free policy ordering, channel deletion escalation, downgrade enforcement. |
| 35. Decision Rules | 23 | `done` | Reference document — no code required. |

## Disaster Recovery Plan

### Recovery Point Objective (RPO)
- Effectively zero for committed transactions
- PostgreSQL WAL (Write-Ahead Log) archiving ensures no committed transaction is lost
- Synchronous replication between primary and standby nodes

### Recovery Time Objective (RTO)
- **Single-instance failure:** < 5 minutes (automatic failover to standby)
- **Region-level failure:** < 1 hour (manual promotion of cross-region replica)

### Backup Strategy
| Type | Schedule | Retention |
|------|----------|-----------|
| Full backup | Daily | 30 days |
| WAL archiving | Hourly | 30 days |
| Point-in-time recovery | Continuous via WAL | 30-day window |

### Restoration Testing
- Quarterly automated restore verification
- Full backup restoration + WAL replay to a point-in-time
- Validation of data integrity post-restore

### DR Testing Schedule
- **Monthly:** Failover drill (standby promotion and demotion)
- **Quarterly:** Full region failover simulation + restore verification
- **Annually:** Comprehensive DR audit including backup integrity, RPO/RTO measurement, and runbook review

## Legend
- `not_started` — not yet audited or implemented against the new spec
- `in_progress` — actively working on it
- `implemented_untested` — code written but not verified against spec invariants
- `done` — spec Purpose/Invariants/Transitions/Failure-Handling satisfied, 
  tests passing, skill checkpoint(s) passed
