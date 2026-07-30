-- Migration: 0020_schedule_runs
-- Adds run history table for scheduler observability (spec 10)

CREATE TABLE IF NOT EXISTS "schedule_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL REFERENCES "public"."schedules"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'running',
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "duration_ms" bigint,
  "error" text,
  "details" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_schedule_runs_schedule_id" ON "schedule_runs"("schedule_id");
