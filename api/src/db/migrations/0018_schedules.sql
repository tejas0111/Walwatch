-- Migration: 0018_schedules
-- Implements spec 10: Scheduler Engine

CREATE TABLE IF NOT EXISTS "schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL DEFAULT 'system',
  "cron_expr" text NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_completed_at" timestamp with time zone,
  "enabled" boolean NOT NULL DEFAULT true,
  "min_interval_ms" bigint,
  "config" jsonb DEFAULT '{}'::jsonb,
  "status" text DEFAULT 'active' NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed system schedules for all existing orgs
INSERT INTO "schedules" ("org_id", "name", "type", "cron_expr", "enabled", "config")
SELECT o.id, 'expiry-threshold-check', 'system', '*/5 * * * *', true, '{"type": "expiry_check", "description": "Check blobs approaching expiry threshold"}'::jsonb
FROM "organizations" o
ON CONFLICT DO NOTHING;

INSERT INTO "schedules" ("org_id", "name", "type", "cron_expr", "enabled", "config")
SELECT o.id, 'budget-window-rollover', 'system', '0 0 * * *', true, '{"type": "budget_rollover", "description": "Roll over budget windows"}'::jsonb
FROM "organizations" o
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS "idx_schedules_org" ON "schedules"("org_id");
CREATE INDEX IF NOT EXISTS "idx_schedules_enabled" ON "schedules"("enabled");
