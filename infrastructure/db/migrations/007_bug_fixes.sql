-- Migration 007: Bug fixes and enhancements
-- Adds columns for checkpoint idempotency and DLQ retry tracking

-- Add last_restored_checkpoint_id to runs for idempotent checkpoint restoration
ALTER TABLE runs ADD COLUMN IF NOT EXISTS last_restored_checkpoint_id VARCHAR(50);

-- Add dlq_retry_count to dead_letter_queue to prevent infinite retry loops
ALTER TABLE dead_letter_queue ADD COLUMN IF NOT EXISTS dlq_retry_count INTEGER DEFAULT 0;

-- Add index on runs(last_restored_checkpoint_id) for quick lookup
CREATE INDEX IF NOT EXISTS idx_runs_last_restored_checkpoint ON runs(last_restored_checkpoint_id) WHERE last_restored_checkpoint_id IS NOT NULL;

-- Add index on dead_letter_queue(dlq_retry_count) for filtering
CREATE INDEX IF NOT EXISTS idx_dlq_retry_count ON dead_letter_queue(dlq_retry_count);

-- Ensure tasks(run_id) index exists for performance
CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id);

-- Add comment explaining the new columns
COMMENT ON COLUMN runs.last_restored_checkpoint_id IS 'ID of the last checkpoint restored for this run, prevents double-restore';
COMMENT ON COLUMN dead_letter_queue.dlq_retry_count IS 'Number of times this entry has been retried from DLQ, max 3';
