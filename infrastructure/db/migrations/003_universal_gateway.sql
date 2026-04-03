-- Migration 003: Add Universal AI Gateway support
-- Adds gateway_config column to provider_definitions for config-driven providers
-- Adds preset_name for tracking which built-in template was used

ALTER TABLE provider_definitions
  ADD COLUMN IF NOT EXISTS gateway_config JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS preset_name VARCHAR(100) DEFAULT NULL;

-- Add GENERIC_HTTP to the provider_type enum
-- ALTER TYPE ... ADD VALUE is safe and idempotent with IF NOT EXISTS (PG 9.3+)
ALTER TYPE provider_type ADD VALUE IF NOT EXISTS 'GENERIC_HTTP';
COMMENT ON COLUMN provider_definitions.gateway_config IS 'Full gateway configuration spec for GENERIC_HTTP providers. Contains connection, auth, request/response mapping, streaming, cost, and capability settings.';
COMMENT ON COLUMN provider_definitions.preset_name IS 'Name of the built-in preset used as a base (e.g., openai, anthropic, ollama, groq). NULL if fully custom.';

-- Add index for quick lookup of gateway-configured providers
CREATE INDEX IF NOT EXISTS idx_provider_definitions_preset ON provider_definitions(preset_name) WHERE preset_name IS NOT NULL;
