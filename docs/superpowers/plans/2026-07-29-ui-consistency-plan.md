# UI Consistency & Cleanup Plan

## Objective
Fix all 100 issues found across 14 pages, 45 components, and hooks/API layer to produce a clean, consistent, professional SaaS dashboard.

## Global Constraints
- No semicolons unless the surrounding file uses them (vaults/[id]/page.tsx is the sole exception)
- Named exports only (no `export default`)
- `cn()` utility for class merging (not template literals)
- All shadcn/Base UI components used via `@/components/ui/<name>`
- React Query hooks follow `['resource', orgId, ...params]` pattern
- All API client methods throw `ApiError` uniformly
- No `as any`, `as unknown as X`, or `Record<string, unknown>` — typed interfaces everywhere
- All pages match: same loading/error/empty patterns, same import organization, same spacing conventions
- `"use client"` on any component using hooks/events

## Tasks

### Task 1: Shared ErrorState component + AlertDialogAction fix
**Files:** 
- Create `components/ui/error-state.tsx`
- Delete inline ErrorState from: alerts/page.tsx, analytics/page.tsx, audit-logs/page.tsx, auth/page.tsx, policies/page.tsx, projects/page.tsx, status/page.tsx, vaults/[id]/page.tsx
- Fix AlertDialogAction in: alerts/page.tsx (lines 467, 485), policies/page.tsx (line 356), projects/page.tsx (line 344) — use `variant="destructive"` instead of inline classes

**Details:**
- ErrorState accepts `{ message: string; onRetry?: () => void }` 
- Export as named `ErrorState`
- AlertDialogAction: `<AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90">` → `<AlertDialogAction variant="destructive">`

### Task 2: Delete duplicate toggle-switch.tsx
**Files:**
- Delete `components/ui/toggle-switch.tsx`
- Check if anything imports from `toggle-switch.tsx` — if so, redirect imports to `switch.tsx`

**Details:**
- `switch.tsx` is the canonical implementation using `@base-ui/react/switch`
- `toggle-switch.tsx` is a hand-rolled `<button role="switch">` — delete it entirely

### Task 3: Fix Pagination — ellipsis truncation + Button component
**Files:**
- `components/ui/pagination.tsx`

**Details:**
- Replace raw `<button>` with `<Button variant="outline" size="sm">` (or similar)
- Add ellipsis truncation: show first page, last page, pages around current, with `...` separators
- Max ~7 visible page buttons

### Task 4: Fix wallet-button.tsx — Spinner, remove `any`, clean up
**Files:**
- `components/dashboard/wallet-button.tsx`

**Details:**
- Replace raw SVG spinner (lines 24-27) with `<Spinner size="sm" />`
- Remove `as any` cast on line 35 — type the wallet object properly
- Clean up the dual-disconnect UX if straightforward

### Task 5: Replace raw <table> in settings sections with Table components
**Files:**
- `components/dashboard/settings/team-section.tsx` (line 175)
- `components/dashboard/settings/billing-section.tsx` (line 108)
- `components/dashboard/settings/api-keys-section.tsx` (line 198)

**Details:**
- Use `Table, TableHeader, TableBody, TableRow, TableHead, TableCell` from `@/components/ui/table`
- Match the table pattern used in `blobs/page.tsx`

### Task 6: Dead code & type safety cleanup
**Files:**
- `lib/api-client.ts` — remove duplicate `inviteMember` (same as `addMember`); remove `as any` cast in `listBlobs`/`listAuditLogs`
- `hooks/use-blobs.ts` — remove unused `orgId` param from `useCreateBlob`/`useDeleteBlob`; use `orgId` in invalidation keys
- `components/dashboard/settings/billing-section.tsx` — remove unused `Loader2` import
- `components/ui/role-badge.tsx` — remove dead `ROLE_BADGE_VARIANT`
- `app/dashboard/auth/page.tsx` — remove unused `org` destructure
- `app/dashboard/projects/page.tsx` — remove unused `FormInput` import
- `app/dashboard/analytics/page.tsx` — fix `data as unknown as Overview` — use proper type guard or cast directly
- `app/dashboard/status/page.tsx` — fix `data as unknown as HealthResponse` — same

### Task 7: Fix audit-logs page — native inputs → shadcn components
**Files:**
- `app/dashboard/audit-logs/page.tsx`

**Details:**
- Replace native `<input>` (line 135-139) with `<Input>` component
- Replace native `<select>` (lines 152, 166) with `<Select>` component
- Use `<Search>` icon pattern consistent with blobs page search bar

### Task 8: Fix form-field.tsx — use Input/Select components
**Files:**
- `components/ui/form-field.tsx`

**Details:**
- `FormInput` (line 70): use `<Input>` instead of raw `<input>`
- `FormSelect` (line 93): use `<Select>` instead of raw `<select>`

### Task 9: Fix billing page — consistent loading/error pattern
**Files:**
- `app/dashboard/billing/page.tsx`

**Details:**
- Replace early-return pattern (lines 99-124) with inline conditional pattern matching all other pages
- Use `ErrorState` from Task 1 instead of inline error block

### Task 10: Fix cascading motion.div animations
**Files:**
- `app/dashboard/policies/page.tsx` (line 225)
- `app/dashboard/projects/page.tsx` (line 220)
- `app/dashboard/wallets/page.tsx` (line 164)
- `app/dashboard/status/page.tsx` (line 176)

**Details:**
- Remove per-item `motion.div` `initial={{ opacity: 0, y: 8 }}` animations inside `PageTransition`
- Keep the items but remove the framer-motion wrappers or simplify to static divs
- `PageTransition` already handles the page-level entrance animation

### Task 11: Create hooks for policies, projects, alerts
**Files:**
- Create `hooks/use-policies.ts`
- Create `hooks/use-projects.ts`
- Create `hooks/use-alerts.ts`

**Details:**
- Follow the same pattern as `use-wallets.ts`: useQuery + useMutation, query key `['resource', orgId]`, invalidation on mutations
- Each file: one list hook, one create hook, one delete hook, one update hook (where applicable)
- Pages directly call `usePolicies()` etc instead of raw `useState`+`useEffect`+`api.listPolicies()`

### Task 12: Vault detail page fixes
**Files:**
- `app/dashboard/vaults/[id]/page.tsx`

**Details:**
- Add Breadcrumbs (matches every other dashboard page)
- Remove semicolons to match codebase convention (or add semicolons everywhere — pick one)
- Use ErrorState from Task 1
- Fix loading/error pattern to inline conditional (not early returns)
- Standardize Link/Button rendering

## Task Order & Dependencies

Tasks 1-6, 8, 10, 12 are independent — can be done in any order.
Task 7 depends on nothing.
Task 9 depends on Task 1 (for ErrorState usage).
Task 11 depends on nothing.

Sequential execution to avoid merge conflicts.
