-- Add missing Policy Engine fields per Spec 09
-- autoRenewalEnabled: separates "should auto-renew" from "policy is active"
-- budgetId/spendingLimitId: reference to Budget/Spending Limit
-- publisherPriorityOverride: optional priority override

ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS auto_renewal_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS budget_id uuid REFERENCES budgets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spending_limit_id uuid REFERENCES spending_limits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publisher_priority_override integer;
