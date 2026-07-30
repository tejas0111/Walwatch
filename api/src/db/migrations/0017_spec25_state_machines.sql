-- Migration: 0017_spec25_state_machines
-- Implements spec 25 state machines, spec 07 blob lifecycle, spec 26 event entities

-- ============================================================
-- 1. Blob lifecycle: add 10-state columns (spec 07)
-- ============================================================
ALTER TABLE "blob_registrations"
  ALTER COLUMN "status" SET DEFAULT 'discovered';

ALTER TABLE "blob_registrations"
  ADD COLUMN "discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "verified_at" timestamp with time zone,
  ADD COLUMN "tracked_at" timestamp with time zone,
  ADD COLUMN "protected_at" timestamp with time zone,
  ADD COLUMN "expiring_at" timestamp with time zone,
  ADD COLUMN "renewing_at" timestamp with time zone,
  ADD COLUMN "renewed_at" timestamp with time zone,
  ADD COLUMN "expired_at" timestamp with time zone;

-- Migrate existing 'active' rows to 'tracked' (the equivalent monitoring state)
UPDATE "blob_registrations" SET "status" = 'tracked', "tracked_at" = "created_at" WHERE "status" = 'active';
UPDATE "blob_registrations" SET "discovered_at" = "created_at" WHERE "discovered_at" IS NULL;
--> statement-breakpoint

-- ============================================================
-- 2. Renewal Jobs: 7-state machine (spec 25)
-- ============================================================
ALTER TABLE "renewal_jobs"
  ALTER COLUMN "status" SET DEFAULT 'estimated';

ALTER TABLE "renewal_jobs"
  ADD COLUMN "estimated_cost" bigint,
  ADD COLUMN "blocked_by_limit_id" uuid REFERENCES "public"."spending_limits"("id") ON DELETE SET NULL,
  ADD COLUMN "supersedes" uuid,
  ADD COLUMN "estimated_at" timestamp with time zone;

-- Migrate existing status values
UPDATE "renewal_jobs" SET "status" = 'pending' WHERE "status" = 'queued';
UPDATE "renewal_jobs" SET "status" = 'failed_final' WHERE "status" = 'failed';
UPDATE "renewal_jobs" SET "status" = 'blocked_by_budget' WHERE "status" = 'cancelled';
--> statement-breakpoint

-- ============================================================
-- 3. Teams: add missing status column
-- ============================================================
ALTER TABLE "teams"
  ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint

-- ============================================================
-- 4. Alert Rules: add paused_at column
-- ============================================================
ALTER TABLE "alert_rules"
  ADD COLUMN "paused_at" timestamp with time zone;
--> statement-breakpoint

-- ============================================================
-- 5. Policies: change default status to 'draft'
-- ============================================================
ALTER TABLE "policies"
  ALTER COLUMN "status" SET DEFAULT 'draft';
UPDATE "policies" SET "status" = 'draft' WHERE "status" = 'active';
--> statement-breakpoint

-- ============================================================
-- 6. Budgets: add defined state and window tracking
-- ============================================================
ALTER TABLE "budgets"
  ALTER COLUMN "status" SET DEFAULT 'defined';

ALTER TABLE "budgets"
  ADD COLUMN "window_start" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "window_end" timestamp with time zone;

UPDATE "budgets" SET "status" = 'defined' WHERE "status" = 'active';
--> statement-breakpoint

-- ============================================================
-- 7. Spending Limits: add defined/paused states
-- ============================================================
ALTER TABLE "spending_limits"
  ALTER COLUMN "status" SET DEFAULT 'defined';

ALTER TABLE "spending_limits"
  ADD COLUMN "paused_at" timestamp with time zone;

UPDATE "spending_limits" SET "status" = 'defined' WHERE "status" = 'active';
--> statement-breakpoint

-- ============================================================
-- 8. Webhooks table (spec 25 state machine)
-- ============================================================
CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "secret" text,
  "events" text[] DEFAULT '{}' NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ============================================================
-- 9. Alert Events table (spec 25/26)
-- ============================================================
CREATE TABLE IF NOT EXISTS "alert_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "alert_rule_id" uuid REFERENCES "public"."alert_rules"("id") ON DELETE SET NULL,
  "blob_registration_id" uuid REFERENCES "public"."blob_registrations"("id") ON DELETE SET NULL,
  "renewal_job_id" uuid REFERENCES "public"."renewal_jobs"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "message" text NOT NULL,
  "details" jsonb DEFAULT '{}',
  "status" text DEFAULT 'fired' NOT NULL,
  "channel_id" text,
  "fired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "escalated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ============================================================
-- 10. Notifications delivery records table
-- ============================================================
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "alert_event_id" uuid NOT NULL REFERENCES "public"."alert_events"("id") ON DELETE CASCADE,
  "channel_id" uuid REFERENCES "public"."notification_channels"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "error" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
