# Phase 8: Observability & Error Handling

> **For implementers:** Part of the master plan. Depends on Phase 3 (queue for systematic alerting). Parallel to Phases 5–7.

**Goal:** Implement distributed trace propagation, systemic error→operational alert routing, recovery paths on persistent errors, compensating action framework, and fix userFacingMessage test regression.

---

### Task 8.1: Distributed trace propagation (API→keeper)

**Files:**
- Modify: `api/src/middleware/request-id.ts`
- Modify: `keeper/src/index.ts`
- Modify: `api/src/lib/event-bus.ts`
- Modify: `api/src/lib/background-jobs.ts`

**Changes:**
When the API publishes an event or enqueues a job, propagate the current trace ID (`requestId`/`traceId`) through the event payload or job metadata. The keeper worker reads the trace ID from the event/job and uses it for its own execution context. This enables following a single user action from HTTP request through job queue into background execution. Include trace ID in activity_feed entries, audit logs, and job_executions.

- [ ] **Implement:** Trace ID propagation through events and jobs
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: propagate trace IDs from API to keeper worker"`

---

### Task 8.2: Systemic error → operational alert

**Files:**
- Modify: `api/src/lib/errors.ts`
- Modify: `keeper/src/index.ts`
- Create: `keeper/src/systemic-alert-handler.ts`

**Changes:**
Create a subscriber/listener that consumes `SystemicError` instances and routes them to operational alerts. The handler:
1. Creates an alert event of type `system.degraded` or `system.error`
2. Routes through the notification engine to operator-configured channels (email, PagerDuty-like)
3. Includes error details, affected tenant count, and suggested remediation
4. Has rate-limiting to prevent alert storms

- [ ] **Implement:** Systemic error subscriber, operational alert routing
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: route systemic errors to operational alerts"`

---

### Task 8.3: Recovery paths on Persistent errors

**Files:**
- Modify: `api/src/lib/errors.ts`
- Modify: `api/src/lib/error-response.ts`

**Changes:**
Add `recoveryPath` and `remediationSteps` metadata to error responses. Every Persistent/Configuration error class carries:
- `userAction`: what the user can do to fix it ("Update the webhook URL in Settings > Integrations")
- `adminAction`: what an admin can do ("Verify the external service API key has not expired")
- `documentationUrl`: link to relevant docs

Update `ApiError` type to include these fields. Return them in API error responses for Persistent errors.

- [ ] **Implement:** Recovery path metadata on error classes
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add recovery paths to persistent error responses"`

---

### Task 8.4: Compensating action framework

**Files:**
- Create: `api/src/lib/compensating-actions.ts`

**Changes:**
Implement a general compensating action framework for partial failures:
```typescript
interface CompensableAction<T> {
  execute(): Promise<T>;
  compensate(): Promise<void>;
  description: string;
}

async function executeWithCompensation<T>(actions: CompensableAction<T>[]): Promise<T[]> {
  const completed: CompensableAction<T>[] = [];
  for (const action of actions) {
    try {
      const result = await action.execute();
      completed.push(action);
    } catch (err) {
      // Roll back all completed actions in reverse order
      for (const done of completed.reverse()) {
        await done.compensate();
      }
      throw err;
    }
  }
}
```
This replaces ad-hoc rollback logic and should be used for multi-step operations like bulk blob operations, policy changes that affect multiple blobs, etc.

- [ ] **Implement:** Compensating action framework
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add compensating action framework for partial failures"`

---

### Task 8.5: Fix userFacingMessage regression

**Files:**
- Modify: `api/src/lib/errors.ts`

**Changes:**
Fix the `userFacingMessage` function so that unclassified `Error` objects return `'An unexpected error occurred.'` instead of the raw error message. The issue is that `if (obj.message) return obj.message` fires for plain `Error` objects before reaching the default. Change the fallback order: check for known error classes first, then `failureClass`, then default to the generic message.

Verify the fix by running the error classification tests.

- [ ] **Implement:** Fix userFacingMessage fallback
- [ ] **Test:** `cd api && npx vitest run api/src/__tests__/error-classification.test.ts`
- [ ] **Commit:** `git commit -m "fix: userFacingMessage returns default for unclassified errors"`
