import type { ProviderAdapter } from './adapter-interface.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';
import { createGatewayAdapter, GATEWAY_PRESETS, type GatewayProviderConfig } from './universal-gateway.js';
import { Pool } from 'pg';

export interface RoutingContext {
  agentRole: string;
  runId: string;
  userOverrideProviderId?: string;
  requiredCapabilities?: {
    structuredOutput?: boolean;
    toolUse?: boolean;
  };
}

export class ProviderRouter {
  private pool: Pool;
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Initialize adapters from database provider definitions
  async loadAdapters(): Promise<void> {
    const result = await this.pool.query(
      'SELECT * FROM provider_definitions WHERE is_enabled = true'
    );

    for (const provider of result.rows) {
      const adapter = this.createAdapter(provider);
      if (adapter) {
        this.adapters.set(provider.id, adapter);
      }
    }
  }

  private createAdapter(provider: Record<string, unknown>): ProviderAdapter | null {
    // Universal gateway adapter — handles ANY provider via config
    if (provider.type === 'GENERIC_HTTP' || provider.gateway_config) {
      return this.createGatewayProviderAdapter(provider);
    }

    // Legacy built-in adapters (still supported for backward compatibility)
    switch (provider.type) {
      case 'OLLAMA':
        return new OllamaAdapter(
          provider.name as string,
          provider.endpoint as string,
          provider.model_name as string
        );
      case 'GEMINI':
        return new GeminiAdapter(
          provider.name as string,
          provider.credentials_ref as string || '',
          provider.model_name as string
        );
      case 'OPENAI_COMPATIBLE':
      case 'ANTHROPIC':
        return new OpenAICompatibleAdapter(
          provider.name as string,
          provider.endpoint as string,
          provider.credentials_ref as string || '',
          provider.model_name as string
        );
      default:
        return null;
    }
  }

  private createGatewayProviderAdapter(provider: Record<string, unknown>): ProviderAdapter | null {
    try {
      const gatewayConfig = provider.gateway_config as Partial<GatewayProviderConfig> | null;
      const presetName = provider.preset_name as string | undefined;
      const name = provider.name as string;
      const apiKey = this.resolveCredential(provider.credentials_ref as string | undefined);

      // Build config from gateway_config column, falling back to preset
      const config: Partial<GatewayProviderConfig> & { name: string } = {
        name,
        ...(gatewayConfig || {}),
      };

      // If no gateway_config but has an endpoint and model, build minimal config
      if (!gatewayConfig && provider.endpoint) {
        config.connection = {
          baseUrl: provider.endpoint as string,
          completionPath: '/v1/chat/completions',
        };
        config.requestMapping = {
          format: 'openai',
          modelValue: provider.model_name as string || 'default',
        };
        config.responseMapping = { format: 'openai' };
      }

      return createGatewayAdapter(config, apiKey, presetName);
    } catch (err) {
      console.error(`[ProviderRouter] Failed to create gateway adapter for ${provider.name}:`, err);
      return null;
    }
  }

  private credentialResolver?: (ref: string) => string;

  setCredentialResolver(resolver: (ref: string) => string): void {
    this.credentialResolver = resolver;
  }

  private resolveCredential(ref?: string): string {
    if (!ref) return '';
    if (this.credentialResolver) return this.credentialResolver(ref);
    return process.env[ref] || '';
  }

  // Select the best provider for a given context
  async selectProvider(context: RoutingContext): Promise<{ adapter: ProviderAdapter; providerId: string } | null> {
    // 1. User override takes priority
    if (context.userOverrideProviderId) {
      const adapter = this.adapters.get(context.userOverrideProviderId);
      if (adapter) {
        return { adapter, providerId: context.userOverrideProviderId };
      }
    }

    // 2. Check run-level provider overrides
    const run = await this.pool.query(
      'SELECT provider_overrides FROM runs WHERE id = $1',
      [context.runId]
    );
    if (run.rows[0]?.provider_overrides?.[context.agentRole]) {
      const overrideId = run.rows[0].provider_overrides[context.agentRole];
      const adapter = this.adapters.get(overrideId);
      if (adapter) {
        return { adapter, providerId: overrideId };
      }
    }

    // 3. Follow provider mapping priority order
    // Support both old schema (agent_role enum) and new schema (agent_role_name text)
    const mappings = await this.pool.query(
      `SELECT pm.provider_id, pd.health_status
       FROM provider_mappings pm
       JOIN provider_definitions pd ON pm.provider_id = pd.id
       WHERE (pm.agent_role_name = $1 OR pm.agent_role::text = $1) AND pd.is_enabled = true
       ORDER BY pm.priority ASC`,
      [context.agentRole]
    );

    for (const mapping of mappings.rows) {
      const healthStatus = mapping.health_status as { isHealthy: boolean };
      if (!healthStatus.isHealthy) continue;

      const adapter = this.adapters.get(mapping.provider_id);
      if (!adapter) continue;

      // Check capabilities
      if (context.requiredCapabilities && !adapter.validateCapabilities(context.requiredCapabilities)) {
        continue;
      }

      return { adapter, providerId: mapping.provider_id };
    }

    // 4. Fallback: use any healthy adapter
    for (const [providerId, adapter] of this.adapters) {
      if (context.requiredCapabilities && !adapter.validateCapabilities(context.requiredCapabilities)) {
        continue;
      }
      return { adapter, providerId };
    }

    return null;
  }

  // Run health checks on all providers
  async runHealthChecks(): Promise<void> {
    for (const [providerId, adapter] of this.adapters) {
      const health = await adapter.healthCheck();
      await this.pool.query(
        `UPDATE provider_definitions
         SET health_status = jsonb_build_object(
           'isHealthy', $1::boolean,
           'lastCheckedAt', NOW()::text,
           'lastErrorMessage', $2::text,
           'consecutiveFailures', CASE WHEN $1::boolean THEN 0
             ELSE LEAST(COALESCE((health_status->>'consecutiveFailures')::int, 0) + 1, 999999) END
         ), updated_at = NOW()
         WHERE id = $3`,
        [health.healthy, health.error || null, providerId]
      );
    }
  }

  getAdapter(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }
}

export { ProviderAdapter, ProviderRequest, ProviderResponse } from './adapter-interface.js';
export { OllamaAdapter } from './ollama-adapter.js';
export { GeminiAdapter } from './gemini-adapter.js';
export { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';
export { UniversalGatewayAdapter, createGatewayAdapter, GATEWAY_PRESETS } from './universal-gateway.js';
export type { GatewayProviderConfig } from './universal-gateway.js';
