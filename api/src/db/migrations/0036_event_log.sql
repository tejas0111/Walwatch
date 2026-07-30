-- Migration 0036: Event log table for durable event bus
CREATE TABLE IF NOT EXISTS event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  payload JSONB,
  actor_id TEXT,
  entity_id TEXT,
  entity_type TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  org_id UUID,
  processed BOOLEAN DEFAULT FALSE,
  trace_id TEXT
);

CREATE INDEX idx_event_log_unprocessed ON event_log(recorded_at) WHERE processed = FALSE;
CREATE INDEX idx_event_log_name ON event_log(event_name);
CREATE INDEX idx_event_log_org ON event_log(org_id);
