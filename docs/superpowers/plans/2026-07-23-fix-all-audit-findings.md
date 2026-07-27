# Fix All Audit Findings Implementation Plan

> Use dispatching-parallel-agents to fix independently

**Goal:** Fix all HIGH/MEDIUM severity issues found across architecture audit, security re-audit, and code review

**Domains (independent, parallel):**
1. API Auth & Enumeration (6 fixes)
2. API Infrastructure (2 fixes)
3. Keeper (4 fixes)
4. UI + SDK + CLI (4 fixes)
5. GitHub Actions / Infra (2 fixes)

---

### Domain 1: API Auth & Enumeration Fixes

**Files:** `api/src/services/auth-service.ts`, `api/src/routes/orgs.ts`, `api/src/routes/auth.ts`, `api/src/middleware/auth.ts`, `api/src/config.ts`, `api/src/routes/blobs.ts`

- [ ] Fix VULN-001: Registration returns generic message instead of `'Email already registered'`
- [ ] Fix VULN-002: Org invite returns 404 for unregistered vs 409 for registered — make consistent
- [ ] Fix VULN-004: Rate limiter uses `x-forwarded-for` spoofable — use socket remote addr behind trusted proxy
- [ ] Fix VULN-006: Implement token blacklist for logout (add `invalidated_tokens` table or use `sessions` table)
- [ ] Fix VULN-009: `validateConfig()` checks ALL envs, not just production
- [ ] Fix VULN-011: PATCH blobs strip `status` from update schema for developer role

### Domain 2: API Infrastructure Fixes

**Files:** `api/src/db/index.ts`, `api/src/routes/vaults.ts`

- [ ] Fix unbounded pagination: add `Math.min(100, Math.max(1, limit))` to vault history
- [ ] Fix global DB singleton: use Hono `c.set('db', ...)` request-scoped pattern

### Domain 3: Keeper Fixes

**Files:** `keeper/src/index.ts`, `keeper/src/leader.ts`, `keeper/src/executor.ts`, `keeper/src/db.ts`

- [ ] Fix metrics server: call `startMetricsServer()` in `main()`
- [ ] Fix private key: load from AWS Secrets Manager instead of plaintext env var
- [ ] Fix leader table: add index on `(lock_id, acquired_at)`, clean stale rows
- [ ] Fix FeeConfig finder: filter by `PACKAGE_ID` prefix

### Domain 4: UI + SDK + CLI Fixes

**Files:** `ui/package.json`, `ui/app/dashboard/vaults/[id]/page.tsx`, `sdk/src/client.ts`, `cli/src/config.ts`

- [ ] Fix `@mysten/sui.js` v0.54.1 → `@mysten/sui` v1.x (match dapp-kit dep)
- [ ] Fix vault detail page: replace mock data with API calls
- [ ] Fix SDK: add typed error classes (WalwatchAuthError, WalwatchValidationError, WalwatchNetworkError)
- [ ] Fix CLI: add `chmod 600` on config file after writing

### Domain 5: GitHub Actions / Infra Fixes

**Files:** `.github/workflows/api.yml`, `.github/workflows/keeper.yml`, `infra/main.tf`

- [ ] Fix GHA: add `permissions: contents: read` to workflows
- [ ] Fix RDS: add `publicly_accessible = false` and `vpc_security_group_ids`
