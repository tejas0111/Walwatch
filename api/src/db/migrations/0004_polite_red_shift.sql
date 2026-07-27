CREATE TABLE "blob_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"blob_id" text NOT NULL,
	"name" text,
	"size_bytes" bigint,
	"content_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"upload_date" timestamp with time zone,
	"expiry_epoch" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"tags" text[] DEFAULT '{}',
	"sui_vault_id" text,
	"owner_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blob_registrations" ADD CONSTRAINT "blob_registrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_registrations" ADD CONSTRAINT "blob_registrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;