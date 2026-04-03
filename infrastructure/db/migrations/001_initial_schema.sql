-- AutoOrch Database Schema
-- Migration 001: Initial schema

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════
-- ENUM TYPES
-- ═══════════════════════════════════════════════════════════════

CREATE TYPE run_state AS ENUM (
  'DRAFT', 'PLANNING', 'ROUTING', 'EXECUTING',
  'WAITING_APPROVAL', 'RETRYING', 'PAUSED',
  'FAILED', 'COMPLETED', 'CANCELLED'
);

CREATE TYPE task_state AS ENUM (
  'PENDING', 'QUEUED', 'DISPATCHED', 'RUNNING',
  'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'
);

CREATE TYPE approval_state AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'
);

CREATE TYPE failure_type AS ENUM (
  'PROVIDER_ERROR', 'TIMEOUT', 'INVALID_OUTPUT',
  'BUDGET_EXCEEDED', 'POLICY_DENIED', 'APPROVAL_REJECTED',
  'SANDBOX_ERROR', 'INTERNAL_ERROR'
);

CREATE TYPE risk_level AS ENUM (
  'SAFE', 'ELEVATED', 'HIGH_RISK', 'BLOCKED'
);

CREATE TYPE routing_strategy AS ENUM (
  'USER_SELECTED', 'ROLE_DEFAULT', 'LOCAL_FIRST',
  'CLOUD_FIRST', 'COST_AWARE', 'FALLBACK_CHAIN'
);

CREATE TYPE provider_type AS ENUM (
  'OLLAMA', 'GEMINI', 'ANTHROPIC', 'OPENAI_COMPATIBLE'
);

CREATE TYPE agent_role AS ENUM (
  'PLANNER', 'RESEARCHER', 'BUILDER', 'REVIEWER', 'OPERATIONS'
);

-- ═══════════════════════════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════════════════════════

-- Runs
CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt TEXT NOT NULL,
  state run_state NOT NULL DEFAULT 'DRAFT',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  correlation_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  provider_overrides JSONB DEFAULT '{}',
  budget_limit JSONB NOT NULL DEFAULT '{"maxTokens": 100000, "maxCostUsd": 10.0, "maxLoopIterations": 50}',
  checkpoint_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_role agent_role NOT NULL,
  state task_state NOT NULL DEFAULT 'PENDING',
  depends_on UUID[] DEFAULT '{}',
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  failure_type failure_type,
  failure_message TEXT,
  provider_id UUID,
  token_usage JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent Role Definitions
CREATE TABLE agent_role_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role agent_role NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tool_whitelist TEXT[] NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  budget_policy JSONB NOT NULL DEFAULT '{"maxTokensPerTask": 10000, "maxCostPerTask": 1.0, "maxLoopIterations": 10}',
  routing_preferences JSONB NOT NULL DEFAULT '{"strategy": "ROLE_DEFAULT"}',
  retry_policy JSONB NOT NULL DEFAULT '{"maxRetries": 2, "retryDelayMs": 1000, "backoffFactor": 2, "retryOn": ["PROVIDER_ERROR", "TIMEOUT", "INVALID_OUTPUT"]}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Provider Definitions
CREATE TABLE provider_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type provider_type NOT NULL,
  endpoint TEXT NOT NULL,
  model_name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{}',
  credentials_ref TEXT,
  health_status JSONB NOT NULL DEFAULT '{"isHealthy": true, "consecutiveFailures": 0}',
  cost_metadata JSONB NOT NULL DEFAULT '{"costPerInputToken": 0, "costPerOutputToken": 0, "currency": "USD"}',
  rate_limits JSONB NOT NULL DEFAULT '{"requestsPerMinute": 60, "tokensPerMinute": 100000}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Provider Mappings (role → provider priority)
CREATE TABLE provider_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_role agent_role NOT NULL,
  provider_id UUID NOT NULL REFERENCES provider_definitions(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_role, provider_id)
);

-- Approvals
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  risk_level risk_level NOT NULL,
  state approval_state NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Audit Events
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID,
  correlation_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Checkpoints
CREATE TABLE checkpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  run_state run_state NOT NULL,
  task_states JSONB NOT NULL DEFAULT '{}',
  completed_outputs JSONB NOT NULL DEFAULT '{}',
  provider_selections JSONB NOT NULL DEFAULT '{}',
  budget_usage JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, sequence_number)
);

-- Artifacts
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX idx_tasks_run_id ON tasks(run_id);
CREATE INDEX idx_tasks_state ON tasks(state);
CREATE INDEX idx_approvals_run_id ON approvals(run_id);
CREATE INDEX idx_approvals_state ON approvals(state);
CREATE INDEX idx_audit_events_run_id ON audit_events(run_id);
CREATE INDEX idx_audit_events_timestamp ON audit_events(timestamp);
CREATE INDEX idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX idx_checkpoints_run_id ON checkpoints(run_id);
CREATE INDEX idx_provider_mappings_role ON provider_mappings(agent_role);
CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: auto-update updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_runs_updated_at BEFORE UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_role_definitions_updated_at BEFORE UPDATE ON agent_role_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_provider_definitions_updated_at BEFORE UPDATE ON provider_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
