CREATE UNIQUE INDEX IF NOT EXISTS "idx_renewal_jobs_unique_active" ON "renewal_jobs" ("blob_registration_id") WHERE "status" = 'in_progress';
