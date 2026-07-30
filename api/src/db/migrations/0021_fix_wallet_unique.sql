DROP INDEX IF EXISTS "wallets_org_address_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_org_address_unique" ON "wallets" USING btree ("org_id","project_id","address") WHERE "deleted_at" IS NULL;
