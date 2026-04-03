-- Migration 009: Add sequence_index to tasks for multi-agent workflow ordering
-- This column tracks the order of tasks within a run's workflow

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sequence_index INTEGER DEFAULT 0;

-- Create index for efficient ordering queries
CREATE INDEX IF NOT EXISTS idx_tasks_sequence_index ON tasks(run_id, sequence_index);

-- Add comment for documentation
COMMENT ON COLUMN tasks.sequence_index IS 'Order of this task within the run workflow (0-indexed)';
