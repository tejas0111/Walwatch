ALTER TABLE "wallets" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "delegation_revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
