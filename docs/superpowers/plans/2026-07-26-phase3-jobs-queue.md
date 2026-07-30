# Phase 3: Background Jobs & Queue

> **For implementers:** Part of the master plan. Depends on Phase 1. Runs parallel to Phase 2.

**Goal:** Create formal queue abstraction, persistent job execution tracking, job priority system, dead-letter queue isolation, and stale-job recovery improvements.

---

### Task 3.1: Formal queue abstraction layer

**Files:**
- Create: `api/src/lib/queue.ts`
- Create: `api/src/lib/background-jobs.ts`

**Changes:**
Create `queue.ts` with generic publish/consume/ack semantics backed by a `job_queue` table:

```typescript
// queue.ts
export type JobType = 'renewal' | 'notification' | 'scan' | 'cleanup' | 'budget_rollover';

export interface JobMessage<T = unknown> {
  id: string;
  type: JobType;
  payload: T;
  entityType: string;
  entityId: string;
  priority: number;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'dlq';
  scheduledFor: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  attempts: number;
  maxAttempts: number;
}

export async function publishJob<T>(db: DrizzleDb, job: Omit<JobMessage<T>, 'id' | 'status' | 'createdAt' | 'attempts'>): Promise<string>
export async function claimNextJob(db: DrizzleDb, types?: JobType[]): Promise<JobMessage | null>
export async function completeJob(db: DrizzleDb, id: string, result?: unknown): Promise<void>
export async function failJob(db: DrizzleDb, id: string, error: string): Promise<void>
export async function sendToDLQ(db: DrizzleDb, id: string, reason: string): Promise<void>
```

Create `background-jobs.ts` with a consumer registry pattern:

```typescript
// background-jobs.ts
type JobHandler = (job: JobMessage, db: DrizzleDb) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();

export function registerHandler(type: JobType, handler: JobHandler): void { ... }
export async function processNextJob(db: DrizzleDb): Promise<boolean> { ... }
```

- [ ] **Implement:** Create queue.ts and background-jobs.ts
- [ ] **Compile:** `cd api && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add formal queue abstraction layer"`

---

### Task 3.2: Persistent job_executions table

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: migration file 0029
- Modify: `keeper/src/job-monitor.ts`

**Changes:**
Add `job_executions` table to schema: `id (uuid, PK)`, `job_type (text)`, `entity_type (text)`, `entity_id (uuid)`, `status (text)`, `started_at (timestamptz)`, `completed_at (timestamptz)`, `duration_ms (integer)`, `error (text)`, `metadata (jsonb)`, `trace_id (text)`, `org_id (uuid FK)`.

Replace in-memory `JobMonitor` with one that writes to this table. Keep the in-memory cache for hot reads but always persist.

- [ ] **Implement:** Schema, migration, persistent JobMonitor
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add persistent job_executions table"`

---

### Task 3.3: Job priority system

**Files:**
- Modify: `api/src/db/schema.ts` (renewal_jobs add priority)
- Create: migration file 0030
- Modify: `keeper/src/index.ts` (polling query)

**Changes:**
Add `priority` column (integer, lower=higher) to `renewal_jobs`. Set priority based on: renewal approaching expiry = 10, standard renewal = 50, scan = 100, cleanup = 200. Update the polling query to order by `priority ASC, scheduled_for ASC NULLS FIRST`.

- [ ] **Implement:** Add priority column, update polling query
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add job priority system"`

---

### Task 3.4: Dead-letter queue isolation

**Files:**
- Create: migration file 0031 (add `job_dlq` table)
- Modify: `keeper/src/index.ts`
- Modify: `api/src/lib/queue.ts`

**Changes:**
Create `job_dlq` table: same columns as `job_queue` + `dlq_reason (text)`, `dlqged_at (timestamptz)`. When a job exhausts maxAttempts, move it from `job_queue` to `job_dlq` instead of leaving it in `failed_final` status. Exclude DLQ records from polling queries. Add a DLQ monitoring function that counts DLQ entries.

- [ ] **Implement:** DLQ table, move logic, exclusion from polling
- [ ] **Compile:** `cd api && npx tsc --noEmit && cd ../keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "feat: add dead-letter queue isolation"`

---

### Task 3.5: Stale-job recovery with blob state rollback

**Files:**
- Modify: `keeper/src/index.ts`
- Modify: `keeper/src/scheduler.ts`

**Changes:**
Enhance `recoverStaleInProgressJobs()` to also roll back `blob_registrations.status` from `renewing` to `expiring` when a renewal job is stuck. Add heartbeat mechanism: add `heartbeat_at` column to `renewal_jobs`, update it periodically during long-running executions. Make stale threshold configurable per job type.

- [ ] **Implement:** Blob state rollback, heartbeat, configurable threshold
- [ ] **Compile:** `cd keeper && npx tsc --noEmit`
- [ ] **Commit:** `git commit -m "fix: stale-job recovery handles blob state rollback and heartbeat"`
