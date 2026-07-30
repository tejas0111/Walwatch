-- Migration 0034: Dead-letter queue table
CREATE TABLE IF NOT EXISTS job_dlq (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB,
  entity_type TEXT,
  entity_id TEXT,
  priority INTEGER,
  status TEXT NOT NULL DEFAULT 'dlq',
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  attempts INTEGER,
  max_attempts INTEGER,
  trace_id TEXT,
  org_id UUID,
  dlq_reason TEXT NOT NULL,
  dlqged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_job_dlq_created ON job_dlq(dlqged_at DESC);
