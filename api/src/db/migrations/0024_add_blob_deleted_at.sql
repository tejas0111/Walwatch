-- Add deleted_at column to blob_registrations for soft-delete lifecycle state
-- Spec 07: Deleted is one of 10 lifecycle states, not a row removal

ALTER TABLE blob_registrations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
