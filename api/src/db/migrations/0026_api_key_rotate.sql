-- Task 1.6: Add previousKeyHash and rotatedAt columns for API key rotation

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS previous_key_hash text;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS rotated_at timestamp with time zone;
