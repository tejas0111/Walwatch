-- Migration 0027: cost_records immutable ledger table
CREATE TABLE IF NOT EXISTS cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_registration_id UUID REFERENCES blob_registrations(id) ON DELETE SET NULL,
  renewal_job_id UUID REFERENCES renewal_jobs(id) ON DELETE SET NULL,
  estimated_cost NUMERIC(20, 6),
  actual_cost NUMERIC(20, 6),
  window_id TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL
);

-- Immutable: no update or delete permitted
CREATE OR REPLACE FUNCTION prevent_cost_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'cost_records are immutable: update/delete not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_records_immutable
  BEFORE UPDATE OR DELETE ON cost_records
  FOR EACH ROW EXECUTE FUNCTION prevent_cost_record_mutation();

-- Index for budget window queries
CREATE INDEX idx_cost_records_org_window ON cost_records(org_id, recorded_at);
CREATE INDEX idx_cost_records_blob ON cost_records(blob_registration_id);
