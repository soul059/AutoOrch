-- Migration 010: Make role enum nullable for custom agent roles
-- This allows creating agents with custom names using role_name column

-- 1. Make the old role enum column nullable (for backward compatibility)
ALTER TABLE agent_role_definitions ALTER COLUMN role DROP NOT NULL;

-- 2. Make role_name the primary identifier
ALTER TABLE agent_role_definitions ALTER COLUMN role_name SET NOT NULL;

-- 3. Same for tasks table
ALTER TABLE tasks ALTER COLUMN agent_role DROP NOT NULL;

-- 4. Same for provider_mappings
ALTER TABLE provider_mappings ALTER COLUMN agent_role DROP NOT NULL;

-- 5. Update provider_mappings to use agent_role_name as primary
ALTER TABLE provider_mappings ALTER COLUMN agent_role_name SET NOT NULL;

-- 6. Add unique constraint on role_name if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_role_definitions_role_name_key') THEN
        ALTER TABLE agent_role_definitions ADD CONSTRAINT agent_role_definitions_role_name_key UNIQUE (role_name);
    END IF;
END $$;
