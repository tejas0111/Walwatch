CREATE TABLE delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  delegate_address TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('blob_ids', 'policy', 'all')),
  scope_targets JSONB DEFAULT '[]'::jsonb,
  spend_ceiling TEXT NOT NULL DEFAULT '0',
  time_bound_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_bound_end TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_delegations_wallet ON delegations(wallet_id);
CREATE INDEX idx_delegations_delegate ON delegations(delegate_address);