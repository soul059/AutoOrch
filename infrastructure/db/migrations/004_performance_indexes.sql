-- Migration 004: Performance and safety improvements
-- Adds composite indexes for common query patterns and approval expiry index

-- Composite index for the most common task query: find queued tasks for a run
CREATE INDEX IF NOT EXISTS idx_tasks_run_id_state ON tasks(run_id, state);

-- Index for approval expiry sweep: find pending approvals past their deadline
CREATE INDEX IF NOT EXISTS idx_approvals_pending_expiry ON approvals(expires_at)
  WHERE state = 'PENDING';

-- Index for orphan recovery: find tasks stuck in active states
CREATE INDEX IF NOT EXISTS idx_tasks_active_states ON tasks(state)
  WHERE state IN ('DISPATCHED', 'RUNNING');

-- Index for budget calculation: sum token usage for a run
CREATE INDEX IF NOT EXISTS idx_tasks_run_token_usage ON tasks(run_id)
  WHERE token_usage IS NOT NULL;
