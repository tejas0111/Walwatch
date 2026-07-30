-- Indexes for blob_registrations
CREATE INDEX IF NOT EXISTS idx_blob_registrations_org_id ON blob_registrations(org_id);
CREATE INDEX IF NOT EXISTS idx_blob_registrations_status ON blob_registrations(status);

-- Index for renewal_jobs (keeper's main query)
CREATE INDEX IF NOT EXISTS idx_renewal_jobs_status_scheduled ON renewal_jobs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_renewal_jobs_blob_registration ON renewal_jobs(blob_registration_id);

-- Index for policies (policy resolution queries)
CREATE INDEX IF NOT EXISTS idx_policies_org_scope ON policies(org_id, scope, scope_target_id);

-- Index for spending_limits (budget check queries)
CREATE INDEX IF NOT EXISTS idx_spending_limits_wallet_org ON spending_limits(wallet_id, org_id, status);

-- Index for audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id);

-- Index for alert_events (keeper's processFiredAlerts query)
CREATE INDEX IF NOT EXISTS idx_alert_events_status ON alert_events(status);
