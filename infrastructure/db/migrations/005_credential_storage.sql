-- Migration 005: Add encrypted credential storage for gateway providers
-- Stores API keys encrypted at rest (application-level encryption)

CREATE TABLE IF NOT EXISTS provider_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES provider_definitions(id) ON DELETE CASCADE,
  credential_ref VARCHAR(255) NOT NULL UNIQUE,
  -- encrypted_value stores the API key encrypted with AES-256 using APP_ENCRYPTION_KEY env var
  -- If APP_ENCRYPTION_KEY is not set, values are base64-encoded (dev mode only)
  encrypted_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_ref ON provider_credentials(credential_ref);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider ON provider_credentials(provider_id);
