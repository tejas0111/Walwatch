ALTER TABLE "renewal_jobs" ADD COLUMN "actual_cost" numeric(20, 2);
--> statement-breakpoint
ALTER TABLE "renewal_jobs" ADD COLUMN "tx_digest" text;
