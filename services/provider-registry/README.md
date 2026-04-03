# Provider Registry Service

The Provider Registry manages AI provider configurations, selection logic, health monitoring, and the Universal AI Gateway.

## Overview

The Provider Registry enables AutoOrch to work with multiple AI providers by:
- Maintaining provider definitions (endpoints, credentials, capabilities)
- Selecting optimal providers based on requirements and health
- Monitoring provider availability with periodic health checks
- Providing a Universal Gateway for config-driven provider integration

## Components

### Provider Router (`index.ts`)

Routes inference requests to appropriate providers.

```typescript
const router = new ProviderRouter(pool);

// Select provider for a role
const adapter = await router.selectProviderForRole('BUILDER', {
  supportsStructuredOutput: true
});

// Make inference request
const response = await adapter.generate({
  systemPrompt: 'You are a helpful assistant.',
  userMessage: 'Write a function to sort an array.',
  maxTokens: 1000
});
```

**Routing Strategy:**
1. User-selected provider (if specified)
2. Run-level override
3. Role-to-provider mapping (by priority)
4. Fallback chain (if primary unhealthy)
5. Capability filtering

### Built-in Adapters

#### OllamaAdapter (`ollama-adapter.ts`)
Local/self-hosted models via Ollama.

```typescript
const ollama = new OllamaAdapter('http://localhost:11434', 'llama3.2');
const response = await ollama.generate({ userMessage: 'Hello!' });
```

#### GeminiAdapter (`gemini-adapter.ts`)
Google Gemini API integration.

```typescript
const gemini = new GeminiAdapter(apiKey, 'gemini-pro');
const response = await gemini.generate({ userMessage: 'Hello!' });
```

#### OpenAICompatibleAdapter (`openai-compatible-adapter.ts`)
Works with OpenAI, Anthropic, and compatible APIs.

```typescript
const openai = new OpenAICompatibleAdapter(
  'https://api.openai.com/v1',
  apiKey,
  'gpt-4'
);
```

### Universal Gateway (`universal-gateway.ts`)

Config-driven adapter for ANY HTTP-based AI provider.

```typescript
const gateway = new UniversalGatewayAdapter({
  connection: {
    baseUrl: 'https://api.provider.com',
    completionPath: '/v1/chat/completions',
    auth: { type: 'bearer', token: apiKey }
  },
  requestMapping: {
    format: 'openai',
    modelValue: 'custom-model'
  },
  responseMapping: {
    format: 'openai',
    contentPath: 'choices[0].message.content'
  }
});
```

**Built-in Presets:**
- OpenAI, Anthropic, Ollama, Gemini
- Groq, Mistral, Together AI, DeepSeek, LMStudio
- Generic OpenAI-compatible template

## API

### Provider Selection

```typescript
// Select by role with capability requirements
selectProviderForRole(role: AgentRole, requirements?: Capabilities): Promise<ProviderAdapter>

// Select with full request context
selectProvider(request: ProviderRequest): Promise<ProviderAdapter>
```

### Provider Management

```typescript
// Register new provider
registerProvider(config: ProviderConfig): Promise<Provider>

// Update health status
updateProviderHealth(providerId: string, isHealthy: boolean): Promise<void>

// Get metrics
getProviderMetrics(): Promise<ProviderMetrics[]>
```

### Universal Gateway API

```typescript
// Register gateway provider
registerGatewayProvider(config: GatewayConfig): Promise<Provider>

// Test connection
testGatewayConnection(config: GatewayConfig): Promise<TestResult>

// List presets
getPresets(): GatewayPreset[]
```

## Provider Request/Response

```typescript
interface ProviderRequest {
  systemPrompt: string;
  userMessage: string;
  outputSchema?: JSONSchema;
  maxTokens?: number;
  temperature?: number;
  tools?: Tool[];
}

interface ProviderResponse {
  content: string;
  parsedJson?: object;
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  durationMs: number;
  toolCalls?: ToolCall[];
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `GEMINI_API_KEY` | - | Google Gemini API key |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `HEALTH_CHECK_INTERVAL` | `30000` | Health check interval (ms) |
| `ALLOW_LOCAL_PROVIDERS` | `false` | Allow localhost endpoints |

## Provider Capabilities

| Provider | Structured Output | Tool Use | Streaming | Cost |
|----------|-------------------|----------|-----------|------|
| OpenAI | ✅ High (0.95) | ✅ | SSE | $$$ |
| Anthropic | ✅ High (0.9) | ✅ | SSE | $$$ |
| Gemini | ✅ Good (0.85) | ✅ | ✅ | $$ |
| Ollama | ⚠️ Low (0.3) | ❌ | NDJSON | Free |
| Groq | ✅ Good (0.8) | ✅ | ✅ | $ |

## Database Tables

- `provider_definitions` - Provider configurations
- `provider_mappings` - Role-to-provider assignments
- `provider_credentials` - Encrypted API keys (AES-256-GCM)

## Usage Example

```typescript
import { ProviderRouter } from '@autoorch/provider-registry';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const router = new ProviderRouter(pool);

// Select provider for code generation
const adapter = await router.selectProviderForRole('BUILDER', {
  supportsStructuredOutput: true,
  supportsToolUse: false
});

// Generate code
const response = await adapter.generate({
  systemPrompt: 'You are an expert TypeScript developer.',
  userMessage: 'Write a function to calculate fibonacci numbers.',
  maxTokens: 500,
  temperature: 0.2
});

console.log(response.content);
console.log(`Tokens used: ${response.tokenUsage.total}`);
```

## Testing

```bash
npx vitest run tests/unit/provider-failover.test.ts
npx vitest run tests/unit/provider-adapter-extended.test.ts
npx vitest run tests/unit/universal-gateway.test.ts
```
