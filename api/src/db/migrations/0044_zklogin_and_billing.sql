-- Add zkLogin/OAuth fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_subject TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zklogin_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ephemeral_key_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ephemeral_key_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zklogin_proof_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zklogin_jwt_randomness TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zklogin_max_epoch BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_key_export_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_unique ON users (oauth_provider, oauth_subject);

-- Add Stripe billing fields to subscriptions table
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_method TEXT;
