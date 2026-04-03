// Provider Adapter interface — all model backends implement this contract

export interface ProviderRequest {
  systemPrompt: string;
  userMessage: string;
  outputSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderResponse {
  content: string;
  parsedJson?: Record<string, unknown>;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  model: string;
  durationMs: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly type: string;

  // Execute a prompt and return structured response
  complete(request: ProviderRequest): Promise<ProviderResponse>;

  // Stream a response (optional — falls back to complete if not supported)
  stream?(request: ProviderRequest): AsyncGenerator<StreamChunk>;

  // Health check
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;

  // Validate that the provider supports required capabilities
  validateCapabilities(required: { structuredOutput?: boolean; toolUse?: boolean }): boolean;
}
