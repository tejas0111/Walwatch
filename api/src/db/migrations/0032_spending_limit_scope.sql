-- Migration 0032: Spending limit XOR scoping
-- Replaces wallet_id with polymorphic scope + scope_target_id

CREATE TYPE spending_limit_scope AS ENUM ('organization', 'project', 'wallet', 'policy');

ALTER TABLE spending_limits ADD COLUMN scope spending_limit_scope;
ALTER TABLE spending_limits ADD COLUMN scope_target_id UUID;

-- Migrate existing wallet-scoped data
UPDATE spending_limits SET scope = 'wallet', scope_target_id = wallet_id WHERE wallet_id IS NOT NULL;

-- Make columns NOT NULL after migration
ALTER TABLE spending_limits ALTER COLUMN scope SET NOT NULL;
ALTER TABLE spending_limits ALTER COLUMN scope_target_id SET NOT NULL;

-- Drop old wallet_id column
ALTER TABLE spending_limits DROP COLUMN wallet_id;
