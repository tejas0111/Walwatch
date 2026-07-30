-- Task 3.3: Job priority system

ALTER TABLE renewal_jobs ADD COLUMN priority INTEGER DEFAULT 50 NOT NULL;

-- Set priority based on urgency
UPDATE renewal_jobs SET priority = 10 WHERE status IN ('in_progress', 'retrying') AND scheduled_for < NOW() + INTERVAL '1 hour';
UPDATE renewal_jobs SET priority = 50 WHERE priority = 50; -- default
UPDATE renewal_jobs SET priority = 100 WHERE status = 'estimated' AND scheduled_for > NOW() + INTERVAL '24 hours';
