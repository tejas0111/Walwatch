-- Migration: 0019_schedules_max_staleness
-- Adds system-enforced max_staleness_ms for user-configurable schedules (spec 10)

ALTER TABLE "schedules"
  ADD COLUMN IF NOT EXISTS "max_staleness_ms" bigint;

-- Set default max_staleness for existing user schedules (12 hours)
UPDATE "schedules"
  SET "max_staleness_ms" = 43200000
  WHERE "type" = 'user' AND "max_staleness_ms" IS NULL;

-- Set default max_staleness for system schedules (1 hour)
UPDATE "schedules"
  SET "max_staleness_ms" = 3600000
  WHERE "type" = 'system' AND "max_staleness_ms" IS NULL;
