# Phase 2: Data Integrity & Audit

> **For implementers:** Part of the master plan. Depends on Phase 1.

**Goal:** Make audit logs transactional with state changes, create immutable cost_records ledger, derive budget spent from ledger, enforce DB-level audit immutability, fix spending limit XOR scoping, implement budget window rollover.

---

### Task 2.1: Transactional audit + state changes

**Files:**
- Modify: All route files in `api/src/routes/*.ts`
- Create: `api/src/lib/audit-helper.ts` (new helper)

**Changes:**
Create `auditHelper.ts` with a function `withAudit<T>(db, table, id, action, details, fn)` that wraps a state mutation + audit log insert in a single DB transaction. Then refactor every route handler that does:
```
await db.insert(table).values(data);
await db.insert(audit_logs).values(log);  // separate, no transaction
```
to use the helper.

Focus on: `orgs.ts`, `projects.ts`, `wallets.ts`, `policies.ts`, `budgets.ts`, `spending-limits.ts`, `blobs.ts`, `schedules.ts`, `api-keys.ts`, `teams.ts`, `alert-rules.ts`, `notification-channels.ts`, `webhooks.ts`.

- [ ] **Implement:** Create `withAudit` helper, refactor all route files
- [ ] **Test:** Verify existing tests still pass
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: wrap audit logging in transactions across all routes"`

---

### Task 2.2: cost_records ledger table

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: migration file 0026
- Modify: `api/src/lib/cost-engine.ts`
- Modify: `keeper/src/executor.ts`

**Changes:**
1. Add `cost_records` table to schema: `id (uuid, PK)`, `blob_registration_id (FK)`, `renewal_job_id (FK)`, `estimated_cost (numeric)`, `actual_cost (numeric)`, `window_id (text)`, `recorded_at (timestamptz)`, `org_id (FK)`, `project_id (FK)`. Make it append-only (no update_at).
2. Create migration `0026_cost_records.sql`.
3. In `cost-engine.ts`, write actual costs to `cost_records` instead of directly to `renewalJobs.actualCost`.
4. In `executor.ts`, write final cost to `cost_records` after successful renewal execution.

- [ ] **Implement:** Add cost_records table, migration, write path
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add immutable cost_records ledger table"`

---

### Task 2.3: Budget spent derived from cost_records

**Files:**
- Modify: `api/src/lib/cost-engine.ts`
- Modify: `api/src/db/schema.ts` (optional, if removing `spent` column)

**Changes:**
Instead of incrementing `budgets.spent` directly, compute spent at query time: `SELECT COALESCE(SUM(actual_cost), 0) FROM cost_records WHERE org_id = ? AND recorded_at BETWEEN budget.window_start AND budget.window_end`. Remove the mutable `spent` column from `budgets` and `spendingLimits` tables (add migration column drop).

- [ ] **Implement:** Derive spent from cost_records, drop mutable columns
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: derive budget spent from cost_records ledger"`

---

### Task 2.4: DB-level audit log immutability

**Files:**
- Create: migration file 0027

**Changes:**
Add a PostgreSQL trigger function that prevents UPDATE and DELETE on `audit_logs` table:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable: update/delete not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
```

- [ ] **Implement:** Create migration with trigger
- [ ] **Verify:** Migration SQL is valid
- [ ] **Commit:** `git commit -m "feat: add DB-level audit log immutability trigger"`

---

### Task 2.5: Spending limit XOR scoping

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: migration file 0028
- Modify: `api/src/routes/spending-limits.ts`
- Modify: `api/src/lib/cost-engine.ts`

**Changes:**
Refactor `spendingLimits` table: replace `walletId NOT NULL` with polymorphic scope: `scope (enum: 'organization'|'project'|'wallet'|'policy')` + `scope_target_id (uuid)`. Add CHECK constraint ensuring exactly one scope level. Update routes to accept `scope` + `scopeTargetId` instead of just `walletId`. Update `getEffectiveSpendingLimits()` to resolve hierarchy.

- [ ] **Implement:** Schema change, migration, route updates, cost-engine resolution
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: implement spending limit XOR scoping"`

---

### Task 2.6: Budget window rollover handler

**Files:**
- Modify: `api/src/lib/cost-engine.ts`
- Modify: `keeper/src/scheduler.ts` (register handler)

**Changes:**
Implement the budget window rollover logic that the scheduler expects: close current window (snapshot spent into cost_records or a budget_windows table), reset spent tracking, advance `window_start`/`window_end`. Register as a scheduled handler. Emit `budget.window_rolled_over` event.

- [ ] **Implement:** Rollover logic, register as schedule handler
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: implement budget window rollover handler"`
