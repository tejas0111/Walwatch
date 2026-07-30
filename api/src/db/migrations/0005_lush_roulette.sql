CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"renew_threshold" integer NOT NULL,
	"renew_extension" integer NOT NULL,
	"max_total_epochs" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_assignments" (
	"policy_id" uuid NOT NULL,
	"blob_registration_id" uuid NOT NULL,
	CONSTRAINT "policy_assignments_policy_id_blob_registration_id_pk" PRIMARY KEY("policy_id","blob_registration_id")
);
--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_blob_registration_id_blob_registrations_id_fk" FOREIGN KEY ("blob_registration_id") REFERENCES "public"."blob_registrations"("id") ON DELETE cascade ON UPDATE no action;