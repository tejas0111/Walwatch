CREATE TABLE IF NOT EXISTS "publishers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "endpoint" text,
  "wallet_address" text,
  "sui_vault_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_heartbeat_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "aggregators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "publisher_id" uuid REFERENCES "public"."publishers"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "endpoint" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_heartbeat_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "public"."projects"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "amount" bigint NOT NULL,
  "period" text DEFAULT 'monthly' NOT NULL,
  "spent" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "alert_threshold" integer DEFAULT 80,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spending_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_id" uuid NOT NULL REFERENCES "public"."wallets"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "name" text,
  "amount" bigint NOT NULL,
  "period" text DEFAULT 'daily' NOT NULL,
  "spent" bigint DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "renewal_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "blob_registration_id" uuid NOT NULL REFERENCES "public"."blob_registrations"("id") ON DELETE CASCADE,
  "policy_id" uuid REFERENCES "public"."policies"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "last_error" text,
  "scheduled_for" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
  "team_id" uuid NOT NULL REFERENCES "public"."teams"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'member' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("team_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "token" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
