ALTER TABLE "policies" ADD COLUMN "scope" text;
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "scope_target_id" text;
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "role" text DEFAULT 'member';
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "deleted_at" timestamp with time zone;
