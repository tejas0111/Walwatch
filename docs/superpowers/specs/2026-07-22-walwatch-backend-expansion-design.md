# WalWatch Backend Expansion — Phase 1 Design

## 1. Architecture Overview

```
┌──────────────┐     ┌────────────────────────────────────────────┐
│   Next.js UI  │     │           Hono REST API (:3001)           │
│   (:3000)     │────▶│                                            │
└──────────────┘     │  /api/auth/*      /api/orgs/*              │
                     │  /api/projects/*  /api/blobs/*             │
                     │  /api/policies/*  /api/wallets/*           │
                     │  /api/alerts/*    /api/analytics/*         │
                     │  /api/billing/*   /api/vaults/* (existing) │
                     │                                            │
                     │  Middleware: auth → org scope → route      │
                     └───────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────────┐
        │PostgreSQL│  │Sui Client│  │  External    │
        │(Drizzle) │  │(on-chain)│  │  Services    │
        └──────────┘  └──────────┘  │(Resend, etc.)│
                                    └──────────────┘
```

- **Existing vault routes** stay unchanged (on-chain only, no DB).
- **New resources** use PostgreSQL via Drizzle ORM for persistence.
- **Hono** remains the framework — extend with middleware for auth/org scoping.
- **No UI changes** — only backend.

## 2. Technology Stack

| Layer | Choice | Why |
|-------|--------|-----|
| HTTP | Hono (existing) | Already in use |
| Validation | Zod (existing) | Already in use |
| Database | PostgreSQL | User spec |
| ORM | Drizzle ORM | Type-safe, SQL-like, good Postgres support |
| Migrations | Drizzle Kit | Built-in with Drizzle |
| Auth | JWT + API Keys | Stateless, no session store needed |
| Password hashing | bcrypt | Standard |
| Testing | Vitest (existing) | Already in use |
| Test DB | Testcontainers (PostgreSQL) | Isolated, real Postgres per test run |

## 3. Data Model

### Organizations
```sql
organizations
  id            UUID PK
  name          TEXT NOT NULL
  slug          TEXT NOT NULL UNIQUE
  created_at    TIMESTAMPTZ DEFAULT NOW()
  updated_at    TIMESTAMPTZ DEFAULT NOW()
```

### Projects
```sql
projects
  id              UUID PK
  org_id          UUID FK → organizations.id
  name            TEXT NOT NULL
  slug            TEXT NOT NULL
  description     TEXT
  environment     TEXT (production/staging/development/personal)
  default_wallet_id UUID FK → wallets.id (nullable)
  created_at      TIMESTAMPTZ DEFAULT NOW()
  updated_at      TIMESTAMPTZ DEFAULT NOW()
  UNIQUE(org_id, slug)
```

### Blob Registrations
```sql
blob_registrations
  id              UUID PK
  org_id          UUID FK → organizations.id
  project_id      UUID FK → projects.id
  blob_id         TEXT NOT NULL (Walrus blob ID)
  name            TEXT
  size_bytes      BIGINT
  content_type    TEXT
  status          TEXT DEFAULT 'active' (active/expired/archived)
  upload_date     TIMESTAMPTZ
  expiry_epoch    BIGINT
  metadata        JSONB DEFAULT '{}'
  tags            TEXT[] DEFAULT '{}'
  sui_vault_id    TEXT (optional, if vault exists)
  owner_address   TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
  updated_at      TIMESTAMPTZ DEFAULT NOW()
```

### Policies
```sql
policies
  id                  UUID PK
  org_id              UUID FK → organizations.id
  name                TEXT NOT NULL
  description         TEXT
  rules               JSONB NOT NULL -- [{field, operator, value}]
  -- targets: project_id, tag, blob_size, blob_type, owner
  renew_threshold     INTEGER NOT NULL (epochs before expiry)
  renew_extension     INTEGER NOT NULL (epochs to extend)
  max_total_epochs    INTEGER
  active              BOOLEAN DEFAULT true
  created_at          TIMESTAMPTZ DEFAULT NOW()
  updated_at          TIMESTAMPTZ DEFAULT NOW()

policy_assignments
  policy_id           UUID FK → policies.id
  blob_registration_id UUID FK → blob_registrations.id
  PRIMARY KEY (policy_id, blob_registration_id)
```

### Wallets
```sql
wallets
  id              UUID PK
  org_id          UUID FK → organizations.id
  address         TEXT NOT NULL
  label           TEXT
  type            TEXT DEFAULT 'owned' (owned/watch-only)
  is_default      BOOLEAN DEFAULT false
  spending_limit  BIGINT (optional, in MIST)
  balance         BIGINT DEFAULT 0 (last known)
  last_checked_at TIMESTAMPTZ
  created_at      TIMESTAMPTZ DEFAULT NOW()
  UNIQUE(org_id, address)
```

### Alerts / Notification Channels
```sql
notification_channels
  id              UUID PK
  org_id          UUID FK → organizations.id
  type            TEXT NOT NULL (email/discord/slack/telegram/webhook)
  name            TEXT NOT NULL
  config          JSONB NOT NULL -- {url, token, channel, etc}
  enabled         BOOLEAN DEFAULT true
  created_at      TIMESTAMPTZ DEFAULT NOW()

alert_rules
  id              UUID PK
  org_id          UUID FK → organizations.id
  name            TEXT NOT NULL
  trigger         TEXT NOT NULL (blob_expiring/renewal_failed/renewal_succeeded/
                                 wallet_balance_low/budget_exceeded/api_key_compromised/
                                 publisher_offline)
  conditions      JSONB DEFAULT '{}'
  channel_ids     UUID[] NOT NULL
  project_ids     UUID[] (optional, scope to projects)
  enabled         BOOLEAN DEFAULT true
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Auth
```sql
users
  id              UUID PK
  email           TEXT NOT NULL UNIQUE
  password_hash   TEXT NOT NULL
  name            TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()

org_members
  org_id          UUID FK → organizations.id
  user_id         UUID FK → users.id
  role            TEXT NOT NULL (owner/admin/developer/viewer/billing)
  PRIMARY KEY (org_id, user_id)

api_keys
  id              UUID PK
  org_id          UUID FK → organizations.id
  user_id         UUID FK → users.id
  name            TEXT NOT NULL
  key_hash        TEXT NOT NULL (SHA-256 of the actual key)
  key_prefix      TEXT NOT NULL (first 8 chars for identification)
  permissions     TEXT[] DEFAULT '{}'
  expires_at      TIMESTAMPTZ
  last_used_at    TIMESTAMPTZ
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Billing
```sql
subscriptions
  id              UUID PK
  org_id          UUID FK → organizations.id UNIQUE
  plan            TEXT NOT NULL (free/pro/team/enterprise)
  status          TEXT NOT NULL (active/canceled/past_due)
  current_period_start TIMESTAMPTZ
  current_period_end   TIMESTAMPTZ
  created_at      TIMESTAMPTZ DEFAULT NOW()

usage_records
  id              UUID PK
  org_id          UUID FK → organizations.id
  metric          TEXT NOT NULL (storage_bytes/renewal_count/api_calls)
  value           BIGINT NOT NULL
  recorded_at     TIMESTAMPTZ DEFAULT NOW()

invoices
  id              UUID PK
  org_id          UUID FK → organizations.id
  subscription_id UUID FK → subscriptions.id
  amount          BIGINT NOT NULL (in cents)
  currency        TEXT DEFAULT 'usd'
  status          TEXT DEFAULT 'pending' (pending/paid/failed/refunded)
  due_date        DATE
  paid_at         TIMESTAMPTZ
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Audit Logs
```sql
audit_logs
  id              UUID PK
  org_id          UUID FK → organizations.id
  user_id         UUID FK → users.id
  action          TEXT NOT NULL
  resource_type   TEXT NOT NULL
  resource_id     TEXT
  details         JSONB DEFAULT '{}'
  ip_address      TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

## 4. API Routes

### Auth (`/api/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Create user account |
| POST | /auth/login | Login, returns JWT |
| POST | /auth/logout | Invalidate session |
| GET | /auth/me | Current user info |

### Organizations (`/api/orgs`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /orgs | Create org |
| GET | /orgs | List user's orgs |
| GET | /orgs/:id | Get org details |
| PATCH | /orgs/:id | Update org |
| DELETE | /orgs/:id | Delete org (owner only) |
| GET | /orgs/:id/members | List members |
| POST | /orgs/:id/members | Invite member |
| PATCH | /orgs/:id/members/:userId | Change role |
| DELETE | /orgs/:id/members/:userId | Remove member |

### Projects (`/api/projects`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /projects | Create project |
| GET | /projects | List projects (scoped to org) |
| GET | /projects/:id | Get project |
| PATCH | /projects/:id | Update project |
| DELETE | /projects/:id | Archive project |
| GET | /projects/:id/blobs | List blobs in project |

### Blobs (`/api/blobs`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /blobs | Register a blob |
| GET | /blobs | List blobs (searchable, filterable) |
| GET | /blobs/:id | Get blob details |
| PATCH | /blobs/:id | Update blob metadata |
| DELETE | /blobs/:id | Delete registration |
| POST | /blobs/bulk | Bulk operations |
| POST | /blobs/import | Import existing blobs |
| GET | /blobs/export | Export blob metadata |

### Policies (`/api/policies`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /policies | Create policy |
| GET | /policies | List policies |
| GET | /policies/:id | Get policy + matched blobs |
| PATCH | /policies/:id | Update policy |
| DELETE | /policies/:id | Delete policy |
| POST | /policies/:id/assign | Assign to blobs |
| POST | /policies/:id/unassign | Remove from blobs |

### Wallets (`/api/wallets`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /wallets | Add wallet |
| GET | /wallets | List wallets |
| GET | /wallets/:id | Get wallet + balance |
| PATCH | /wallets/:id | Update wallet |
| DELETE | /wallets/:id | Remove wallet |
| POST | /wallets/:id/refresh-balance | Refresh on-chain balance |

### Alerts (`/api/alerts`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /alerts/channels | Add notification channel |
| GET | /alerts/channels | List channels |
| PATCH | /alerts/channels/:id | Update channel |
| DELETE | /alerts/channels/:id | Remove channel |
| POST | /alerts/rules | Create alert rule |
| GET | /alerts/rules | List rules |
| PATCH | /alerts/rules/:id | Update rule |
| DELETE | /alerts/rules/:id | Delete rule |

### Analytics (`/api/analytics`)
| Method | Path | Description |
|--------|------|-------------|
| GET | /analytics/overview | Org-level summary |
| GET | /analytics/storage | Storage usage over time |
| GET | /analytics/renewals | Renewal stats + success rate |
| GET | /analytics/costs | Renewal costs over time |
| GET | /analytics/forecasts | Projected spending + wallet depletion |

### Audit Logs (`/api/audit-logs`)
| Method | Path | Description |
|--------|------|-------------|
| GET | /audit-logs | List logs (paginated, filterable) |

### Billing (`/api/billing`)
| Method | Path | Description |
|--------|------|-------------|
| GET | /billing/subscription | Get current plan |
| POST | /billing/subscription | Change plan |
| GET | /billing/invoices | List invoices |
| GET | /billing/usage | Current usage |

### API Keys (`/api/api-keys`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api-keys | Create API key |
| GET | /api-keys | List keys |
| DELETE | /api-keys/:id | Revoke key |

## 5. Auth Flow

### JWT Authentication
1. User registers → POST `/api/auth/register` → creates `users` row → returns JWT
2. User logs in → POST `/api/auth/login` → verifies bcrypt hash → returns JWT (claims: `user_id`, `org_id`, `role`)
3. All subsequent requests include `Authorization: Bearer <jwt>`
4. Middleware: validates JWT, loads org membership, attaches `{user, org, role}` to context

### API Key Authentication
1. Developer creates API key → receives raw key once (`wak_` prefix)
2. Only key hash stored in DB (SHA-256)
3. Request includes `X-API-Key: <key>`
4. Middleware: hash key, look up in DB, check expiry/permissions

### Scoping
- Every request is scoped to one org (via JWT claim or API key's org)
- Resources belong to orgs — routes filter by `org_id` from context
- Role-based: owner > admin > developer > viewer > billing

## 6. File Structure

```
api/src/
├── index.ts                    # App entry (mount routes)
├── config.ts                   # Env config loader
├── middleware/
│   ├── auth.ts                 # JWT + API key auth middleware
│   ├── org-scope.ts            # Org scoping middleware
│   └── audit.ts                # Audit logging middleware
├── db/
│   ├── index.ts                # Drizzle client setup
│   ├── schema.ts               # All table definitions
│   └── migrations/             # Drizzle Kit migrations
├── routes/
│   ├── auth.ts                 # /api/auth
│   ├── orgs.ts                 # /api/orgs
│   ├── projects.ts             # /api/projects
│   ├── blobs.ts                # /api/blobs
│   ├── policies.ts             # /api/policies
│   ├── wallets.ts              # /api/wallets
│   ├── alerts.ts               # /api/alerts
│   ├── analytics.ts            # /api/analytics
│   ├── audit-logs.ts           # /api/audit-logs
│   ├── billing.ts              # /api/billing
│   ├── api-keys.ts             # /api/api-keys
│   └── vaults.ts               # (existing, unchanged)
├── services/
│   ├── auth-service.ts         # Auth logic
│   ├── vaultService.ts         # (existing, unchanged)
│   └── ... (other services if needed)
├── lib/
│   ├── errors.ts               # Custom error classes
│   └── utils.ts                # Helpers
└── __tests__/
    ├── setup.ts                # Test DB setup (Testcontainers)
    ├── auth.test.ts
    ├── orgs.test.ts
    ├── projects.test.ts
    ├── blobs.test.ts
    ├── policies.test.ts
    ├── wallets.test.ts
    ├── alerts.test.ts
    ├── analytics.test.ts
    ├── audit-logs.test.ts
    ├── billing.test.ts
    └── api-keys.test.ts
```

## 7. Test Strategy (Goal: 95%+ Coverage)

### Approach
- **Integration tests over unit tests** — each test file spins up a real PostgreSQL via Testcontainers, runs migrations, creates test data, and hits the actual Hono routes. This tests the full stack: middleware → route handler → service → DB.
- **Isolated per-test-file** — each `describe` block gets its own DB (fast with Testcontainers reuse).
- **Cover every route** — success case, validation error, auth error, not-found, conflict.

### What we test
1. **Auth** — register, login, invalid credentials, duplicate email, token expiry
2. **Orgs** — CRUD, member management, role enforcement (viewer can't delete)
3. **Projects** — CRUD, org scoping (can't see other org's projects), environment labels
4. **Blobs** — register, search, filter by tags/project, bulk operations, import/export
5. **Policies** — CRUD, rule matching, assign/unassign, policy evaluation
6. **Wallets** — CRUD, balance refresh (mock on-chain), default wallet enforcement
7. **Alerts** — channel CRUD, rule CRUD, trigger conditions
8. **Analytics** — aggregation correctness, date ranges
9. **Audit logs** — auto-logging on mutations, filtering
10. **Billing** — plan CRUD, usage tracking, invoice generation
11. **API Keys** — create, authenticate, revoke
12. **Middleware** — missing auth header, invalid JWT, expired key, org not found

### Test infrastructure
- `testcontainers` package for PostgreSQL per test suite
- Drizzle `push` to apply schema (no migration files needed in tests)
- JWT signing with a test-only secret
- Mock SuiClient for on-chain dependent features (wallet balance refresh)

## 8. Implementation Order

1. **DB setup** — Drizzle schema, client, migrations
2. **Auth** — users table, register/login, JWT middleware, API key auth
3. **Orgs** — CRUD, members, role enforcement
4. **Projects** — CRUD, org scoping
5. **Blobs** — Register, search, filter, bulk ops
6. **Policies** — CRUD, rule engine, assignments
7. **Wallets** — CRUD, balance tracking
8. **Alerts** — Channels + rules
9. **Analytics** — Aggregation queries
10. **Audit logs** — Auto-logging
11. **Billing** — Plans, usage, invoices
12. **API Keys** — Full key lifecycle
13. **Integration tests** — Written alongside each subsystem (not a separate phase)
