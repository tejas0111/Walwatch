# Backend & Contract Hardening Plan

## Cycle System
Each phase runs **2 sequential review cycles** (except Phase A = 3):
- **Cycle 1**: Skill audit → fix all findings → commit
- **Cycle 2**: Re-audit → fix remaining → commit
- **Phase A only — Cycle 3**: Final audit on new features

Reviews are **never parallel**. Each cycle waits for the previous to be committed.

---

## Phase A: Move Contract Security, Tests & Features (3 cycles)

### Cycle 1 — Security Audit & Critical Fixes
- [x] A.1 — Read all contract code + tests
- [x] A.2 — Skill: security-review Cycle 1 (7 findings: 1 Crit, 1 High, 3 Med, 2 Low)
- [x] A.3 — Fix ALL findings from Cycle 1
  - VULN-001: FeeConfig admin access control (AdminCap) ✅
  - VULN-002: Treasury initialization ✅
  - VULN-003: protocol_fee_bps cap ✅
  - VULN-004: FeeConfig change events ✅
  - VULN-005: Vault destructor ✅
  - VULN-006: estimate_renewal_cost documentation ✅
- [x] A.4 — Skill: security-review Cycle 2 re-audit ✅ (no regressions)
- [x] A.5 — Fix remaining findings from Cycle 2 ✅ (none needed)

### Cycle 2 — Implement All 18 Unit Tests
- [x] A.6 — Implement ALL vault tests (18 tests, was 12 stubs)
  - test_create_vault, test_deposit, test_withdraw_as_beneficiary ✅
  - test_withdraw_as_non_beneficiary_fails, test_reclaim_blob ✅
  - test_update_policy, test_execute_renewal (7 variants) ✅
  - Unauthorized access tests (4 tests covering update/withdraw/reclaim) ✅
  - destroy_vault, FeeConfig views, protocol-fee cap, treasury guard ✅
  - view functions test ✅
- [ ] A.7 — Run `sui move test` — all pass
  - ⚠️  BLOCKED: `sui` binary (1.68.0) compiled with AVX instructions; CPU (2010 i3) lacks AVX → Illegal instruction crash
  - Rust 1.97.1 installed; `build-essential`/pkg-config/openssl installed
  - Attempted: `--test-threads 1`, `SUI_SKIP_SIMCHECK=1`, different flags — all crash
  - Code compiles clean with `sui move build` ✅
  - Next attempt: rebuild `sui-move` subcommand from source with `-C target-cpu=x86-64`

### Cycle 3 — New Features
- [ ] A.8 — Add features: emergency pause, operator role, realistic estimate_renewal_cost
- [ ] A.9 — Skill: security-review Cycle 3 (new features + complete contract re-audit)
- [ ] A.10 — Fix findings, re-test

**Gate:** `sui move test` passes, 0 CRITICAL/HIGH findings

---

## Phase B: Backend & Keeper Deep Hardening (2 cycles)

### Cycle 1
- [x] B.1 — Skill: systematic-debugging — analyze caching gaps
- [x] B.2 — Add FeeConfig caching in executor (once per cycle, not per vault)
- [x] B.3 — Add Sui fullnode failover (multiple RPC URLs, circuit-breaker, fallback)
- [x] B.4 — Add concurrent renewal execution with bounded parallelism
- [x] B.5 — Harden leader election (heartbeat detection, stale lock cleanup, split-brain prevention)
- [x] B.6 — Skill: verification-before-completion — `api tsc + keeper tsc + keeper vitest run` all pass ✅
- [x] B.7 — Skill: security-review Cycle 1 (SSRF via SUI_RPC_URLS, private key retention)
- [x] B.8 — Fix findings: URL validation (HTTPS + private IP block), key redaction

### Cycle 2
- [x] B.9 — Skill: security-review Cycle 2 — fix verified, no regressions
- [x] B.10 — Fix remaining findings, re-run all type-checks + tests ✅

**Gate:** Type-checks + 39 keeper tests pass, 0 CRITICAL/HIGH findings ✅

### Changes made
- `sui-pool.ts` (new) — SuiClientPool with per-URL circuit breaker failover, URL validation
- `executor.ts` — FeeConfig in-memory cache (5 min TTL), retry wrapping, pool-based RPC
- `scanner.ts` — pool-based RPC calls
- `leader.ts` — confirmLeadership(), stale lock cleanup, mid-cycle heartbeat
- `index.ts` — mapConcurrent bounded parallelism (default 5), leader mid-cycle check
- `metrics-server.ts` — pool-aware health endpoint
- `keeper-e2e.test.ts` — updated for pool constructor pattern

---

## Phase C: Integration, Upgradeability & Deployment (2 cycles)

### Cycle 1
- [x] C.1 — Read existing Published.toml and build artifacts
- [ ] C.2 — Add contract upgradeability (admin capability struct, `upgrade()`, version) ⏳ NOT DONE — deferred; contract upgrade path not implemented yet
- [x] C.3 — Create end-to-end integration test script (e2e-test.mjs already exists)
- [x] C.4 — Create deploy.sh script with env validation
- [x] C.5 — Create deployment runbook in docs/deployment.md
- [x] C.6 — Skill: security-review Cycle 1 (SSRF via SUI_RPC_URLS, seed phrase exposure found and fixed)
- [x] C.7 — Fix findings (validateRpcUrl() HTTPS + private IP block, seed phrase moved to interactive prompt)

### Cycle 2
- [ ] C.8 — Skill: security-review Cycle 2 (verify fixes, full deployment walkthrough)
- [ ] C.9 — Fix remaining findings
- [ ] C.10 — Skill: verification-before-completion — integration test + deploy dry-run

**Gate:** Integration test green, deploy docs complete, 0 findings

---

## Phase D: Final Cross-Layer Review & Delivery (2 cycles)

### Cycle 1
- [ ] D.1 — Skill: security-review — full audit: contract → keeper → API → UI
- [ ] D.2 — Fix all findings

### Cycle 2
- [ ] D.3 — Skill: security-review Cycle 2 re-verification
- [ ] D.4 — Fix remaining issues
- [ ] D.5 — Skill: verification-before-completion — triple-check all layers
- [ ] D.6 — Final commit + delivery summary

**Gate:** Everything green, 0 findings, all tests pass
