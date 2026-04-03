import { readFileSync, existsSync } from 'fs';

// Secrets manager that supports multiple backends:
// 1. Environment variables (development)
// 2. Docker secrets (production)
// 3. File-based secrets (.env files)

export interface SecretConfig {
  key: string;
  required: boolean;
  defaultValue?: string;
}

const KNOWN_SECRETS: SecretConfig[] = [
  { key: 'DATABASE_URL', required: true, defaultValue: 'postgresql://autoorch:autoorch_dev_password@localhost:5432/autoorch' },
  { key: 'GEMINI_API_KEY', required: false },
  { key: 'OPENAI_API_KEY', required: false },
  { key: 'ANTHROPIC_API_KEY', required: false },
  { key: 'POSTGRES_PASSWORD', required: false, defaultValue: 'autoorch_dev_password' },
];

export class SecretsManager {
  private secrets: Map<string, string> = new Map();
  private dockerSecretsPath: string;

  constructor(dockerSecretsPath = '/run/secrets') {
    this.dockerSecretsPath = dockerSecretsPath;
  }

  // Load secrets from all sources in priority order
  async initialize(): Promise<void> {
    for (const config of KNOWN_SECRETS) {
      const value = this.resolveSecret(config.key);

      if (value) {
        this.secrets.set(config.key, value);
      } else if (config.required && !config.defaultValue) {
        throw new Error(`Required secret "${config.key}" not found in any source`);
      } else if (config.defaultValue) {
        this.secrets.set(config.key, config.defaultValue);
      }
    }

    console.log(`[Secrets] Loaded ${this.secrets.size} secrets from available sources`);
  }

  // Resolve a secret from multiple sources (priority: Docker secrets > env vars > defaults)
  private resolveSecret(key: string): string | undefined {
    // 1. Docker secrets (highest priority in production)
    const dockerPath = `${this.dockerSecretsPath}/${key.toLowerCase()}`;
    if (existsSync(dockerPath)) {
      try {
        return readFileSync(dockerPath, 'utf-8').trim();
      } catch {
        // fall through
      }
    }

    // 2. Environment variables
    if (process.env[key]) {
      return process.env[key];
    }

    return undefined;
  }

  // Get a secret value
  get(key: string): string | undefined {
    return this.secrets.get(key);
  }

  // Get a secret value or throw if missing
  getRequired(key: string): string {
    const value = this.secrets.get(key);
    if (!value) {
      throw new Error(`Required secret "${key}" is not available`);
    }
    return value;
  }

  // Check if a secret exists
  has(key: string): boolean {
    return this.secrets.has(key);
  }

  // Get provider credentials by provider type
  getProviderCredentials(providerType: string): string | undefined {
    const keyMap: Record<string, string> = {
      GEMINI: 'GEMINI_API_KEY',
      ANTHROPIC: 'ANTHROPIC_API_KEY',
      OPENAI_COMPATIBLE: 'OPENAI_API_KEY',
    };
    const key = keyMap[providerType];
    return key ? this.get(key) : undefined;
  }

  // List all loaded secrets (names only, not values)
  listLoadedKeys(): string[] {
    return Array.from(this.secrets.keys());
  }

  // Audit log of which secrets were found and from where
  getAuditSummary(): Record<string, { loaded: boolean; source: string }> {
    const summary: Record<string, { loaded: boolean; source: string }> = {};

    for (const config of KNOWN_SECRETS) {
      const dockerPath = `${this.dockerSecretsPath}/${config.key.toLowerCase()}`;
      if (existsSync(dockerPath)) {
        summary[config.key] = { loaded: true, source: 'docker-secret' };
      } else if (process.env[config.key]) {
        summary[config.key] = { loaded: true, source: 'environment' };
      } else if (config.defaultValue && this.secrets.has(config.key)) {
        summary[config.key] = { loaded: true, source: 'default' };
      } else {
        summary[config.key] = { loaded: false, source: 'none' };
      }
    }

    return summary;
  }
}

let instance: SecretsManager | null = null;

export function getSecretsManager(): SecretsManager {
  if (!instance) {
    instance = new SecretsManager();
  }
  return instance;
}

export async function initializeSecrets(): Promise<SecretsManager> {
  const manager = getSecretsManager();
  await manager.initialize();
  return manager;
}
