-- Task 3.2: Persistent job_executions table

CREATE TABLE IF NOT EXISTS job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  metadata JSONB,
  trace_id TEXT,
  org_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_executions_status ON job_executions(status);
CREATE INDEX IF NOT EXISTS idx_job_executions_org ON job_executions(org_id);
CREATE INDEX IF NOT EXISTS idx_job_executions_created ON job_executions(created_at DESC);
