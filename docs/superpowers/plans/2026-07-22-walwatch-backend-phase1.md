# WalWatch Backend — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all Phase 1 backend subsystems (Auth, Orgs, Projects, Blobs, Policies, Wallets, Alerts, Analytics, Audit Logs, Billing, API Keys) on top of the existing Hono API with PostgreSQL.

**Architecture:** Extend the existing Hono app in `api/` with a Drizzle ORM layer connecting to PostgreSQL. New routes mounted under `/api/*` with JWT + API key auth middleware and org-scoping. Existing vault routes remain unchanged.

**Tech Stack:** Hono, Zod, Drizzle ORM, PostgreSQL, Testcontainers, Vitest, bcrypt, jsonwebtoken

**Existing code patterns to follow:**
- Routes in `api/src/routes/<name>.ts` — each exports a `Hono` router
- Services in `api/src/services/<name>Service.ts` — business logic
- Zod schemas for request validation inline in route files
- `pino` for logging
- Tests in `api/src/__tests__/<name>.test.ts`
- No classes unless already used (VaultService uses a class; new services should be plain functions)

**Global Constraints**
- All new routes must be scope-guarded by `org_id` from auth context
- Every mutation must write to `audit_logs`
- Tests must use Testcontainers PostgreSQL (not SQLite in-memory)
- Target 95%+ line coverage for new code
- Keep existing `api/src/services/vaultService.ts` and `api/src/routes/vaults.ts` untouched

---

## File Structure (Final State)

```
api/
├── package.json              # + drizzle-orm, drizzle-kit, postgres, bcrypt, jsonwebtoken, testcontainers
├── tsconfig.json             # unchanged
├── drizle.config.ts          # Drizzle Kit config
├── src/
│   ├── index.ts              # Mount all routes
│   ├── config.ts             # Env config (DB_URL, JWT_SECRET, etc.)
│   ├── db/
│   │   ├── index.ts          # Drizzle client + connection
│   │   └── schema.ts         # All table definitions (one file)
│   ├── middleware/
│   │   ├── auth.ts           # JWT + API key auth
│   │   ├── org-scope.ts      # Attach org context
│   │   └── audit.ts          # Auto-log mutations
│   ├── lib/
│   │   ├── errors.ts         # AppError classes
│   │   └── utils.ts          # Shared helpers
│   ├── routes/
│   │   ├── auth.ts           # POST /api/auth/register, /login, /logout, GET /me
│   │   ├── orgs.ts           # CRUD /api/orgs + members
│   │   ├── projects.ts       # CRUD /api/projects
│   │   ├── blobs.ts          # CRUD /api/blobs + bulk/import/export
│   │   ├── policies.ts       # CRUD /api/policies + assignments
│   │   ├── wallets.ts        # CRUD /api/wallets + balance refresh
│   │   ├── alerts.ts         # Channels + rules under /api/alerts
│   │   ├── analytics.ts      # GET /api/analytics/*
│   │   ├── audit-logs.ts     # GET /api/audit-logs
│   │   ├── billing.ts        # Subscription + invoices + usage
│   │   ├── api-keys.ts       # CRUD /api/api-keys
│   │   └── vaults.ts         # (unchanged)
│   ├── services/
│   │   ├── vaultService.ts   # (unchanged)
│   │   ├── auth-service.ts   # Register, login, verify
│   │   └── ...               # (most logic lives in route files for CRUD resources)
│   └── __tests__/
│       ├── setup.ts          # Testcontainers + Drizzle setup
│       ├── helpers.ts        # Test fixtures, factory functions
│       ├── auth.test.ts
│       ├── orgs.test.ts
│       ├── projects.test.ts
│       ├── blobs.test.ts
│       ├── policies.test.ts
│       ├── wallets.test.ts
│       ├── alerts.test.ts
│       ├── analytics.test.ts
│       ├── audit-logs.test.ts
│       ├── billing.test.ts
│       └── api-keys.test.ts
└── .env                      # + DATABASE_URL, JWT_SECRET
```

---

## Plan 1: Foundation — DB Setup + Dependencies + Config

**Files:**
- Create: `api/drizle.config.ts`
- Create: `api/src/config.ts`
- Create: `api/src/db/index.ts`
- Create: `api/src/db/schema.ts` — users + sessions tables only
- Modify: `api/package.json` — add deps
- Create: `api/src/__tests__/setup.ts` — Testcontainers + Drizzle
- Create: `api/src/__tests__/helpers.ts`

**Interfaces:**
- Consumes: nothing (this is the foundation)
- Produces: `db` (Drizzle client), `config` (env loader), `schema` (table definitions), `testSetup` (Testcontainers helper)

### Step 1: Add dependencies to package.json

Edit `api/package.json`: add to `dependencies`:
```json
"drizzle-orm": "^0.38.0",
"postgres": "^3.4.0",
"bcrypt": "^5.1.0",
"jsonwebtoken": "^9.0.0"
```
Add to `devDependencies`:
```json
"drizzle-kit": "^0.30.0",
"testcontainers": "^10.0.0",
"@types/bcrypt": "^5.0.0",
"@types/jsonwebtoken": "^9.0.0"
```

Run: `npm install` from `api/`

### Step 2: Create config.ts

```typescript
// api/src/config.ts
import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/walwatch',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  suiRpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443',
  packageId: process.env.PACKAGE_ID || '',
  systemObjectId: process.env.SYSTEM_OBJECT_ID || '',
  walCoinType: process.env.WAL_COIN_TYPE || '',
};
```

### Step 3: Create db/index.ts

```typescript
// api/src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    client = postgres(config.databaseUrl);
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

// For tests — allows injecting a different connection
export function setDb(customDb: ReturnType<typeof drizzle>) {
  db = customDb;
}
```

### Step 4: Create db/schema.ts — initial users table

```typescript
// api/src/db/schema.ts
import { pgTable, uuid, text, timestamp, boolean, jsonb, bigint, integer, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailUnique: uniqueIndex('users_email_unique').on(table.email),
}));

// Additional tables will be added in subsequent plans
```

### Step 5: Create test setup

```typescript
// api/src/__tests__/setup.ts
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../db/schema.js';
import { setDb } from '../db/index.js';

let container: StartedTestContainer;
let client: ReturnType<typeof postgres>;

export async function setupTestDb() {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
    .withExposedPorts(5432)
    .start();

  const connectionString = `postgres://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
  client = postgres(connectionString);
  const db = drizzle(client, { schema });

  // Push schema (faster than running migrations in tests)
  const { sql } = await import('drizzle-orm');
  for (const table of Object.values(schema)) {
    if (table?.constructor?.name === 'PgTable') {
      // Skip — we use push instead
    }
  }

  setDb(db);
  return { db, connectionString, container };
}

export async function teardownTestDb() {
  if (client) await client.end();
  if (container) await container.stop();
  setDb(null as any);
}
```

### Step 6: Create test helpers

```typescript
// api/src/__tests__/helpers.ts
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getDb();
  const [user] = await db.insert(users).values({
    email: overrides.email || `test-${Date.now()}@example.com`,
    passwordHash: await bcrypt.hash(overrides.passwordHash || 'password123', 10),
    name: overrides.name || 'Test User',
  }).returning();
  return user;
}

export function generateToken(userId: string) {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: '1h' });
}
```

---

## Plan 2: Auth Routes

**Files:**
- Create: `api/src/middleware/auth.ts`
- Create: `api/src/routes/auth.ts`
- Create: `api/src/__tests__/auth.test.ts`
- Modify: `api/src/index.ts` — mount auth routes

**Interfaces:**
- Consumes: `getDb()` from Plan 1, `users` schema, `config.jwtSecret`
- Produces: `authMiddleware` (Hono middleware), `requireAuth` (guard), `/api/auth/*` routes

### Schema changes (add to db/schema.ts)

```typescript
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### Test file structure

```typescript
// api/src/__tests__/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../routes/auth.js';
import { setupTestDb, teardownTestDb } from './setup.js';

describe('Auth routes', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe('POST /api/auth/register', () => {
    it('registers a new user and returns JWT', async () => { /* ... */ });
    it('rejects duplicate email', async () => { /* ... */ });
    it('rejects invalid email format', async () => { /* ... */ });
    it('rejects short password', async () => { /* ... */ });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials', async () => { /* ... */ });
    it('rejects wrong password', async () => { /* ... */ });
    it('rejects non-existent email', async () => { /* ... */ });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user with valid JWT', async () => { /* ... */ });
    it('rejects missing token', async () => { /* ... */ });
    it('rejects expired token', async () => { /* ... */ });
  });

  describe('POST /api/auth/logout', () => {
    it('invalidates session', async () => { /* ... */ });
  });
});
```

---

## Plan 3: Organizations + Members

**Files:**
- Create: `api/src/middleware/org-scope.ts`
- Create: `api/src/middleware/audit.ts`
- Create: `api/src/lib/errors.ts`
- Create: `api/src/routes/orgs.ts`
- Create: `api/src/__tests__/orgs.test.ts`
- Modify: `api/src/db/schema.ts` — add orgs, org_members tables
- Modify: `api/src/index.ts` — mount org routes + middleware

---

## Plan 4: Projects

**Files:**
- Create: `api/src/routes/projects.ts`
- Create: `api/src/__tests__/projects.test.ts`
- Modify: `api/src/db/schema.ts` — add projects table
- Modify: `api/src/index.ts` — mount project routes

---

## Plan 5: Blobs

**Files:**
- Create: `api/src/routes/blobs.ts`
- Create: `api/src/__tests__/blobs.test.ts`
- Modify: `api/src/db/schema.ts` — add blob_registrations table
- Modify: `api/src/index.ts` — mount blob routes

---

## Plan 6: Policies

**Files:**
- Create: `api/src/routes/policies.ts`
- Create: `api/src/__tests__/policies.test.ts`
- Modify: `api/src/db/schema.ts` — add policies, policy_assignments tables
- Modify: `api/src/index.ts` — mount policy routes

---

## Plan 7: Wallets

**Files:**
- Create: `api/src/routes/wallets.ts`
- Create: `api/src/__tests__/wallets.test.ts`
- Modify: `api/src/db/schema.ts` — add wallets table
- Modify: `api/src/index.ts` — mount wallet routes

---

## Plan 8: Alerts

**Files:**
- Create: `api/src/routes/alerts.ts`
- Create: `api/src/__tests__/alerts.test.ts`
- Modify: `api/src/db/schema.ts` — add notification_channels, alert_rules tables
- Modify: `api/src/index.ts` — mount alert routes

---

## Plan 9: Analytics

**Files:**
- Create: `api/src/routes/analytics.ts`
- Create: `api/src/__tests__/analytics.test.ts`
- Modify: `api/src/index.ts` — mount analytics routes

---

## Plan 10: Audit Logs

**Files:**
- Create: `api/src/routes/audit-logs.ts`
- Create: `api/src/__tests__/audit-logs.test.ts`
- Modify: `api/src/db/schema.ts` — add audit_logs table
- Modify: `api/src/index.ts` — mount audit log routes

---

## Plan 11: Billing

**Files:**
- Create: `api/src/routes/billing.ts`
- Create: `api/src/__tests__/billing.test.ts`
- Modify: `api/src/db/schema.ts` — add subscriptions, usage_records, invoices tables
- Modify: `api/src/index.ts` — mount billing routes

---

## Plan 12: API Keys

**Files:**
- Create: `api/src/routes/api-keys.ts`
- Create: `api/src/__tests__/api-keys.test.ts`
- Modify: `api/src/db/schema.ts` — add api_keys table
- Modify: `api/src/index.ts` — mount API key routes
- Modify: `api/src/middleware/auth.ts` — add API key authentication support
