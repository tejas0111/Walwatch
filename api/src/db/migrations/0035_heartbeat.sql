-- Migration 0035: Add heartbeat_at to renewal_jobs for stale-job recovery
ALTER TABLE renewal_jobs ADD COLUMN heartbeat_at TIMESTAMPTZ;
CREATE INDEX idx_renewal_jobs_heartbeat ON renewal_jobs(heartbeat_at) WHERE status = 'in_progress';
