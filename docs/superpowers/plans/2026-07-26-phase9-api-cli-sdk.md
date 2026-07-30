# Phase 9: API, CLI & SDK Completeness

> **For implementers:** Part of the master plan. Depends on Phases 1–2 (state machines + data integrity). Parallel to Phases 6–8.

**Goal:** Fix idempotency scoping, pagination, API versioning headers, OpenAPI spec, list filtering. Complete CLI commands (activity feed, experiments, lifecycle commands, admin). Complete SDK types and methods.

---

### Task 9.1: Idempotency scoped per actor+endpoint

**Files:**
- Modify: `api/src/middleware/idempotency.ts`

**Changes:**
Change the idempotency cache key from the raw `Idempotency-Key` header to a composite key: `hash(actorId):method:path:idempotencyKey`. The `actorId` comes from the authenticated user/API key. This prevents two different actors using the same key from colliding.

- [ ] **Implement:** Composite idempotency key
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: scope idempotency keys per actor and endpoint"`

---

### Task 9.2: Offset→cursor pagination on schedule_runs

**Files:**
- Modify: `api/src/routes/schedules.ts`

**Changes:**
Convert `GET /schedules/:id/runs` from offset-based (`page`, `OFFSET`) to cursor-based pagination using `startedAt` + `id` as cursor. Match the pattern used by all other list endpoints. Add `cursor` and `limit` query params, remove `page`.

- [ ] **Implement:** Cursor pagination on schedule_runs
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: schedule_runs uses cursor pagination"`

---

### Task 9.3: Deprecated API compatibility (Sunset headers)

**Files:**
- Modify: `api/src/index.ts`

**Changes:**
Add `Sunset` and `Deprecation` HTTP response headers on the legacy `/api/*` routes. The `Sunset` header indicates when the old endpoint will be removed. The `Deprecation` header with `true` indicates deprecation. Also add `Link rel="deprecation"` pointing to the v1 replacement.

- [ ] **Implement:** Deprecation headers on legacy API routes
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add deprecation headers on legacy API routes"`

---

### Task 9.4: OpenAPI specification

**Files:**
- Create: `api/openapi.yaml`

**Changes:**
Generate/create an OpenAPI 3.0 specification covering all endpoints, request/response schemas, authentication, error formats, and pagination parameters. This should be the source of truth for the API surface.

- [ ] **Implement:** OpenAPI spec
- [ ] **Verify:** Spec is valid (can use `npx @redocly/cli lint` or similar)
- [ ] **Commit:** `git commit -m "docs: add OpenAPI 3.0 specification"`

---

### Task 9.5: Filtering on list endpoints

**Files:**
- Modify: Multiple route files

**Changes:**
Add meaningful filters to these list endpoints:
- `api-keys.ts`: name search (`?name=`), permission/role filter
- `wallets.ts`: type, project, label filter
- `teams.ts`: name filter
- `publishers.ts`: name filter
- `aggregators.ts`: name filter
- `spending-limits.ts`: scope filter, walletId filter
- `invitations.ts`: email, status filter
- `orgs.ts`: name, slug filter

Each filter should be a query parameter with basic validation.

- [ ] **Implement:** Filters on 8 list endpoints
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add filtering on list endpoints"`

---

### Task 9.6: Activity Feed CLI command

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Add `activity-feed` command group with:
- `activity-feed list` — lists recent activity feed entries, supports `--org`, `--limit`, `--cursor`, `--entity-type`
- Output as formatted JSON

- [ ] **Implement:** Activity feed CLI command
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add activity-feed CLI command"`

---

### Task 9.7: CLI renew command triggers renewal

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Currently `walwatch renew` only checks status and tells user to use web UI. Replace with actual renewal trigger: calls `POST /renewal-jobs` (manual renewal endpoint). Include `--blob-id`, `--justification` options. Show job ID and status after triggering.

- [ ] **Implement:** Renew command triggers actual renewal
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: walwatch renew triggers manual renewal"`

---

### Task 9.8: Experiments CLI commands

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Add `experiments` command group:
- `experiments list` — list experiments
- `experiments create <name>` — create experiment
- `experiments get <name>` — get experiment details
- `experiments delete <name>` — delete experiment
- `experiments assign <name> <orgId> <variant>` — assign variant
- `experiments variant <name> <orgId>` — get assigned variant

- [ ] **Implement:** Experiments CLI commands
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add experiments CLI commands"`

---

### Task 9.9: Admin metrics/tenants/retry-job CLI commands

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Add under `admin` command group:
- `admin metrics` — get system metrics
- `admin tenants` — list tenants
- `admin retry-job <jobId>` — retry a failed renewal job

- [ ] **Implement:** Admin CLI commands
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add admin metrics/tenants/retry-job CLI commands"`

---

### Task 9.10: Spending limit lifecycle CLI commands

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Add under `spending-limits` command group:
- `spending-limits list` — already exists
- `spending-limits create` — already exists
- `spending-limits update <id>` — update
- `spending-limits pause <id>` — pause
- `spending-limits activate <id>` — activate
- `spending-limits archive <id>` — archive

- [ ] **Implement:** Spending limit lifecycle CLI commands
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add spending limit lifecycle CLI commands"`

---

### Task 9.11: Budget lifecycle CLI commands

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Add under `budgets` command group:
- `budgets list` — already exists
- `budgets create` — already exists
- `budgets update <id>` — update
- `budgets pause <id>` — pause
- `budgets activate <id>` — activate
- `budgets archive <id>` — archive

- [ ] **Implement:** Budget lifecycle CLI commands
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add budget lifecycle CLI commands"`

---

### Task 9.12: Policy lifecycle CLI commands

**Files:**
- Modify: `cli/src/index.ts`

**Changes:**
Add under `policies` command group:
- `policies list` — already exists
- `policies create` — already exists
- `policies delete <id>` — already exists
- `policies assign` — already exists
- `policies unassign` — already exists
- `policies pause <id>` — pause
- `policies activate <id>` — activate
- `policies archive <id>` — archive

- [ ] **Implement:** Policy lifecycle CLI commands
- [ ] **Compile:** `cd cli && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add policy lifecycle CLI commands"`

---

### Task 9.13: Activity Feed SDK type + method

**Files:**
- Modify: `sdk/src/types.ts`
- Modify: `sdk/src/client.ts`

**Changes:**
1. Add `ActivityFeedEntry` type to `types.ts`: `id`, `entityId`, `entityType`, `eventType`, `severity`, `metadata`, `traceId`, `timestamp`, `actorId`
2. Add `getActivityFeed(params?: { orgId?, entityType?, limit?, cursor? })` method to client
3. Export from index

- [ ] **Implement:** Activity Feed SDK type + method
- [ ] **Compile:** `cd sdk && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add activity feed SDK type and method"`

---

### Task 9.14: Experiments SDK methods

**Files:**
- Modify: `sdk/src/client.ts`

**Changes:**
Add SDK methods:
- `adminListExperiments()` → GET /admin/experiments
- `adminGetExperiment(name)` → GET /admin/experiments/:name
- `adminCreateExperiment(data)` → POST /admin/experiments
- `adminDeleteExperiment(name)` → DELETE /admin/experiments/:name
- `adminAssignExperiment(name, data)` → POST /admin/experiments/:name/assign
- `adminGetVariant(name, orgId)` → GET /admin/experiments/:name/variant

- [ ] **Implement:** Experiments SDK methods
- [ ] **Compile:** `cd sdk && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add experiments SDK methods"`

---

### Task 9.15: Admin SDK methods (metrics, tenants, retry-job)

**Files:**
- Modify: `sdk/src/client.ts`

**Changes:**
Add SDK methods:
- `adminGetMetrics()` → GET /admin/metrics
- `adminListTenants()` → GET /admin/tenants
- `adminRetryRenewalJob(jobId, justification)` → POST /admin/retry-job

- [ ] **Implement:** Admin SDK methods
- [ ] **Compile:** `cd sdk && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add admin SDK methods"`

---

### Task 9.16: Feature flag org-scoping via API

**Files:**
- Modify: `api/src/routes/feature-flags.ts`

**Changes:**
Accept `orgIds` array in POST (create) and PATCH (update) endpoints for feature flags. This allows operators to scope a flag to specific organizations. The `GET /:id/check?orgId=` endpoint already supports org-scoped checking. Add validation that orgIds exist before saving.

- [ ] **Implement:** Feature flag org-scoping in API
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add feature flag org-scoping to API"`

---

### Task 9.17: Experiment CRUD (create/update/delete)

**Files:**
- Modify: `api/src/routes/experiments.ts`

**Changes:**
Add missing CRUD endpoints for experiment definitions:
- `POST /admin/experiments` — create experiment (name, description, variants, targeting rules)
- `PATCH /admin/experiments/:name` — update experiment
- `DELETE /admin/experiments/:name` — delete experiment
- `PATCH /admin/experiments/:name/assign` — change variant assignment (instead of 409)

- [ ] **Implement:** Experiment CRUD endpoints
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add experiment CRUD endpoints"`

---

### Task 9.18: Admin retry-job budget snapshot

**Files:**
- Modify: `api/src/lib/admin-actions.ts`

**Changes:**
When admin retries a renewal job, include a `budgetSnapshot` in the new job's metadata (matching what `renewal-jobs.ts:114` does). This ensures the retry uses the budget state at retry time (already checked), and the snapshot is available for the edge case check.

- [ ] **Implement:** Budget snapshot on admin retry
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: add budget snapshot to admin retry-job"`

---

### Task 9.19: Admin support ticket ID tracking

**Files:**
- Modify: `api/src/routes/admin.ts`

**Changes:**
Add a `ticketId` field to admin action payloads alongside `justification`. When provided, include the ticket ID in audit log entries for admin actions. This enables traceability from support tickets to specific admin actions on tenant data.

- [ ] **Implement:** Support ticket ID field for admin actions
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add support ticket ID tracking for admin actions"`
