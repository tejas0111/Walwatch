# Phase 5: Blob Lifecycle Automation

> **For implementers:** Part of the master plan. Depends on Phase 1 (state machines registered). Parallel to Phases 3–4.

**Goal:** Automate the discovered→verified→tracked pipeline, tracked↔protected (policy match/unmatch), expiring→expired transition, and fix expiry_check to use policy engine inheritance.

---

### Task 5.1: Automated discovered→verified→tracked pipeline

**Files:**
- Modify: `api/src/routes/blobs.ts` (registration endpoint)
- Modify: `keeper/src/scanner.ts`
- Modify: `keeper/src/scheduler.ts` (register verification handler)

**Changes:**
Create a verification job that:
1. Picks up blobs in `discovered` status
2. Queries the Walrus aggregator to confirm blob existence, size, and current expiry epoch
3. On success: transitions `discovered→verified`, stores verified data
4. Auto-advances `verified→tracked` (blob is now under monitoring)
5. On failure (blob not found on network): moves to `archived` with reason
Register this as a system schedule handler (runs every N minutes).

- [ ] **Implement:** Verification pipeline, scheduler handler
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: automated discovered→verified→tracked pipeline"`

---

### Task 5.2: Automated tracked↔protected (policy match/unmatch)

**Files:**
- Modify: `keeper/src/policy-engine.ts` or new file `keeper/src/policy-reconciler.ts`
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Create a policy reconciliation job:
1. For each `tracked` blob, check if any active policy matches it (via `policyEngine.resolveEffectivePolicy`)
2. If matched: transition `tracked→protected`
3. For each `protected` blob, check if its matched policy is still active
4. If no longer matched (policy deleted/paused): transition `protected→tracked`
5. Run this on policy change events (event-driven) and periodically (schedule-based catch-all)

- [ ] **Implement:** Policy reconciliation job, schedule and event triggers
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: automated tracked↔protected policy match/unmatch"`

---

### Task 5.3: Automated expiring→expired transition

**Files:**
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Add a scheduler handler that runs periodically (e.g., every epoch boundary check) and queries:
```sql
UPDATE blob_registrations 
SET status = 'expired' 
WHERE status = 'expiring' AND expiry_epoch < $currentEpoch
```
Log the count of blobs expired. Emit `blob.expired` event for each. Add audit log entries.

- [ ] **Implement:** expiring→expired handler, event emission
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: automated expiring→expired transition"`

---

### Task 5.4: expiry_check uses policy engine inheritance

**Files:**
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Replace the direct SQL query in `expiry_check` handler (which uses `SELECT ... FROM policies WHERE org_id = ? LIMIT 1`) with a call to `policyEngine.resolveEffectivePolicy(blobId)`. This ensures the lead-time threshold comes from the correct inherited policy (wallet-level or tag-level override), not just the first org-level policy found.

- [ ] **Implement:** Refactor expiry_check to use policy engine
- [ ] **Compile:** `cd keeper && npx tsc --noEmit && cd ../api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: expiry_check uses policy engine inheritance resolution"`
