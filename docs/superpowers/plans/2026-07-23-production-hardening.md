# WalWatch Production Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every review task MUST use the security-review skill. Every verification MUST use verification-before-completion skill. Every debugging session MUST use systematic-debugging skill.

**Goal:** Make WalWatch (Sui blockchain auto-renewal keeper SaaS) fully production-grade — secure, reliable, type-safe, and deployable.

**Architecture:** TypeScript monorepo with Hono API, Next.js 16 UI, and Node.js keeper service. PostgreSQL via Drizzle ORM. Sui blockchain integration for vault management. All three services must be independently deployable and production-ready.

**Tech Stack:** TypeScript (ESM), Hono, Drizzle ORM, PostgreSQL, Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, Sui SDK (@mysten/sui), Vitest, Zod

## Skills Registry

These skills MUST be used at the indicated points:

| Skill | When to Use | Why |
|-------|-------------|-----|
| **security-review** | Every security audit, every review cycle, before any security claim | OWASP-based methodology prevents false positives |
| **verification-before-completion** | Every time you claim something is "done" or "passes" | No claims without fresh evidence |
| **systematic-debugging** | Every time a test fails or unexpected behavior occurs | Root cause before fix, never guess |
| **subagent-driven-development** | Dispatching implementer/reviewer subagents | Fresh context per task, review loops |
| **writing-plans** | If plan needs revision during execution | Maintain plan accuracy |
| **requesting-code-review** | Final whole-branch review after all phases | Comprehensive quality gate |

## Global Constraints

- ESM modules with `.js` imports throughout
- No `any` types — all interfaces must be properly typed
- No hardcoded URLs, ports, or secrets — all via environment variables
- All API responses use structured `{ error: { message, code } }` format
- All external calls (Sui RPC) must have retry + circuit breaker
- All user input validated with Zod schemas
- All DB queries parameterized (Drizzle handles this)
- Dark-first UI with blue-purple accent theme
- Responsive design: mobile (<768px), tablet (768-1024px), desktop (>1024px)

---

## Phase 1: Critical Security Fixes

**Gate:** **security-review** skill confirms no CRITICAL/HIGH vulnerabilities remain. Use verification-before-completion to verify every claim.

### Task 1.1: JWT & Auth Hardening ✅
- [x] Restrict JWT algorithm to HS256 in verify calls (auth.ts)
- [x] Validate JWT payload shape (userId exists, is string) — no `as` casts
- [x] Add issuer/audience claims to JWT sign and verify
- [x] Broaden JWT_SECRET production check (startsWith prod/staging)
- [x] Map API key permissions to roles instead of hardcoding 'developer'
- [x] Verify: `cd api && npx tsc --noEmit`

### Task 1.2: Authorization Bypass Fixes ✅
- [x] Fix bulk delete authorization bypass in blobs.ts (add org_id filter)
- [x] Add requireOrg to vault routes
- [x] Add wallet-in-org verification for vault operations
- [x] Verify: `cd api && npx tsc --noEmit`

### Task 1.3: Injection Prevention ✅
- [x] Add escapeLike() helper to blobs.ts, audit-logs.ts
- [x] Wrap all ilike() calls with escapeLike()
- [x] Add Sui address regex validation to vaults.ts and wallets.ts
- [x] Validate pagination params (NaN protection)
- [x] Verify: `cd api && npx tsc --noEmit`

### Task 1.4: Infrastructure Security ✅
- [x] Replace spoofable Content-Length check with Hono bodyLimit middleware
- [x] Fix rate limit key to use first x-forwarded-for value only
- [x] Add localhost-only restriction to /metrics endpoint in production
- [x] Remove hardcoded DB password fallback in config.ts
- [x] Fix CORS: skip middleware when no origins configured
- [x] Verify: `cd api && npx tsc --noEmit`

### Task 1.5: Security Review Cycle 1 🔄
- [ ] **SKILL: security-review** — Dispatch security-review skill agent to audit all fixes
- [ ] Fix any findings from security review
- [ ] **SKILL: security-review** — Dispatch security-review skill agent for Cycle 2 verification
- [ ] **SKILL: verification-before-completion** — Verify all CRITICAL/HIGH findings resolved with evidence

---

## Phase 2: Frontend Architecture Repair

**Gate:** TypeScript clean, no double-shell, no hardcoded URLs, no `any` types, all pages handle 4 states (loading/empty/error/success). Use verification-before-completion before claiming each task done.

### Task 2.1: Remove Double-Shell Bug
- [ ] Remove AppShell + Breadcrumbs imports from all 12 dashboard page files
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes

### Task 2.2: Fix P0 Bugs
- [ ] **SKILL: systematic-debugging** — Investigate policies page type mismatch (maxSpend number→string) root cause before fixing
- [ ] Wire new/vault page to real API (currently mock submit)
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes

### Task 2.3: Eliminate Hardcoded URLs
- [ ] Replace all http://localhost:3001 with process.env.NEXT_PUBLIC_API_URL
- [ ] Add api.baseUrl() helper method to api-client.ts
- [ ] Update billing, status, auth pages to use api client
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes

### Task 2.4: Eliminate `any` Types
- [ ] Add proper interfaces for Policy, NotificationChannel, AlertRule in api-client.ts
- [ ] Remove all `as any` casts in wallet-button, auth page, settings page
- [ ] Fix catch(err: any) patterns
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes

### Task 2.5: Code Cleanup
- [ ] Remove hooks/use-api.ts (trivial wrapper, adds no value)
- [ ] Remove dead vaults/error.tsx or add missing /dashboard/vaults route
- [ ] Remove hero-visual.tsx if not used
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes

### Task 2.6: Frontend Review Cycle 1
- [ ] **SKILL: security-review** — Dispatch review agent to scan all dashboard pages for XSS, auth bypass, data leakage
- [ ] Fix any findings
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes, no console.logs, no hardcoded URLs

---

## Phase 3: API Contract Hardening

**Gate:** All endpoints have proper validation, pagination, error handling. No side effects on GET. Consistent response format. Use verification-before-completion before claiming done.

### Task 3.1: Input Validation Audit
- [ ] Add password complexity (uppercase, lowercase, digit, max 128)
- [ ] Add pagination to projects, invoices endpoints
- [ ] Fix audit log endpoint to use consistent pagination
- [ ] **SKILL: verification-before-completion** — Verify: `cd api && npx tsc --noEmit` passes

### Task 3.2: Response Format Consistency
- [ ] Ensure all error responses use { error: { message, code } }
- [ ] Ensure all success responses have consistent shape
- [ ] Fix any endpoints returning raw arrays without wrapping
- [ ] **SKILL: verification-before-completion** — Verify: `cd api && npx tsc --noEmit` passes

### Task 3.3: Error Handling Audit
- [ ] **SKILL: systematic-debugging** — Trace error propagation paths before fixing
- [ ] Wrap all DB operations in try/catch
- [ ] Add proper Hono HTTPException handling in global error handler
- [ ] Ensure audit log failures don't propagate to caller
- [ ] Add timeout to health endpoint checks
- [ ] **SKILL: verification-before-completion** — Verify: `cd api && npx tsc --noEmit` passes

### Task 3.4: Rate Limiting Improvements
- [ ] Add rate limiting to org creation
- [ ] Add rate limiting to vault operations
- [ ] Document rate limit strategy
- [ ] **SKILL: verification-before-completion** — Verify: `cd api && npx tsc --noEmit` passes

### Task 3.5: API Review Cycle 1
- [ ] **SKILL: security-review** — Dispatch review agent to audit all routes for auth, validation, injection
- [ ] Fix any findings
- [ ] **SKILL: security-review** — Dispatch second review for verification
- [ ] **SKILL: verification-before-completion** — Verify all fixes with evidence

---

## Phase 4: Backend Reliability

**Gate:** Keeper metrics don't leak memory. Circuit breaker has proper locking. All external calls have retry+timeout. Health checks accurate. Use verification-before-completion before claiming done.

### Task 4.1: Metrics Memory Management
- [ ] Cap histogram entries in api/metrics.ts (MAX 10000)
- [ ] Cap renewal results array in keeper/metrics.ts
- [ ] Add eviction for errors map in keeper/metrics.ts
- [ ] **SKILL: verification-before-completion** — Verify: `cd keeper && npx tsc --noEmit` passes

### Task 4.2: Circuit Breaker Hardening
- [ ] **SKILL: systematic-debugging** — Analyze TOCTOU race condition root cause before implementing fix
- [ ] Fix TOCTOU race in circuit breaker (add mutex/lock)
- [ ] Limit HALF_OPEN to single probe
- [ ] Apply same fix to both API and keeper circuit breakers
- [ ] **SKILL: verification-before-completion** — Verify both compile clean

### Task 4.3: Keeper Executor Improvements
- [ ] Add jitter to retry backoff (currently linear, should be exponential)
- [ ] Cache SYSTEM_OBJECT_ID in constructor
- [ ] Fix failed on-chain transactions counted as success
- [ ] **SKILL: verification-before-completion** — Verify: `cd keeper && npx tsc --noEmit` passes

### Task 4.4: Vault Service Fixes
- [ ] **SKILL: systematic-debugging** — Trace vault history pagination cursor logic before fixing
- [ ] Fix getVaults to not silently return [] on error
- [ ] Fix vault history pagination (broken cursor logic)
- [ ] Add proper error messages for BigInt parsing
- [ ] **SKILL: verification-before-completion** — Verify: `cd api && npx tsc --noEmit` passes

### Task 4.5: Keeper Tests
- [ ] Run existing keeper tests: `cd keeper && npx vitest run`
- [ ] Fix any failing tests
- [ ] **SKILL: verification-before-completion** — Verify: all 39 tests pass with evidence

### Task 4.6: Backend Review Cycle 1
- [ ] **SKILL: security-review** — Dispatch review agent to audit keeper + services
- [ ] Fix any findings
- [ ] **SKILL: verification-before-completion** — Verify clean type checks across all 3 projects with evidence

---

## Phase 5: Type Safety & Code Quality

**Gate:** Zero `any` types across entire codebase. Zero console.logs. Zero TODO/FIXME. All imports valid. Use verification-before-completion before claiming done.

### Task 5.1: API Type Cleanup
- [ ] Remove all `any` from api-client.ts interfaces
- [ ] Add proper Hono Context types (replace `c: any` in metrics handler)
- [ ] **SKILL: verification-before-completion** — Verify: `cd api && npx tsc --noEmit` passes

### Task 5.2: UI Type Cleanup
- [ ] Remove all `as any` casts across UI
- [ ] Ensure all component props are properly typed
- [ ] **SKILL: verification-before-completion** — Verify: `cd ui && npx tsc --noEmit` passes

### Task 5.3: Dead Code Removal
- [ ] Remove requireProjectOrg middleware (defined but never used)
- [ ] Remove unused imports across codebase
- [ ] Remove any commented-out code
- [ ] **SKILL: verification-before-completion** — Verify all three projects compile clean with evidence

### Task 5.4: Code Quality Pass
- [ ] Remove all console.log statements
- [ ] Remove all TODO/FIXME comments or convert to tracked issues
- [ ] Ensure consistent naming conventions
- [ ] **SKILL: verification-before-completion** — Verify all three projects compile clean with evidence

### Task 5.5: Type Safety Review
- [ ] **SKILL: verification-before-completion** — Full type-check: api, ui, keeper all pass (show output)
- [ ] Review any remaining type issues
- [ ] Final verification with evidence

---

## Phase 6: Production Infrastructure

**Gate:** Config is environment-driven. Monitoring endpoints are protected. Graceful shutdown works. Database pool is configurable. Use verification-before-completion before claiming done.

### Task 6.1: Configuration Hardening
- [ ] Make DB pool max configurable via env var
- [ ] Make metrics histogram cap configurable
- [ ] Document all env vars in README
- [ ] **SKILL: verification-before-completion** — Verify: all configs load correctly with evidence

### Task 6.2: Monitoring Protection
- [ ] Restrict /metrics to localhost in production
- [ ] Fix health check to return 503 for degraded state
- [ ] Add request-id propagation to all responses
- [ ] **SKILL: verification-before-completion** — Verify: health endpoint returns correct status codes with evidence

### Task 6.3: Graceful Shutdown
- [ ] Verify API graceful shutdown (SIGTERM/SIGINT)
- [ ] Verify keeper graceful shutdown
- [ ] Ensure DB connections close properly
- [ ] **SKILL: verification-before-completion** — Verify: startup/shutdown cycle works cleanly with evidence

### Task 6.4: Production Config Review
- [ ] Verify no hardcoded values remain
- [ ] Verify all env vars have defaults or required checks
- [ ] Verify CORS config is production-safe
- [ ] **SKILL: verification-before-completion** — Final config audit with evidence

---

## Phase 7: Deep Review & Final Verification

**Gate:** 2 full review cycles complete. All tests pass. All type checks clean. No security findings. EVERY claim must use verification-before-completion skill with fresh evidence.

### Task 7.1: Security Review Cycle 2
- [ ] **SKILL: security-review** — Dispatch security-review skill for full codebase audit
- [ ] Fix all CRITICAL/HIGH findings
- [ ] **SKILL: security-review** — Re-dispatch for verification
- [ ] **SKILL: verification-before-completion** — All clear with evidence

### Task 7.2: Code Quality Review
- [ ] **SKILL: requesting-code-review** — Dispatch code review across entire codebase
- [ ] Fix all Important findings
- [ ] Re-review until clean
- [ ] **SKILL: verification-before-completion** — All fixes verified with evidence

### Task 7.3: Integration Test
- [ ] **SKILL: verification-before-completion** — Verify API starts and serves health endpoint (show output)
- [ ] **SKILL: verification-before-completion** — Verify UI builds without errors (show output)
- [ ] **SKILL: verification-before-completion** — Verify keeper compiles and starts (show output)
- [ ] **SKILL: verification-before-completion** — Full type-check across all 3 projects (show output)

### Task 7.4: Final Commit
- [ ] Stage all changes
- [ ] Create comprehensive commit message
- [ ] **SKILL: verification-before-completion** — Verify: `git status` shows clean working tree (show output)
- [ ] **SKILL: verification-before-completion** — Verify: all type checks pass (show output)
- [ ] **SKILL: verification-before-completion** — Verify: all tests pass (show output)

---

## Progress Ledger

Track completion in `.superpowers/sdd/progress.md`
