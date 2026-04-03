-- Migration 006: Budget Ledger table + Dead-letter queue
-- Budget ledger provides line-item tracking for every cost event (token usage, API call)
-- Dead-letter queue stores permanently failed tasks for manual inspection/retry

-- Budget Ledger: tracks individual cost events per run
CREATE TABLE IF NOT EXISTS budget_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES provider_definitions(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,  -- 'PROVIDER_CALL', 'TOOL_EXECUTION', 'RETRY'
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(12, 8) DEFAULT 0,
  model_name VARCHAR(200),
  provider_name VARCHAR(200),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dead-letter queue: stores permanently failed tasks
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_role VARCHAR(100),
  failure_type VARCHAR(100),
  failure_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 0,
  task_input JSONB DEFAULT '{}',
  retried_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for budget ledger
CREATE INDEX IF NOT EXISTS idx_budget_ledger_run_id ON budget_ledger(run_id);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_run_id_created ON budget_ledger(run_id, created_at);

-- Indexes for dead-letter queue
CREATE INDEX IF NOT EXISTS idx_dead_letter_run_id ON dead_letter_queue(run_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_pending ON dead_letter_queue(created_at) WHERE retried_at IS NULL;
