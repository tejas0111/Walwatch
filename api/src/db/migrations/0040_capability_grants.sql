CREATE TYPE capability_enum AS ENUM (
  'manage_policies', 'manage_budgets', 'trigger_renewals',
  'manage_wallets', 'manage_alerts', 'manage_webhooks',
  'manage_api_keys', 'view_audit_log'
);

CREATE TABLE capability_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  project_id UUID REFERENCES projects(id),
  user_id UUID NOT NULL REFERENCES users(id),
  capability capability_enum NOT NULL,
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id, capability)
);

CREATE INDEX idx_cap_grants_user ON capability_grants(user_id);
CREATE INDEX idx_cap_grants_org ON capability_grants(org_id);
