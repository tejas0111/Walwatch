# WalWatch SaaS Feature Plan

## Target User
Small teams of 2-10 people managing auto-renewal of Walrus blob storage on Sui.

## Core Concept
Users register blobs, set renewal policies, fund vaults with WAL tokens, and the system keeps blobs alive automatically via on-chain renewal execution.

---

## 1. Navigation & Information Architecture

### Sidebar structure

```
WALWATCH
  Dashboard          /dashboard
  Analytics          /dashboard/analytics
INFRASTRUCTURE
  Blobs              /dashboard/blobs
  Vaults             /dashboard/vaults
  Wallets            /dashboard/settings?tab=wallets
  Policies           /dashboard/policies
  Projects           /dashboard/projects
MONITORING
  Alerts             /dashboard/alerts
  Audit Logs         /dashboard/audit-logs
  Status             /dashboard/status
ADMIN
  Settings           /dashboard/settings
```

### Removed/changed
- "New Vault" removed from sidebar (access from vaults list page)
- "Team" standalone page removed → redirects to `/dashboard/settings?tab=team`
- "API Keys" standalone page removed → redirects to `/dashboard/settings?tab=api-keys`
- "Wallets" standalone page removed → redirects to `/dashboard/settings?tab=wallets`
- "Billing" standalone page removed → redirects to `/dashboard/settings?tab=billing`
- Settings becomes the single hub for all admin functions (8 tabs)

---

## 2. Data Model & Entity Lifecycles

### Core entities (MVP)

| Entity | Backend table | Lifecycle |
|--------|--------------|-----------|
| Organization | `organizations` | `active` ⇄ `suspended` → `deleted` |
| Project | `projects` | `active` ⇄ `archived` → `deleted` |
| Blob | `blob_registrations` | `discovered` → `verified` → `tracked` → `protected` ⇄ `expiring` → `renewing` → `renewed` (loop) → `expired` → `archived` → `deleted` |
| Policy | `policies` | `draft` → `active` ⇄ `paused` → `archived` |
| Wallet | `wallets` | `active` ⇄ `delegation_revoked` → `deleted` |
| Vault | (on-chain) | `created` → `funded` → `renewing` → `renewed` (loop on-chain) → `reclaimed` → `destroyed` |
| Alert Rule | `alert_rules` | `active` ⇄ `paused` → `deleted` |
| Alert Event | `alert_events` | `fired` → `delivered` → `acknowledged` OR `escalated` |
| Notification Channel | `notification_channels` | `active` → `deleted` |
| API Key | `api_keys` | `created` → `active` → `rotated` → `revoked` |
| Subscription | `subscriptions` | `free` ⇄ `pro` ⇄ `team` ⇄ `enterprise` |
| Org Member | `org_members` | Roles: `owner` > `admin` > `developer` > `viewer` > `billing` |
| Invitation | `invitations` | `pending` → `accepted` → `expired` |

### Secondary entities (post-MVP but backends exist)

| Entity | Backend table | Lifecycle |
|--------|--------------|-----------|
| Budget | `budgets` | `defined` → `active` (accruing) ⇄ `window_closed` → `active` → `archived` |
| Spending Limit | `spending_limits` | `defined` → `active` (enforcing) ⇄ `paused` → `archived` |
| Delegation | `delegations` | `active` → `revoked` |
| Webhook | `webhooks` | `created` → `active` → `failing` → `disabled` → `deleted` |
| Publisher | `publishers` | `active` → `deleted` |
| Aggregator | `aggregators` | `active` → `deleted` |
| Team | `teams` | `active` → `deleted` |
| Schedule | `schedules` | `active` ⇄ `paused` → `deleted` |
| Feature Flag | `feature_flags` | `enabled` / `disabled` per org |

---

## 3. Vault Flow (critical fix)

### Current broken state
- `/dashboard/new` → creates vault (hardcoded `EST_COST`, no real tx signing)
- `/dashboard/vaults` → **404** (nav links here, no `page.tsx`)
- `/dashboard/vaults/[id]` → shows detail but "Edit policy" and "Deposit WAL" are cosmetic

### Fix plan
1. **Create `/dashboard/vaults/page.tsx`** — vault list with columns: status (badge), blob ID, balance, next renewal epoch, policy name, actions dropdown (view, deposit, edit policy). Paginated. Search by blob ID.

2. **Fix `/dashboard/new`** — replace hardcoded `EST_COST=3.2` with `api.costEngine.simulate()` call. Add wallet picker (dropdown from existing wallets). Add blob picker (dropdown from unassigned blobs). Remove fake "signing" step — the API handles on-chain via server key.

3. **Fix `/dashboard/vaults/[id]`** — wire "Deposit WAL" to a dialog (amount input → `api.depositVault(id, amount)`). Wire "Edit Policy" to a dialog (threshold, extension, max epochs → `api.updateVaultPolicy(id, policy)`). Add breadcrumbs: `Vaults > [id]`.

4. **Remove "New Vault" from sidebar nav** — access via vaults list page "+ Create vault" button.

---

## 4. Settings Consolidation

### Current problem
Standalone pages duplicate Settings section components with different UIs:
- `/dashboard/wallets` duplicates `settings/wallets-section.tsx`
- `/dashboard/auth` (API Keys) duplicates `settings/api-keys-section.tsx`
- `/dashboard/alerts` (channels) duplicates `settings/notifications-section.tsx`
- `/dashboard/billing` duplicates `settings/billing-section.tsx`

### Fix plan
1. Keep Settings tab components as single source of truth
2. Add redirects: `/dashboard/wallets` → `/dashboard/settings?tab=wallets`, `/dashboard/auth` → `/dashboard/settings?tab=api-keys`, `/dashboard/billing` → `/dashboard/settings?tab=billing`
3. Delete the standalone page files
4. Update nav-items.tsx to point to settings URLs

---

## 5. Wallet Connect

### Current state
`wallet-button.tsx` uses `@mysten/dapp-kit` to connect Sui wallet. Address/network display works. But vault creation doesn't use the connected wallet — it's display-only.

### Design decision
On-chain operations are executed server-side via the API's Sui key. The wallet connect in the UI is for identity display only. Document this behavior clearly in the UI.

---

## 6. Remaining UI Gaps

### Missing edit dialogs
- Alert channels: add edit dialog (pre-populate type/name/config, PATCH endpoint)
- Alert rules: add edit dialog (pre-populate name/trigger/conditions, PATCH endpoint)
- Wallets: add edit dialog (label, spending limit, PATCH endpoint)

### Missing detail pages
- Blob detail page (`/dashboard/blobs/[id]`) — show blob info, status timeline, assigned policy, renewal history, cost records
- Policy detail page (`/dashboard/policies/[id]`) — show policy config, assigned blobs, renewal job history
- Project detail page (`/dashboard/projects/[id]`) — show project info, blobs count, wallets count, teams

### React Query migration
Pages still using raw `useEffect` + `useCallback`:
- `/dashboard/analytics` → useDashboardAnalytics hook
- `/dashboard/blobs` → useBlobs hook (already exists but unused)
- `/dashboard/wallets` → useWallets hook (already exists but unused)
- `/dashboard/auth` → useApiKeys hook

### Permission label normalization
- Auth page uses: `admin`, `developer`, `viewer`, `billing`
- API keys section uses: `read`, `write`, `admin`
- Normalize to: `admin`, `developer`, `viewer`, `billing` across all UI

### Budgets / Spending Limits / Delegations pages
Backend routes exist but UI pages are missing. Create:
- `/dashboard/budgets` — list + create + edit + delete + close-window + activate
- `/dashboard/spending-limits` — list + create + edit + delete + pause + activate
- `/dashboard/delegations` — list + create + revoke (accessible from wallet detail)

---

## 7. Implementation Order

### Phase 1: Fix broken flows (must ship)
1. Create vault list page (`/dashboard/vaults/page.tsx`)
2. Fix vault create page (`/dashboard/new`) — replace hardcoded cost, add pickers
3. Wire vault detail buttons (deposit, edit policy)
4. Fix nav (remove "New Vault" standalone, fix 404)

### Phase 2: Settings consolidation
5. Add redirects for consolidated pages
6. Delete duplicated standalone pages
7. Update nav-items.tsx

### Phase 3: Edit dialogs + detail pages
8. Add edit dialogs for alert channels, rules, wallets
9. Create blob detail page
10. Create policy detail page

### Phase 4: React Query + normalization
11. Migrate analytics, blobs, wallets, auth pages to React Query
12. Normalize permission labels
13. Create budgets, spending limits pages

### Phase 5: Polish
14. Audit all pages for consistent loading/error/empty states
15. Add blob status timeline visualization
16. Add vault renewal history chart
