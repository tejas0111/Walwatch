-- Task 3.1: Generic job queue table for background jobs

CREATE TABLE IF NOT EXISTS job_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL,
  payload jsonb,
  entity_type text,
  entity_id text,
  priority integer DEFAULT 50,
  status text NOT NULL DEFAULT 'queued',
  scheduled_for timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error text,
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 5,
  trace_id text,
  org_id uuid
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_priority ON job_queue(status, priority, scheduled_for);
