# Dashboard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all dashboard issues — indentation, responsiveness, architecture, data fetching, and visual polish — to SaaS-level quality.

**Architecture:** 5 phases executed sequentially. Each phase is independently reviewable. Phase 1 (formatting) is pure mechanical changes. Phase 2 (responsive) adds mobile fallbacks. Phase 3 (architecture) decomposes settings + fixes mock data. Phase 4 (data) adds React Query hooks. Phase 5 (polish) elevates visual quality to SaaS level.

**Tech Stack:** Next.js 16 (App Router), React 19, shadcn/ui + @base-ui/react, Tailwind CSS v4, framer-motion, @tanstack/react-query

**Design Spec:** `docs/superpowers/specs/2026-07-27-dashboard-polish-design.md`

## Global Constraints

- Zero regressions — every page must render and function identically after changes
- Follow existing patterns: shadcn component usage, cn() utility, Tailwind v4 classes
- No CSS Modules — all styling stays as Tailwind inline classes
- No new npm dependencies unless explicitly required
- Maintain dark mode support everywhere
- All interactive elements must have aria-labels and be keyboard accessible
- Touch targets ≥44px on mobile

---

## Phase 1: Formatting & Indentation

### Task 1.1: Fix indentation in dashboard overview page

**Files:**
- Modify: `ui/app/dashboard/page.tsx`

- [ ] **Fix indentation:** The `return ( ... )` block has content indented at 6-8 spaces instead of 2. Reduce indentation to standard 2 spaces per nesting level.

The fix: line 69 `return (` → content starting at line 70 `    <div` should be `        <div` (8 spaces → 6 spaces for the root div inside the fragment, then 8 for children, etc.)

- [ ] **Verify:** Run `npm run lint` or check formatting is consistent

### Task 1.2: Fix indentation in blobs page

**Files:**
- Modify: `ui/app/dashboard/blobs/page.tsx`

- [ ] **Fix indentation:** Line 165 `return (` → line 166 `      <>` is indented too far. Fix the entire return block.

### Task 1.3: Fix indentation in wallets page

**Files:**
- Modify: `ui/app/dashboard/wallets/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.4: Fix indentation in policies page

**Files:**
- Modify: `ui/app/dashboard/policies/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.5: Fix indentation in alerts page

**Files:**
- Modify: `ui/app/dashboard/alerts/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.6: Fix indentation in analytics page

**Files:**
- Modify: `ui/app/dashboard/analytics/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.7: Fix indentation in audit-logs page

**Files:**
- Modify: `ui/app/dashboard/audit-logs/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.8: Fix indentation in billing page

**Files:**
- Modify: `ui/app/dashboard/billing/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.9: Fix indentation in auth page

**Files:**
- Modify: `ui/app/dashboard/auth/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.10: Fix indentation in status page

**Files:**
- Modify: `ui/app/dashboard/status/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.11: Fix indentation in new vault page

**Files:**
- Modify: `ui/app/dashboard/new/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.12: Fix indentation in vault detail page

**Files:**
- Modify: `ui/app/dashboard/vaults/[id]/page.tsx`

- [ ] **Fix indentation:** Fix return block indentation.

### Task 1.13: Fix indentation in all loading + error pages

**Files:**
- Modify: `ui/app/dashboard/loading.tsx`
- Modify: `ui/app/dashboard/error.tsx`
- Modify: `ui/app/dashboard/analytics/loading.tsx`
- Modify: `ui/app/dashboard/analytics/error.tsx`
- Modify: `ui/app/dashboard/blobs/loading.tsx`
- Modify: `ui/app/dashboard/blobs/error.tsx`
- Modify: `ui/app/dashboard/wallets/loading.tsx`
- Modify: `ui/app/dashboard/wallets/error.tsx`
- Modify: `ui/app/dashboard/policies/loading.tsx`
- Modify: `ui/app/dashboard/policies/error.tsx`
- Modify: `ui/app/dashboard/alerts/loading.tsx`
- Modify: `ui/app/dashboard/alerts/error.tsx`
- Modify: `ui/app/dashboard/audit-logs/loading.tsx`
- Modify: `ui/app/dashboard/audit-logs/error.tsx`
- Modify: `ui/app/dashboard/billing/loading.tsx`
- Modify: `ui/app/dashboard/billing/error.tsx`
- Modify: `ui/app/dashboard/auth/loading.tsx`
- Modify: `ui/app/dashboard/auth/error.tsx`
- Modify: `ui/app/dashboard/status/loading.tsx`
- Modify: `ui/app/dashboard/status/error.tsx`
- Modify: `ui/app/dashboard/new/loading.tsx`
- Modify: `ui/app/dashboard/new/error.tsx`
- Modify: `ui/app/dashboard/vaults/[id]/loading.tsx`
- Modify: `ui/app/dashboard/vaults/[id]/error.tsx`

- [ ] **Fix indentation:** Fix return block indentation in all loading/error files.

---

## Phase 2: Responsive Fixes

### Task 2.1: Add mobile card fallback to dashboard overview

**Files:**
- Modify: `ui/app/dashboard/page.tsx`

**Current:** The "Recent blobs" table has `hidden sm:table-cell` on the "Created" column header but no mobile card alternative.

- [ ] **Add mobile card fallback:** After the `<Card>` wrapping the table (line 153), add a `sm:hidden` block that renders each blob as a card (same pattern as blobs page mobile cards):
  - Each card shows: name, status badge, size, created date
  - Links to blob detail page
- [ ] **Verify:** Resize browser to mobile width — cards appear instead of table

### Task 2.2: Add mobile card fallback to analytics page

**Files:**
- Modify: `ui/app/dashboard/analytics/page.tsx`

- [ ] **Add mobile card fallback:** Same pattern as 2.1 for any table/list that lacks mobile variant.

### Task 2.3: Fix spacing/padding consistency across all pages

**Files:** All dashboard page files

- [ ] **Audit spacing:** Ensure all pages use consistent `p-4 md:p-8` for main content padding, `gap-4 sm:gap-6` for section gaps, `px-5 py-3` for table cells.
- [ ] **Touch targets:** Ensure all buttons, links, and interactive elements have minimum 44×44px tap target on mobile. Add `min-h-[44px] min-w-[44px]` where needed.
- [ ] **Fix overflow:** Check that content doesn't overflow on 320px width screens. Add `overflow-x-auto` to table wrappers and `truncate` to long text.

---

## Phase 3: Architecture Improvements

### Task 3.1: Decompose settings page — extract ProfileSection

**Files:**
- Create: `ui/components/dashboard/settings/profile-section.tsx`
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Create `profile-section.tsx`:** Extract the `ProfileSection` function component (lines 94-262) into its own file. Export it as default.
- [ ] **Update settings page:** Remove the inline `ProfileSection` function, import it from the new file.

### Task 3.2: Decompose settings page — extract OrganizationSection

**Files:**
- Create: `ui/components/dashboard/settings/organization-section.tsx`
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Create `organization-section.tsx`:** Extract `OrganizationSection` (lines 264-357).
- [ ] **Update settings page:** Remove inline, import from file.

### Task 3.3: Decompose settings page — extract TeamSection

**Files:**
- Create: `ui/components/dashboard/settings/team-section.tsx`
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Create `team-section.tsx`:** Extract `TeamSection` (lines 359-564).
- [ ] **Update settings page:** Remove inline, import from file.

### Task 3.4: Decompose settings page — extract WalletsSection

**Files:**
- Create: `ui/components/dashboard/settings/wallets-section.tsx`
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Create `wallets-section.tsx`:** Extract `WalletsSection` (lines 566-706).
- [ ] **Update settings page:** Remove inline, import from file.

### Task 3.5: Decompose settings page — extract ApiKeysSection

**Files:**
- Create: `ui/components/dashboard/settings/api-keys-section.tsx`
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Create `api-keys-section.tsx`:** Extract `ApiKeysSection` (lines 708-??).
- [ ] **Update settings page:** Remove inline, import from file.

### Task 3.6: Decompose settings page — extract remaining sections

**Files:**
- Create: `ui/components/dashboard/settings/notifications-section.tsx`
- Create: `ui/components/dashboard/settings/billing-section.tsx`
- Create: `ui/components/dashboard/settings/danger-zone-section.tsx`
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Extract remaining sections** into their own files. Import into settings page.

### Task 3.7: Replace vault mock data with real data

**Files:**
- Modify: `ui/app/dashboard/vaults/[id]/page.tsx`
- Delete (or leave): `ui/components/dashboard/vault-data.ts`

**Current:** Vault detail page imports from `vault-data.ts` which has hardcoded mock data.

- [ ] **Add 'use client'** to the vault detail page (it's currently a server component using mock data).
- [ ] **Replace mock data:** Use `useAuth()` to get `org.id`, then `api.getVault(org.id, id)` to fetch real data.
- [ ] **Handle loading/error states:** Add loading skeleton and error state matching the pattern used by other pages.
- [ ] **Remove `vault-data.ts`** import and file (or keep for reference if other pages use it).

---

## Phase 4: Data Fetching Unification

### Task 4.1: Create React Query hooks

**Files:**
- Create: `ui/hooks/use-dashboard.ts`
- Create: `ui/hooks/use-blobs.ts`
- Create: `ui/hooks/use-wallets.ts`
- Create: `ui/hooks/use-vaults.ts`

- [ ] **Create `use-dashboard.ts`:**
```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useDashboardSummary(orgId: string) {
  return useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: () => api.getAnalytics(orgId),
    enabled: !!orgId,
  })
}

export function useRecentBlobs(orgId: string, limit = 5) {
  return useQuery({
    queryKey: ['blobs', orgId, 'recent', limit],
    queryFn: () => api.listBlobs(orgId, { limit: String(limit) }),
    enabled: !!orgId,
  })
}
```
- [ ] **Create `use-blobs.ts`:**
```typescript
export function useBlobs(orgId: string, params?: Record<string, string>) {
  return useQuery({
    queryKey: ['blobs', orgId, params],
    queryFn: () => api.listBlobs(orgId, params ?? {}),
    enabled: !!orgId,
  })
}

export function useCreateBlob(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createBlob(orgId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blobs', orgId] }),
  })
}

export function useDeleteBlob(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteBlob(orgId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blobs', orgId] }),
  })
}
```
- [ ] **Create `use-wallets.ts`:** Similar pattern with `useQuery` + `useMutation` for wallets CRUD.
- [ ] **Create `use-vaults.ts`:** Similar pattern for vaults.

### Task 4.2: Migrate dashboard overview page to React Query

**Files:**
- Modify: `ui/app/dashboard/page.tsx`

- [ ] **Replace `useEffect` + `useState`** with `useDashboardSummary(org.id)` and `useRecentBlobs(org.id)`.
- [ ] **Handle loading/error** via React Query's `isLoading`, `error`, `data` return values.
- [ ] **Remove** manual `useEffect`, `useState`, `loading`, `error` state.

### Task 4.3: Migrate blobs page to React Query

**Files:**
- Modify: `ui/app/dashboard/blobs/page.tsx`

- [ ] **Replace `useEffect` + `useState`** with `useBlobs(org.id, params)`.
- [ ] **Replace manual CRUD** with `useCreateBlob()`, `useDeleteBlob()` mutations.
- [ ] **Handle loading/error/refetch** via React Query.

### Task 4.4: Migrate wallets page to React Query

**Files:**
- Modify: `ui/app/dashboard/wallets/page.tsx`

- [ ] **Replace `useEffect` + `useState`** with `useWallets(org.id)`.

---

## Phase 5: Dark Mode & Polish

### Task 5.1: Consolidate dark mode CSS

**Files:**
- Modify: `ui/app/globals.css`

**Current:** 4 dark mode definitions — `.dark` class (line 84), `@media (prefers-color-scheme: dark)` (line 119), and `html.dark:root` (line 156). The last one (`html.dark:root`) has different color values (blue-tinted) from the first two (neutral).

- [ ] **Remove duplicate dark mode blocks:** Keep only the `.dark` class block (lines 84-117) and the `@custom-variant dark (&:is(.dark *));` line. Remove the `@media (prefers-color-scheme: dark)` block (lines 119-154) and the `html.dark:root` block (lines 156-181).
- [ ] **Keep the `.dark` block** as the single source of truth for dark mode variables. It already has the neutral oklch values that match the codebase's shadcn theme.
- [ ] **Verify:** Light mode still works, dark mode still works via `.dark` class toggle.

### Task 5.2: Replace hardcoded colors with CSS variables

**Files:** All dashboard page files

**Pattern:** Replace specific semantic colors with CSS variable tokens:
- `bg-amber-500/10` → `bg-warning/10` (if warning token exists) or keep as-is if no token
- `text-amber-500` → `text-warning`
- `bg-green-500/15` → `bg-success/15` or `bg-accent/15`
- `text-green-500` → `text-accent`

- [ ] **Search for hardcoded colors** across all dashboard pages:
  - `amber-` → expiring status badges
  - `green-` → active/success states
- [ ] **Replace with CSS variables** where appropriate. For status colors (active/expiring/expired), keep the existing pattern since those are intentional semantic choices with no corresponding CSS variables.

### Task 5.3: Add micro-interactions and hover states

**Files:** All dashboard page files

- [ ] **Add `transition-colors`** to all cards, table rows, list items that don't have it
- [ ] **Add `hover:border-primary/30`** to cards that lack hover states
- [ ] **Add `hover:bg-muted/50`** to clickable list items
- [ ] **Ensure all buttons** have smooth hover/active transitions

### Task 5.4: Standardize empty states

**Files:** All dashboard page files

- [ ] **Audit empty states** across all pages. Ensure every page uses the shared `EmptyState` component (already imported in most places).
- [ ] **Replace inline empty state markup** with `<EmptyState icon={Icon} title="..." description="..." />`.
- [ ] **Add action buttons** to empty states where appropriate.

### Task 5.5: Standardize loading skeletons

**Files:** All dashboard page files

- [ ] **Audit loading states** across all pages. Ensure consistency in skeleton patterns.
- [ ] **Use `SkeletonTable`, `SkeletonCard`, `InlineSkeleton`** consistently.

### Task 5.6: Fix accessibility issues

**Files:** All dashboard page files

- [ ] **Replace `<div onClick={...}>`** interactive elements with `<button>` or `<a>` tags
- [ ] **Add `aria-label`** to all icon-only buttons
- [ ] **Add `role="alert"`** to error banners
- [ ] **Add `htmlFor`/`id`** pairs to all form labels
- [ ] **Ensure focus indicators** are visible (`focus-visible:ring-2`)

### Task 5.7: Add page transition animations

**Files:**
- Create: `ui/components/dashboard/page-transition.tsx`

- [ ] **Create a wrapper:**
```tsx
'use client'
import { motion } from 'framer-motion'

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
```
- [ ] **Apply** to each dashboard page by wrapping the root div/fragment.

### Task 5.8: Auth page focus

**Files:**
- Modify: `ui/app/dashboard/auth/page.tsx`

- [ ] **Remove team management** from auth page (duplicates settings Team section)
- [ ] **Focus auth page** on API keys, SSO configuration, and authentication providers
- [ ] **Add redirect** or note if user navigates to /dashboard/auth expecting team management

---

## Self-Review Checklist

After writing this plan, verify:
- [ ] **Spec coverage:** Every phase from the design spec has corresponding tasks
- [ ] **No placeholders:** All code blocks have real TypeScript content
- [ ] **Type consistency:** Hook function names used in migration tasks match what's defined in creation tasks
- [ ] **Realistic granularity:** Each task is 2-5 minutes of work
