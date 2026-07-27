# Phase 7: Security & Permissions

> **For implementers:** Part of the master plan. Depends on Phase 1. Parallel to Phases 2–6. After completion, a **security review** must be run.

**Goal:** Implement capability-based permission system, project-level roles, permission resolution rules, bounded API keys, viewer role consistency, service account role, separate audit log grant, webhook signing, secret rotation, delegated signing, anomaly detection, and Redis-backed rate limiter.

---

### Task 7.1: Capability grant system (8 grants)

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: migration file 0035
- Create: `api/src/lib/permissions.ts`
- Modify: `api/src/middleware/auth.ts`
- Modify: All route files (swap role checks for capability checks)

**Changes:**
1. Add `capability_grants` table: `id (uuid PK)`, `org_id (FK)`, `project_id (nullable FK)`, `member_id (FK)`, `capability (text, one of 8 values)`, `granted_by (uuid FK)`, `created_at`.
2. Create `permissions.ts` with:
   - `Capability` enum: `MANAGE_POLICIES`, `MANAGE_BUDGETS`, `TRIGGER_RENEWALS`, `MANAGE_WALLETS`, `MANAGE_ALERTS`, `MANAGE_WEBHOOKS`, `MANAGE_API_KEYS`, `VIEW_AUDIT_LOG`
   - `requireCapability(capability: Capability)` middleware
   - `resolveEffectivePermissions(userId, scope)` function
3. Refactor auth middleware: add `requireCapability` alongside existing `requireRole`.
4. Update routes: swap `requireRole('admin')` with `requireCapability(Capability.MANAGE_POLICIES)` where appropriate.

- [ ] **Implement:** Schema, permissions.ts, capability grants, migrate route guards
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add capability grant system with 8 grants"`

---

### Task 7.2: Project-level role/permission system

**Files:**
- Modify: `api/src/db/schema.ts` (project_members table)
- Create: migration file 0036
- Modify: `api/src/routes/projects.ts` (member management)

**Changes:**
1. Add `project_members` table: `id (uuid PK)`, `project_id (FK)`, `member_id (FK)`, `role (text: owner|admin|member|viewer)`, `capabilities (jsonb)`, `created_at`. Unique on (project_id, member_id).
2. Add endpoints: `POST /projects/:id/members`, `DELETE /projects/:id/members/:memberId`, `PATCH /projects/:id/members/:memberId` (role change).
3. Implement resolution rule #1: explicit project-level role overrides org-level role.

- [ ] **Implement:** project_members table, API endpoints, resolution
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add project-level role and permission system"`

---

### Task 7.3: Permission resolution rules (5 rules)

**Files:**
- Create: `api/src/lib/permissions.ts` (if not done in 7.1)

**Changes:**
Implement `resolveEffectivePermission(userId, orgId, projectId?)` function that executes all 5 resolution rules:
1. Explicit project-level role/grant overrides org default
2. If no project-level assignment, org-level role applies
3. Team membership is additive (union of direct grants + team grants)
4. API Key permission = exactly what was assigned at creation (no inheritance)
5. No check ever fails open (deny if no grant found)

- [ ] **Implement:** Resolution function with all 5 rules
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: implement permission resolution rules"`

---

### Task 7.4: API key permission bounded by creator's permission

**Files:**
- Modify: `api/src/routes/api-keys.ts`

**Changes:**
Before creating an API key, resolve the creator's effective permissions at the requested scope. Verify that the requested permissions/role are a subset of the creator's own permissions. Return 403 if the creator is trying to grant more than they hold.

- [ ] **Implement:** Permission boundary check on API key creation
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: bound API key permissions to creator's permissions"`

---

### Task 7.5: Viewer role consistency

**Files:**
- Modify: Multiple route files in `api/src/routes/`

**Changes:**
Audit all GET/list endpoints and ensure Viewer role is properly checked:
- Currently: `api-keys.ts:72` uses `requireOrg` only — add role check (allow viewer to read)
- `audit-logs.ts:20` requires owner/admin — should allow viewer IF they have VIEW_AUDIT_LOG grant
- All other read endpoints should allow viewer role consistently

- [ ] **Implement:** Consistent Viewer role checks on all read endpoints
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: consistent viewer role checks across read endpoints"`

---

### Task 7.6: Service Account role

**Files:**
- Modify: `api/src/middleware/auth.ts`
- Modify: `api/src/routes/api-keys.ts`

**Changes:**
Allow assigning any role (owner/admin/member/viewer) to an API key at org or project scope. Map the API key to the assigned role in `resolveEffectivePermission`. This enables the "Service Account behaves identically to a human with that role" requirement.

- [ ] **Implement:** API key role assignment, resolution for service accounts
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add service account role for API keys"`

---

### Task 7.7: Audit log access as separate grant

**Files:**
- Modify: `api/src/routes/audit-logs.ts`
- Modify: `api/src/middleware/auth.ts`

**Changes:**
Add `VIEW_AUDIT_LOG` capability. Modify the audit log route guard to check for this capability instead of requiring owner/admin role. A user with VIEW_AUDIT_LOG grant but no other admin access can read audit logs but nothing else. Add migration to grant VIEW_AUDIT_LOG to existing owners/admins.

- [ ] **Implement:** Separate audit log grant, route guard
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: make audit log access a separate grantable capability"`

---

### Task 7.8: Webhook payload signing (HMAC-SHA256)

**Files:**
- Modify: `keeper/src/channels/webhook.ts`

**Changes:**
Before delivering webhook payload, compute HMAC-SHA256 signature using the webhook's configured secret. Add `X-Webhook-Signature` header containing `sha256=<hex-encoded-signature>`. Include the event payload body in the signature computation. This allows receivers to verify authenticity.

- [ ] **Implement:** HMAC signing, signature header
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add webhook payload signing (HMAC-SHA256)"`

---

### Task 7.9: Secret rotation support

**Files:**
- Modify: `api/src/lib/encryption.ts`
- Modify: `api/src/routes/api-keys.ts`
- Create: migration file 0037 (key_version column)

**Changes:**
Implement key versioning: add `key_version` integer column to `encryption_keys` or equivalent. Add `POST /encryption/rotate-key` admin endpoint. The `reEncrypt()` function (already defined but never called) should re-encrypt all secrets with the new key version. Support dual-key overlap window: old key still works for decrypting existing data, new key used for encrypting new data.

- [ ] **Implement:** Key versioning, rotation endpoint, reEncrypt integration
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add secret rotation with dual-key support"`

---

### Task 7.10: Delegated signing authority

**Files:**
- Modify: `api/src/routes/wallets.ts`
- Create: `api/src/lib/delegation.ts`

**Changes:**
Implement the full delegation primitive:
1. `POST /wallets/:id/delegate` — create delegation with scope (blob IDs or policy), spend ceiling, time bound
2. Store delegation securely (encrypted at rest)
3. Keeper enforces delegation bounds before signing renewal transactions
4. Each delegation usage emits `delegation.used` event for audit
5. `POST /wallets/:id/revoke-delegation` — immediate revocation

- [ ] **Implement:** Create, store, enforce, revoke delegation
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: implement delegated signing authority"`

---

### Task 7.11: Anomaly/abuse detection

**Files:**
- Create: `keeper/src/anomaly-detector.ts`

**Changes:**
Create an anomaly detection module that monitors for abnormal patterns:
- Sudden spike in manual renewal triggers (> X per minute per org)
- Budget override usage frequency
- Multiple API key creations in short window
- Excessive failed renewal attempts
When thresholds are exceeded, create alert events routed through the notification engine.

- [ ] **Implement:** Anomaly detector, threshold configuration
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add abuse/anomaly detection alerts"`

---

### Task 7.12: Redis-backed rate limiter

**Files:**
- Modify: `api/src/middleware/rate-limit.ts`

**Changes:**
Add a Redis-backed rate limit store option alongside the existing in-memory store. Use `ioredis` or `redis` package. Make the store configurable via environment variable (`RATE_LIMIT_STORE=memory|redis`). The Redis store uses `INCR` + `EXPIRE` pattern for atomic window tracking across multiple API instances.

- [ ] **Implement:** Redis rate limit store, configurable backend
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add Redis-backed rate limiter"`

---

### Task 7.13: SSRF protection for webhook channel URLs

**Files:**
- Already fixed in baseline (VULN-001): `keeper/src/channels/webhook.ts`
- Verify fix: HTTPS-only, private IP blocklist, no redirects, 10s timeout

- [ ] **Verify:** DNS lookup + IP range check + protocol validation + redirect disable
- [ ] **Test:** Unit test for webhook channel with internal URLs (should reject)
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`

### Task 7.14: Remove silent plaintext fallback in encryption

**Files:**
- Already fixed in baseline (VULN-002): `api/src/routes/alerts.ts`
- Verify fix: try/catch removed, url added to sensitive fields

- [ ] **Verify:** `encryptChannelConfig` now propagates errors instead of falling back
- [ ] **Compile:** `cd api && npx tsc --noEmit`

### Task 7.15: Verify webhook URL field name consistency (VERIFY-001)

**Files:**
- Already verified: webhook channel reads `config.url`, sensitive fields now include `'url'`
- Confirm encryption covers webhook URLs

- [ ] **Verify:** `encryptChannelConfig` encrypts `url` field
- [ ] **Test:** Add unit test proving url field is encrypted

### Task 7.16: Fix API key permission override (VERIFY-002)

**Files:**
- Investigate: `api/src/middleware/auth.ts`, `api/src/middleware/org-scope.ts`

**Changes:**
If `requireOrg` overwrites `c.get('role')` from API key's `permissions`:
1. In `org-scope.ts`, when the actor is an API key, don't overwrite role — keep the key's assigned permissions
2. Or: store resolved role under a different key (`effectiveRole`) so API key permissions are preserved

- [ ] **Investigate and fix:** Ensure API key permissions are not overwritten
- [ ] **Compile:** `cd api && npx tsc --noEmit`

### Security Review Checkpoint

After Phase 7, run the security-review skill against all modified files. Address any HIGH/MEDIUM confidence findings.
