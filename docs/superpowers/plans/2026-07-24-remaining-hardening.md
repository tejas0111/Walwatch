# Remaining Hardening & Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** Complete remaining contract features (emergency pause, operator role, realistic estimates, upgradeability), harden the API backend, and run cross-layer audits.

**Architecture:** Contract extensions build on existing AdminCap + FeeConfig patterns. API hardening reuses the SuiClientPool from keeper, adds caching, and audits security.

**Tech Stack:** Sui Move (edition 2024.beta), TypeScript (Hono + Drizzle), Node.js

**Plan location:** `docs/superpowers/plans/2026-07-24-remaining-hardening.md`

---

## Phase 1: Contract Features & Upgradeability (3 review cycles)

### Cycle 1 — Emergency Pause + Operator Role

- [ ] 1.1 — Read current contract code (`contracts/sources/vault.move`) and test file
- [ ] 1.2 — Add `PauserCap` key+store struct and `OperatorCap` key+store struct
- [ ] 1.3 — Add `paused: bool` field to `FeeConfig` (pause flag applies globally)
- [ ] 1.4 — Add `emergency_pause()` / `emergency_unpause()` entry functions (gated by PauserCap)
- [ ] 1.5 — Add `add_operator()` / `remove_operator()` (gated by AdminCap)
- [ ] 1.6 — Add `assert_not_paused()` internal helper; call it at the top of `create_vault`, `deposit`, `withdraw`, `reclaim_blob`, `execute_renewal`
- [ ] 1.7 — Emit `Paused` / `Unpaused` / `OperatorAdded` / `OperatorRemoved` events
- [ ] 1.8 — Update `init_for_testing` to also create PauserCap and transfer to sender
- [ ] 1.9 — Add tests: pause/unpause flow, operator can pause but not change fees, unauthorized can't pause, paused vaults reject operations
- [ ] 1.10 — Build: `sui move build`
- [ ] 1.11 — Skill: `security-review` Cycle 1 (pause/operator logic, access control, bypass risks)
- [ ] 1.12 — Fix findings, re-build

**Gate:** Build succeeds, no CRITICAL/HIGH findings in pause/operator audit

### Cycle 2 — Realistic estimate_renewal_cost + Vault Helpers

- [ ] 2.1 — Add `STORAGE_PRICE_PER_EPOCH` constant (replace hardcoded 1_000_000)
- [ ] 2.2 — Make `estimate_renewal_cost` a public function callable off-chain
- [ ] 2.3 — Add `set_storage_price()` gated by AdminCap to adjust per-epoch cost
- [ ] 2.4 — Emit `StoragePriceUpdated` event
- [ ] 2.5 — Add `get_vault_count()` view function (returns count of vaults, using a counter or event-based)
- [ ] 2.6 — Add `set_keeper_fee_dynamic()` that allows percentage-based keeper fee (optional, nice-to-have)
- [ ] 2.7 — Build: `sui move build`
- [ ] 2.8 — Skill: `security-review` Cycle 2 (price manipulation, rounding, overflow)
- [ ] 2.9 — Fix findings, re-build

**Gate:** Build succeeds, no CRITICAL/HIGH findings in price/estimate audit

### Cycle 3 — Contract Upgradeability

- [ ] 3.1 — Read current `Published.toml` and `Move.toml` to understand upgrade setup
- [ ] 3.2 — Add `version: u64` to `FeeConfig` and increment on each admin action
- [ ] 3.3 — Create `upgrade.move` module with `UpgradeCap` admin and compatibility checks
- [ ] 3.4 — Add `migrate()` entry function for post-upgrade data migrations
- [ ] 3.5 — Build: `sui move build`
- [ ] 3.6 — Skill: `security-review` Cycle 3 (upgrade path, versioning, migration safety)
- [ ] 3.7 — Fix findings, re-build
- [ ] 3.8 — Skill: `verification-before-completion` — final build check

**Gate:** Build succeeds, full contract audit green, upgrade path documented

---

## Phase 2: Backend API Hardening (2 review cycles)

### Cycle 1 — API Resilience & Caching

- [ ] 4.1 — Read current API code: `vaultService.ts`, `lib/circuit-breaker.ts`, `lib/retry.ts`, `middleware/rate-limit.ts`
- [ ] 4.2 — Extract `sui-pool.ts` into shared package or symlink so API can use it (or create `api/src/lib/sui-pool.ts` that re-exports from keeper)
- [ ] 4.3 — Update `api/src/services/vaultService.ts` to use `SuiClientPool` instead of raw `SuiClient`
- [ ] 4.4 — Add FeeConfig caching in API (same pattern as executor.ts: in-memory cache with TTL)
- [ ] 4.5 — Replace in-memory rate limiter with Redis-backed or add instance-aware rate limit headers
- [ ] 4.6 — Add request size limits, CORS hardening, security headers (Helmet-style) to API middleware
- [ ] 4.7 — Run type-check: `cd api && npx tsc --noEmit`
- [ ] 4.8 — Skill: `systematic-debugging` — analyze API caching gaps and circuit breaker consolidation
- [ ] 4.9 — Skill: `security-review` Cycle 1 (API surface, auth, rate limiting, CORS, SSRF)
- [ ] 4.10 — Fix findings, re-run type-check

**Gate:** API type-check passes, No CRITICAL/HIGH API findings

### Cycle 2 — API Test Coverage + Verification

- [ ] 5.1 — Add unit tests for `sui-pool.ts` in API context (if separate)
- [ ] 5.2 — Add unit tests for FeeConfig cache in API
- [ ] 5.3 — Add unit tests for rate limiter middleware
- [ ] 5.4 — Run all tests: `cd api && npx vitest run`
- [ ] 5.5 — Skill: `security-review` Cycle 2 (verify fixes, regressions)
- [ ] 5.6 — Fix remaining findings
- [ ] 5.7 — Final type-check + test run

**Gate:** All type-checks pass, API test suite passes

---

## Phase 3: Cross-Layer Integration & Delivery (2 review cycles)

### Cycle 1 — Cross-Layer Audit

- [ ] 6.1 — Read all recent changes: contract → keeper → API → deployment
- [ ] 6.2 — Skill: `security-review` — full cross-layer audit (contract actions vs. keeper logic vs. API exposure)
- [ ] 6.3 — Fix all cross-layer findings
- [ ] 6.4 — Verify e2e-test.mjs against latest contract changes

**Gate:** No cross-layer inconsistency findings

### Cycle 2 — Final Verification & Delivery

- [ ] 7.1 — Full cleanup: remove debug logs, unused imports, fix warnings
- [ ] 7.2 — Final build: `sui move build`
- [ ] 7.3 — Final type-check: keeper + API
- [ ] 7.4 — Final test run: keeper 39 tests, API tests
- [ ] 7.5 — Skill: `verification-before-completion` — all green
- [ ] 7.6 — Final commit with comprehensive message
- [ ] 7.7 — Delivery summary

**Gate:** Everything green, all tests pass, 0 CRITICAL/HIGH findings
