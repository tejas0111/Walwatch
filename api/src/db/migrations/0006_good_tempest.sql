CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"type" text DEFAULT 'owned' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"spending_limit" bigint,
	"balance" bigint DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_org_address_unique" ON "wallets" USING btree ("org_id","address");