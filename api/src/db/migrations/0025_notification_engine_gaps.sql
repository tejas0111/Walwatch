-- Spec 12 gaps: Add link_to_entity to alert_events, dedup_window_seconds to alert_rules
-- Make audit_logs.user_id nullable for system-generated events

ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS link_to_entity text;

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS dedup_window_seconds integer DEFAULT 300;

ALTER TABLE audit_logs
  ALTER COLUMN user_id DROP NOT NULL;
