-- Migration 0037: Add escalation_channels to alert_rules for multi-level escalation chain
ALTER TABLE alert_rules ADD COLUMN escalation_channels JSONB DEFAULT '[]'::jsonb;
