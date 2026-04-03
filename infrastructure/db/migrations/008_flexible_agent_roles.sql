-- Migration 008: Flexible Agent Roles
-- Allow custom agent roles instead of fixed ENUM

-- 1. Add a new text column for flexible role names
ALTER TABLE agent_role_definitions ADD COLUMN IF NOT EXISTS role_name TEXT;

-- 2. Copy existing enum values to the new column
UPDATE agent_role_definitions SET role_name = role::text WHERE role_name IS NULL;

-- 3. Make role_name NOT NULL after data migration
ALTER TABLE agent_role_definitions ALTER COLUMN role_name SET NOT NULL;

-- 4. Create unique index on role_name
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_role_definitions_role_name ON agent_role_definitions(role_name);

-- 5. Update provider_mappings to use text instead of enum
ALTER TABLE provider_mappings ADD COLUMN IF NOT EXISTS agent_role_name TEXT;

-- 6. Copy existing enum values to text column
UPDATE provider_mappings SET agent_role_name = agent_role::text WHERE agent_role_name IS NULL;

-- 7. Make agent_role_name NOT NULL
ALTER TABLE provider_mappings ALTER COLUMN agent_role_name SET NOT NULL;

-- 8. Update index for provider_mappings
CREATE INDEX IF NOT EXISTS idx_provider_mappings_role_name ON provider_mappings(agent_role_name);

-- 9. Update tasks table to use text for agent roles
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_role_name TEXT;

-- 10. Copy existing values
UPDATE tasks SET agent_role_name = agent_role::text WHERE agent_role_name IS NULL;

-- Note: We keep the old enum columns for backward compatibility
-- New code should use the _name columns

-- 11. Create a workflow_templates table for user-defined agent sequences
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  -- Array of agent role names in execution order
  agent_sequence JSONB NOT NULL DEFAULT '[]',
  -- Dependencies between agents (e.g., {"REVIEWER": ["BUILDER"]})
  dependencies JSONB NOT NULL DEFAULT '{}',
  -- Whether this is the default template
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Seed a default workflow template
INSERT INTO workflow_templates (name, description, agent_sequence, dependencies, is_default)
VALUES (
  'Default Sequential',
  'Default workflow: Planner → Builder → Reviewer',
  '["PLANNER", "BUILDER", "REVIEWER"]',
  '{"BUILDER": ["PLANNER"], "REVIEWER": ["BUILDER"]}',
  true
) ON CONFLICT DO NOTHING;

-- 13. Add workflow_template_id to runs table
ALTER TABLE runs ADD COLUMN IF NOT EXISTS workflow_template_id UUID REFERENCES workflow_templates(id);

-- 14. Add custom_agent_sequence to runs for per-run overrides
ALTER TABLE runs ADD COLUMN IF NOT EXISTS custom_agent_sequence JSONB;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_workflow_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_workflow_templates_updated_at ON workflow_templates;
CREATE TRIGGER update_workflow_templates_updated_at
  BEFORE UPDATE ON workflow_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
