ALTER TABLE "organizations" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "org_members" ALTER COLUMN "role" SET DEFAULT 'member';
--> statement-breakpoint
UPDATE "org_members" SET "role" = 'member' WHERE "role" = 'developer';
--> statement-breakpoint
UPDATE "org_members" SET "role" = 'member' WHERE "role" = 'billing';
