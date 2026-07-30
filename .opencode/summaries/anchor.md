# WalWatch Anchored Summary

## Objective
Build the complete WalWatch platform across all phases: smart contracts (Phase 0), backend API (Phase 1), UI (Phase 2), SDK & CLI (Phase 3), infrastructure (Phase 4), and launch documentation (Phase 5) — then harden security with Sentry's security-review skill.

## Important Project Conventions
- PostgreSQL + Drizzle ORM, Hono framework, JWT + API Key dual auth, Testcontainers for tests, Zod validation, audit logging on all mutations, RBAC (owner/admin/developer/viewer/billing)
- All imports use `.js` extension (ESM)
- Pattern: routes in `api/src/routes/`, middleware in `api/src/middleware/`, services in `api/src/services/`, tests in `api/src/__tests__/`, DB in `api/src/db/`
- UI uses Next.js 16 App Router, React 19, Tailwind CSS v4, framer-motion, @mysten/dapp-kit for wallet connection
- SDK at `sdk/`, CLI at `cli/`, keeper at `keeper/`, infra at `infra/`, contracts at `contracts/`
- Remote origin removed per user request

## Build Status
- **Contracts**: 15/15 Move unit tests pass. `estimate_renewal_cost` reads from `storage_price_per_epoch`. AdminCap pattern for FeeConfig.
- **API**: 115/115 tests, 16 DB tables, 12 resource routes mounted. TypeScript clean.
- **UI**: 16 pages (landing + dashboard + sub-pages), wallet connection, API client lib. No `dangerouslySetInnerHTML`/eval.
- **SDK**: `@walwatch/sdk` with typed client, flat paths, X-Org-Id header, timeout. TypeScript clean.
- **CLI**: 13 command groups, Commander-based, config merge, atomic writes. TypeScript clean.
- **Keeper**: 34/34 tests. Leader election (PG advisory locks), JobMonitor, Prometheus metrics. TypeScript clean.
- **Infra**: Terraform (ECS Fargate + RDS), 5 GitHub Actions workflows, Dockerfile (multi-stage, non-root user). AWS Secrets Manager integration.
- **Docs**: Audit scope doc, testnet dry run plan, public disclosure, mainnet checklist.

## Security Fixes Applied (Sentry security-review skill, HIGH confidence)
### API
- CRITICAL: Default JWT secret `'dev-secret-change-in-production'` → `validateConfig()` throws in production if unset
- CRITICAL: Default DB URL `postgres:postgres` → same `validateConfig()` guard
- HIGH: No auth rate limiting → in-memory limiter (10/15min register, 20/15min login)
- HIGH: JWT `verify()` missing `algorithms` → `{ algorithms: ['HS256'] }` on both calls
- HIGH: API key permissions decorative → `requireOrg` now uses `moreRestrictive()` of key-derived vs membership role
- HIGH: Missing security headers → `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy` added to app

### Keeper + Infra
- CRITICAL: Security group all inbound `0.0.0.0/0` → removed all ingress (outbound-only)
- HIGH: Webhook SSRF → `validateWebhookUrl()` (https-only, blocks private IPs)
- HIGH: Default DB creds fallback `postgres:postgres` → fails hard if `DATABASE_URL` unset
- HIGH: Container runs as root → `USER appuser` in Dockerfile
- HIGH: Secrets in plaintext env vars → AWS Secrets Manager with IAM policy in Terraform
- MEDIUM: RDS password in plaintext variable → `manage_master_user_password = true`

### UI
- Clean — no findings. React auto-escapes JSX, no dangerous patterns.

## Audit Round 2 (2026-07-23) — Security Re-Audit + Architecture + Code Grill
Used skills: understand-anything (architecture analysis), grill-me (code quality), security-review (security depth pass)
5 parallel agents, plan at `docs/superpowers/plans/2026-07-23-fix-all-audit-findings.md`

### Security Depth Pass Fixes
- HIGH: Email enumeration via registration → generic message, always 201
- HIGH: Email enumeration via org invite → consistent 201 for all cases
- HIGH: API key auth zero rate limiting → per-IP + per-key rate limit
- HIGH: Dev creds start outside NODE_ENV=production → validateConfig() checks all envs
- MEDIUM: Rate limiter IP spoofable via x-forwarded-for → leftmost IP + UA hash
- MEDIUM: Unbounded pagination on vault history → Math.min(100, Math.max(1, limit))
- MEDIUM: JWT no revocation → token_blacklist table + jti claim + middleware check
- MEDIUM: PATCH blob developer can change status → stripped for developer role
- MEDIUM: Sui private key in plaintext env → delete env var after load
- MEDIUM: GitHub Actions no permissions block → contents: read on all 5 workflows

### Architecture Pass Fixes
- HIGH: Keeper metrics server never started → added call in main()
- MEDIUM: Leader table no index → CREATE INDEX + stale row cleanup
- MEDIUM: FeeConfig finder takes first result → filter by PACKAGE_ID prefix
- MEDIUM: Global mutable DB singleton → resetDb() pattern
- MEDIUM: @mysten/sui.js v0.54.1 + dapp-kit v1.1.9 incompatible → upgraded to @mysten/sui v1.x
- MEDIUM: Vault detail page hardcoded mock data → API calls + loading/error states
- MEDIUM: SDK no typed errors → WalwatchAuthError, WalwatchValidationError, WalwatchNetworkError
- MEDIUM: CLI config file world-readable → chmod 600 after write
- HIGH: RDS publicly accessible → publicly_accessible=false + vpc_security_group_ids

### Known Remaining (not yet fixed)
- Contracts: estimate_renewal_cost uses static config, not Walrus System pricing
- Infra: API/UI missing from Terraform (only keeper deployed)
- Cross-cutting: No shared types package (duplicated across API/SDK/CLI)
- Architecture: Single PG point of failure, keeper gas wallet SPOF

## Phase 3: SaaS Production Hardening (2026-07-23)
5 parallel agents: UI Overhaul, API Hardening, Keeper Hardening, SDK+CLI Polish, Infra+Docs

### UI — Mature SaaS Frontend (7 new components, 14+ pages enhanced)
- **Design system**: CSS variables (spacing, typography, shadows, colors), animation keyframes, focus-visible styles, prefers-reduced-motion
- **Responsive app shell**: Sidebar collapses to bottom nav on mobile, Escape key drawer close, aria-current on nav links
- **7 reusable components**: `Skeleton` (with SkeletonCard, SkeletonTable), `Toast` (success/error/info/warning + auto-dismiss), `Breadcrumbs`, `EmptyState` (icon+title+desc+action), `Pagination` (page numbers + prev/next + total), `FormField` (label+error+helper), `Button`
- **Loading states**: `app/loading.tsx` (full-page skeleton), `app/dashboard/loading.tsx` (dashboard skeleton)
- **Error boundaries**: `app/error.tsx` (global with error ID + retry), `app/dashboard/error.tsx`
- **Toast system**: `lib/toast-context.tsx` context provider integrated in root layout
- **Accessibility**: aria-labels, aria-current, role attributes (progressbar/switch/tablist/alert/dialog), heading hierarchy (h1→h2→h3), keyboard handlers, htmlFor/id associations, focus-visible outlines
- **14 dashboard pages enhanced** with breadcrumbs, empty states, proper forms, status page created from scratch
- **TypeScript**: zero errors

### API — Production Hardening
- **Request ID tracing**: `middleware/request-id.ts` — UUID v4 per request, X-Request-Id header, included in error responses
- **Compression**: `hono/compress` middleware registered globally
- **Graceful shutdown**: `lib/graceful-shutdown.ts` — SIGTERM/SIGINT handler, close DB, stop accepting, 30s force exit
- **Health check**: `GET /health` — returns status/uptime/db check/version, no auth required, registered before auth middleware
- **Enhanced error handler**: structured JSON (`{error:{message,code,requestId}}`), never exposes stack traces, proper logging
- **Proper CORS**: ALLOWED_ORIGINS from config (comma-separated env var), production-only origins, localhost in dev
- **Rate limit headers**: X-RateLimit-Limit/Remaining/Reset on auth responses

### Keeper — Production Hardening (5 new files)
- **Structured logging**: `logger.ts` with Pino, `KEEPER_PRIVATE_KEY`/`DATABASE_URL` redaction, pretty-printing in dev. All console.* calls replaced across 10 files
- **Circuit breaker**: `circuit-breaker.ts` — CLOSED/HALF_OPEN/OPEN states, configurable threshold (5) + timeout (30s), half-open probe, state transition logging, metrics integration
- **Retry**: `retry.ts` — exponential backoff with jitter, network-error detection, configurable maxRetries(3)/baseDelay(1s)/maxDelay(30s), onRetry callback
- **Graceful shutdown**: SIGTERM/SIGINT handler stops cron/metrics/leader/DB, 30s force-exit, double-shutdown guard
- **Health check**: `GET /health` on metrics server — status/version/uptime/db/suiRpc
- **Enhanced metrics**: circuit breaker transitions/state, retry count, queue depth, notifications by type
- **Fix**: `KEEPER_PRIVATE_KEY` deleted from env after load with comment referencing AWS Secrets Manager
- **Tests**: 34/34 pass, TypeScript clean

### SDK + CLI — Production Polish
- **SDK JSDoc**: every public method documented (@param, @returns, @throws, @example)
- **SDK retry**: `requestWithRetry()` — exponential backoff 1s/2s/4s + jitter, no retry on 4xx
- **SDK types**: `maxRetries` in config
- **CLI spinners**: `ora` on login, register, create vault, check blob
- **CLI colors**: `picocolors` for colored output (cyan/red/green/bold/dim)
- **CLI enhanced help**: examples section on upload/renew/status/policies create
- **CLI tab completion**: `walwatch completion bash|zsh|fish` generates shell completion script
- **CLI new commands**: `config set`, `config get`, `config show`
- **TypeScript**: both SDK and CLI compile clean

### Infra — CloudWatch, Auto-Scaling, Docker Compose
- **CloudWatch alarms**: 5 alarms (ECS CPU/Memory, RDS CPU/Connections, keeper gas), SNS topic + email subscription
- **ECS auto-scaling**: 1–4 tasks, scale up at CPU>70%, scale down at CPU<30% after 10min
- **Docker Compose**: Postgres 16 + API + keeper (profile-gated) with health checks
- **Root .env.example**: all 26 env vars documented across 7 sections (DB, API, Sui, Keeper, Notifications, Monitoring, Explorer)

### Docs — ADRs, Contributing, Testing Guide
- **3 ADRs**: PostgreSQL for state, Sui blockchain for renewals, Leader election for keeper
- **CONTRIBUTING.md**: dev setup, project structure, code style, testing, PR process
- **Integration test guide**: prerequisites, test env setup, full system test, cleanup

## Phase 3b: Dashboard Polish & API Response Fixes (2026-07-27)
14-hour session on `dashboard-polish` branch. Brainstorming → plans → subagent-driven development.

### Root Cause of Runtime Crashes
`api-client.ts` used wrong paths (`/organizations` → `/orgs`), wrong field names (snake_case vs camelCase), and didn't unwrap paginated wrappers. All 12 dashboard pages and 8 settings components were broken at runtime despite passing TypeScript.

### Full API Client Rewrite
- `ui/lib/api-client.ts` completely rewritten: all interfaces use camelCase matching actual API responses
- All 9 list methods unwrap paginated wrappers (`res.blobs`, `res.apiKeys`, `res.wallets`, `res.subscription`, etc.)
- 5 wrong URL paths fixed (channels → `/alerts/channels`, rules → `/alerts/rules`, subscription/invoices → `/billing/subscription` and `/billing/invoices`, vaults, wallets)
- `ApiError` constructor fixed to properly extract `error.message` from both `{ error: "string" }` and `{ error: { message: "..." } }` response shapes (fixed `[object Object]` error)
- All hooks updated — removed `orgId` parameter from all API calls (11 methods across `use-dashboard`, `use-blobs`, `use-wallets`, `use-vaults`)

### Phase 5: Polish & Finesse (completed)
- **5.1 Dark mode CSS**: Removed duplicate `@media (prefers-color-scheme: dark)` and `html.dark:root` blocks — single `.dark` class source of truth (`globals.css`)
- **5.2 Page transitions**: Created `PageTransition` component with framer-motion; applied to all 13 dashboard pages
- **5.3 Accessibility**: `role="alert"` on all error banners; `aria-label` on icon-only buttons; `htmlFor`/`id` associations on form labels
- **5.4 Empty states**: Replaced inline "Welcome" empty state in dashboard overview with shared `EmptyState` component

### Page-Level Fixes (12 dashboard pages + 8 settings components)
- Auth page (`auth/page.tsx`): Stripped team management section, invite modal, and team-related state/functions — focused solely on API keys
- Settings page: Decomposed 1428-line file into 8 focused component files under `ui/components/dashboard/settings/` (profile, organization, team, wallets, api-keys, notifications, billing, danger-zone)
- Vault pages: Replaced mock data with real API data via `api.getVault()` + `api.listVaults()`; vault detail converted to client component with loading/error/not-found states
- Dashboard overview: Migrated to React Query using `useDashboardSummary` + `useRecentBlobs` hooks
- All 12 dashboard pages: Updated for new API signatures (no orgId param, camelCase fields)
- All 8 settings components: Updated for new API signatures
- All pages: Added mobile card fallbacks, touch targets (`min-h-11`), fallback status colors on mobile badges
- Fixed JSX indentation across 11 dashboard page files

### Fixes Beyond Dashboard Polish
- `error.tsx`: Removed nested `<html>`/`<body>` — Next.js 16 renders root error boundary inside root layout's `<body>`
- `org-switcher.tsx`, `app-shell.tsx`: Added `<DropdownMenuGroup>` wrappers around `<DropdownMenuLabel>` (Base UI v2 requirement — missing it causes "MenuGroupContext is missing" console error)
- Database reset required to apply migrations; docker Postgres on localhost:5433 with `walwatch:walwatch_dev`

### Build Status
- **API**: 115/115 tests, TypeScript clean
- **UI**: `npx tsc --noEmit` and `npx next build` both produce 0 errors. All 12 dashboard pages, auth page, settings (8 sub-components), vault (list + detail), error boundaries, loading skeletons compile clean.
- **Contracts/CLI/SDK/Keeper/Infra**: Unchanged from Phase 3

### New/Modified Key Files
- `ui/lib/api-client.ts` — full rewrite: camelCase, unwrapped pagination, correct paths
- `ui/hooks/use-dashboard.ts`, `use-blobs.ts`, `use-wallets.ts`, `use-vaults.ts` — no orgId param
- `ui/app/dashboard/auth/page.tsx` — team management stripped
- `ui/app/dashboard/settings/page.tsx` — ~87 lines (was 1428), imports 8 section components
- `ui/components/dashboard/settings/` — 8 section component files (new)
- `ui/app/error.tsx` — fixed nested `<html>`
- `ui/components/dashboard/org-switcher.tsx`, `app-shell.tsx` — added DropdownMenuGroup wrappers
- `ui/components/dashboard/page-transition.tsx` — new framer-motion page transition
- `.superpowers/sdd/2026-07-27-dashboard-polish/` — SDD workspace (briefs, reports, diffs, progress)

## Autonomous Agent Created: `.opencode/agent/codebase-improver.md`
- **Mode**: `all` (usable as primary or @mentioned subagent)
- **Purpose**: Cycle through architecture, security, code quality, test coverage, and dependency analysis
- **Workflow**: Scan → Verify → Fix/Delegate via subagents → Verify (tsc + tests) → Report
- **Uses skills**: understand, grill-me, security-review, brainstorming, writing-plans, dispatching-parallel-agents, systematic-debugging, verification-before-completion
- **maxSteps**: 100, **temperature**: 0.2
- **Permission**: tsc/vitest/skills/git commands allowed; write/edit/read/grep/glob enabled; web access denied

## Installed Skills & Agents (2026-07-23)
- **obra/superpowers** — all 14 skills installed (brainstorming, systematic-debugging, writing-plans, using-superpowers, requesting-code-review, test-driven-development, etc.)
- **mattpocock/skills@grill-me** (633K installs) — code review grilling
- **lum1104/understand-anything@understand** (1.9K installs) — deep code understanding
- **pr-pm/prpm@creating-opencode-agents** (35 installs) — opencode agent creation
- **getsentry/skills@security-review** — OWASP security audit
- **add:obra/superpowers, getstentry/skills@security-review, agent-controller** — also installed

Not found/installed:
- "fortress" — no skill found matching this name
- "sentinel" — only Roblox-specific skills found (not relevant)
- "aegis" — found but very low install counts (<100), skipped

## Key Files
- `docs/plans/walwatch-build-plan.md` — comprehensive build plan
- `contracts/sources/vault.move` — main smart contract
- `contracts/tests/vault_tests.move` — 15 tests
- `api/src/index.ts` — app entrypoint, route mounting, security headers
- `api/src/middleware/auth.ts` — requireAuth + requireAuthOrApiKey
- `api/src/middleware/org-scope.ts` — requireOrg + requireRole (now enforces API key permissions)
- `api/src/middleware/request-id.ts` — request ID tracing
- `api/src/lib/graceful-shutdown.ts` — SIGTERM/SIGINT handler
- `api/src/config.ts` — validateConfig() for production guard
- `api/src/routes/auth.ts` — auth routes with rate limiting
- `ui/components/ui/skeleton.tsx` — skeleton loading components
- `ui/components/ui/toast.tsx` — toast notification system
- `ui/components/ui/breadcrumbs.tsx` — breadcrumb navigation
- `ui/components/ui/empty-state.tsx` — reusable empty state
- `ui/components/ui/pagination.tsx` — pagination component
- `ui/components/ui/form-field.tsx` — form field with validation UX
- `ui/lib/toast-context.tsx` — toast context provider
- `keeper/src/logger.ts` — Pino structured logger
- `keeper/src/circuit-breaker.ts` — Sui RPC circuit breaker
- `keeper/src/retry.ts` — exponential backoff retry
- `keeper/src/metrics-server.ts` — health check + metrics endpoints
- `keeper/src/notification-providers.ts` — webhook SSRF protection
- `keeper/src/db.ts` — no fallback creds
- `keeper/Dockerfile` — non-root user
- `sdk/src/client.ts` — typed SDK client with JSDoc + retry
- `cli/src/index.ts` — 13 command groups + spinners + colors + completion
- `.env.example` — all 26 env vars documented
- `docker-compose.yml` — Postgres + API + keeper local dev
- `CONTRIBUTING.md` — contribution guide
- `docs/adr/0001-use-postgresql-for-state.md` — ADR: PostgreSQL
- `docs/adr/0002-use-sui-blockchain-for-renewals.md` — ADR: Sui
- `docs/adr/0003-leader-election-for-keeper-redundancy.md` — ADR: Leader election
- `docs/testing/integration-test-guide.md` — integration testing guide
- `infra/main.tf` — secrets manager, locked-down SG, CloudWatch alarms, auto-scaling
