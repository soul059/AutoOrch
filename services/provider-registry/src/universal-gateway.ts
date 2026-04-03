// Universal AI Gateway Adapter
// Connects to ANY AI provider through a declarative configuration spec.
// No code changes needed to add a new provider — just register a config.

import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
} from './adapter-interface.js';

// ─── Gateway Configuration Spec ─────────────────────────────
// Describes HOW to talk to any AI provider via HTTP

export interface GatewayProviderConfig {
  // Identity
  name: string;
  displayName?: string;

  // Connection
  connection: {
    baseUrl: string;                          // e.g. "https://api.openai.com", "http://localhost:11434"
    completionPath: string;                   // e.g. "/v1/chat/completions", "/api/chat"
    healthCheckPath?: string;                 // e.g. "/v1/models", "/api/tags"
    streamingPath?: string;                   // defaults to completionPath if not set
    timeoutMs?: number;                       // default 30000
  };

  // Authentication
  auth: {
    type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'custom_header';
    headerName?: string;                      // for custom_header, e.g. "X-API-Key"
    queryParam?: string;                      // for api_key_query, e.g. "key"
    tokenPrefix?: string;                     // for bearer, defaults to "Bearer"
    credentialsRef?: string;                  // env var or secret name holding the key
  };

  // Request mapping — how to transform AutoOrch's ProviderRequest into the API's body
  requestMapping: {
    format: 'openai' | 'ollama' | 'gemini' | 'raw';

    // For 'raw' format — a JSONPath-style template describing where to put each field
    template?: Record<string, unknown>;

    // Model name to send (can be overridden per-request)
    modelField?: string;                      // defaults to "model"
    modelValue: string;                       // the model identifier, e.g. "gpt-4", "llama3.2"

    // Where to put messages
    messagesField?: string;                   // defaults to "messages"
    systemRole?: string;                      // defaults to "system"
    userRole?: string;                        // defaults to "user"

    // How to request JSON output
    jsonOutputMode?: 'response_format' | 'mime_type' | 'format_json' | 'instruction' | 'none';

    // How to send tools
    toolFormat?: 'openai_functions' | 'anthropic_tools' | 'none';

    // Extra static fields to always include in the body
    extraFields?: Record<string, unknown>;

    // Max tokens field name
    maxTokensField?: string;                  // defaults to "max_tokens"

    // Temperature field name
    temperatureField?: string;                // defaults to "temperature"

    // Streaming flag
    streamField?: string;                     // defaults to "stream"
  };

  // Response mapping — how to extract data from the API's response
  responseMapping: {
    format: 'openai' | 'ollama' | 'gemini' | 'raw';

    // For 'raw' format — JSONPath-style selectors for each field
    contentPath?: string;                     // e.g. "choices[0].message.content"
    promptTokensPath?: string;                // e.g. "usage.prompt_tokens"
    completionTokensPath?: string;            // e.g. "usage.completion_tokens"
    totalTokensPath?: string;                 // e.g. "usage.total_tokens"
    toolCallsPath?: string;                   // e.g. "choices[0].message.tool_calls"
    modelPath?: string;                       // e.g. "model"
  };

  // Streaming response parsing
  streaming?: {
    format: 'sse' | 'ndjson' | 'none';       // Server-sent events or newline-delimited JSON
    contentPath?: string;                     // path within each chunk to content delta
    donePath?: string;                        // path within each chunk to done flag
    doneValue?: unknown;                      // value that indicates stream is complete
  };

  // Cost calculation
  cost: {
    inputTokenCost: number;                   // cost per input token in USD (0 for local)
    outputTokenCost: number;                  // cost per output token in USD (0 for local)
    currency?: string;                        // defaults to "USD"
  };

  // Capability flags
  capabilities: {
    structuredOutput: boolean;
    structuredOutputReliability?: number;      // 0.0 to 1.0
    toolUse: boolean;
    streaming: boolean;
    maxContextTokens: number;
    estimatedLatencyMs?: number;
  };
}

// ─── Built-in Presets ───────────────────────────────────────
// Pre-configured templates for common providers

export const GATEWAY_PRESETS: Record<string, Partial<GatewayProviderConfig>> = {
  openai: {
    connection: {
      baseUrl: 'https://api.openai.com',
      completionPath: '/v1/chat/completions',
      healthCheckPath: '/v1/models',
    },
    auth: { type: 'bearer' },
    requestMapping: {
      format: 'openai',
      modelValue: 'gpt-4',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    streaming: { format: 'sse', contentPath: 'choices[0].delta.content', donePath: 'choices[0].finish_reason', doneValue: 'stop' },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.95, toolUse: true, streaming: true, maxContextTokens: 128000 },
  },

  anthropic: {
    connection: {
      baseUrl: 'https://api.anthropic.com',
      completionPath: '/v1/messages',
      healthCheckPath: '/v1/messages',
    },
    auth: { type: 'custom_header', headerName: 'x-api-key' },
    requestMapping: {
      format: 'raw',
      modelValue: 'claude-sonnet-4-20250514',
      maxTokensField: 'max_tokens',
      extraFields: { 'anthropic-version': '2023-06-01' },
      toolFormat: 'anthropic_tools',
      jsonOutputMode: 'none',
    },
    responseMapping: {
      format: 'raw',
      contentPath: 'content[0].text',
      promptTokensPath: 'usage.input_tokens',
      completionTokensPath: 'usage.output_tokens',
    },
    streaming: { format: 'sse', contentPath: 'delta.text' },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.9, toolUse: true, streaming: true, maxContextTokens: 200000 },
  },

  ollama: {
    connection: {
      baseUrl: 'http://localhost:11434',
      completionPath: '/api/chat',
      healthCheckPath: '/api/tags',
      timeoutMs: 600000, // 10 minutes for local inference (models can be slow)
    },
    auth: { type: 'none' },
    requestMapping: {
      format: 'ollama',
      modelValue: 'llama3.2',
      jsonOutputMode: 'format_json',
    },
    responseMapping: { format: 'ollama' },
    streaming: { format: 'ndjson', contentPath: 'message.content', donePath: 'done', doneValue: true },
    cost: { inputTokenCost: 0, outputTokenCost: 0 },
    capabilities: { structuredOutput: false, structuredOutputReliability: 0.3, toolUse: false, streaming: true, maxContextTokens: 8192 },
  },

  gemini: {
    connection: {
      baseUrl: 'https://generativelanguage.googleapis.com',
      completionPath: '/v1beta/models/{model}:generateContent',
      healthCheckPath: '/v1beta/models',
    },
    auth: { type: 'api_key_query', queryParam: 'key' },
    requestMapping: {
      format: 'gemini',
      modelValue: 'gemini-pro',
      jsonOutputMode: 'mime_type',
    },
    responseMapping: { format: 'gemini' },
    cost: { inputTokenCost: 0.00000025, outputTokenCost: 0.0000005 },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.85, toolUse: true, streaming: true, maxContextTokens: 32768 },
  },

  groq: {
    connection: {
      baseUrl: 'https://api.groq.com',
      completionPath: '/openai/v1/chat/completions',
      healthCheckPath: '/openai/v1/models',
    },
    auth: { type: 'bearer' },
    requestMapping: {
      format: 'openai',
      modelValue: 'llama-3.3-70b-versatile',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    cost: { inputTokenCost: 0.00000059, outputTokenCost: 0.00000079 },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.8, toolUse: true, streaming: true, maxContextTokens: 131072 },
  },

  mistral: {
    connection: {
      baseUrl: 'https://api.mistral.ai',
      completionPath: '/v1/chat/completions',
      healthCheckPath: '/v1/models',
    },
    auth: { type: 'bearer' },
    requestMapping: {
      format: 'openai',
      modelValue: 'mistral-large-latest',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    cost: { inputTokenCost: 0.000002, outputTokenCost: 0.000006 },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.85, toolUse: true, streaming: true, maxContextTokens: 32768 },
  },

  together: {
    connection: {
      baseUrl: 'https://api.together.xyz',
      completionPath: '/v1/chat/completions',
      healthCheckPath: '/v1/models',
    },
    auth: { type: 'bearer' },
    requestMapping: {
      format: 'openai',
      modelValue: 'meta-llama/Llama-3-70b-chat-hf',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    cost: { inputTokenCost: 0.0000009, outputTokenCost: 0.0000009 },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.7, toolUse: true, streaming: true, maxContextTokens: 8192 },
  },

  deepseek: {
    connection: {
      baseUrl: 'https://api.deepseek.com',
      completionPath: '/v1/chat/completions',
      healthCheckPath: '/v1/models',
    },
    auth: { type: 'bearer' },
    requestMapping: {
      format: 'openai',
      modelValue: 'deepseek-chat',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    cost: { inputTokenCost: 0.00000014, outputTokenCost: 0.00000028 },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.85, toolUse: true, streaming: true, maxContextTokens: 65536 },
  },

  'openai-compatible': {
    connection: {
      baseUrl: 'http://localhost:8080',
      completionPath: '/v1/chat/completions',
      healthCheckPath: '/v1/models',
    },
    auth: { type: 'bearer' },
    requestMapping: {
      format: 'openai',
      modelValue: 'default',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    cost: { inputTokenCost: 0, outputTokenCost: 0 },
    capabilities: { structuredOutput: true, toolUse: true, streaming: true, maxContextTokens: 8192 },
  },

  lmstudio: {
    connection: {
      baseUrl: 'http://localhost:1234',
      completionPath: '/v1/chat/completions',
      healthCheckPath: '/v1/models',
    },
    auth: { type: 'none' },
    requestMapping: {
      format: 'openai',
      modelValue: 'default',
      jsonOutputMode: 'response_format',
      toolFormat: 'openai_functions',
    },
    responseMapping: { format: 'openai' },
    cost: { inputTokenCost: 0, outputTokenCost: 0 },
    capabilities: { structuredOutput: true, structuredOutputReliability: 0.6, toolUse: false, streaming: true, maxContextTokens: 8192 },
  },
};

// ─── JSONPath-like Value Extractor ───────────────────────────

function extractValue(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) return undefined;

  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// ─── The Universal Gateway Adapter ──────────────────────────

export class UniversalGatewayAdapter implements ProviderAdapter {
  readonly name: string;
  readonly type: string;
  private config: GatewayProviderConfig;
  private resolvedApiKey: string;

  constructor(config: GatewayProviderConfig, apiKey?: string) {
    this.config = config;
    this.name = config.name;
    this.type = `GATEWAY:${config.name}`;
    this.resolvedApiKey = apiKey || '';
  }

  // ─── Build request body ──────────────────────────────────

  private buildRequestBody(request: ProviderRequest, streaming = false): Record<string, unknown> {
    const mapping = this.config.requestMapping;

    switch (mapping.format) {
      case 'openai':
        return this.buildOpenAIBody(request, streaming);
      case 'ollama':
        return this.buildOllamaBody(request, streaming);
      case 'gemini':
        return this.buildGeminiBody(request);
      case 'raw':
        return this.buildRawBody(request, streaming);
      default:
        return this.buildOpenAIBody(request, streaming);
    }
  }

  private buildOpenAIBody(request: ProviderRequest, streaming: boolean): Record<string, unknown> {
    const mapping = this.config.requestMapping;
    const body: Record<string, unknown> = {
      [mapping.modelField || 'model']: mapping.modelValue,
      [mapping.messagesField || 'messages']: [
        { role: mapping.systemRole || 'system', content: request.systemPrompt },
        { role: mapping.userRole || 'user', content: request.userMessage },
      ],
      [mapping.maxTokensField || 'max_tokens']: request.maxTokens || 4096,
      [mapping.temperatureField || 'temperature']: request.temperature || 0.7,
    };

    if (streaming) {
      body[mapping.streamField || 'stream'] = true;
    }

    if (request.outputSchema && mapping.jsonOutputMode === 'response_format') {
      body.response_format = { type: 'json_object' };
    }

    if (request.tools && request.tools.length > 0 && mapping.toolFormat === 'openai_functions') {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    if (mapping.extraFields) {
      Object.assign(body, mapping.extraFields);
    }

    return body;
  }

  private buildOllamaBody(request: ProviderRequest, streaming: boolean): Record<string, unknown> {
    const mapping = this.config.requestMapping;
    const body: Record<string, unknown> = {
      model: mapping.modelValue,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userMessage },
      ],
      stream: streaming,
      keep_alive: '30m', // Keep model loaded for 30 minutes to prevent timeout during long requests
      options: {
        num_ctx: 8192,   // Increase context window (default is 2048, too small for complex tasks)
        num_predict: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
      },
    };

    if (request.outputSchema) {
      body.format = 'json';
    }

    return body;
  }

  private buildGeminiBody(request: ProviderRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: [
        { parts: [{ text: `${request.systemPrompt}\n\n${request.userMessage}` }] },
      ],
      generationConfig: {
        maxOutputTokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
      },
    };

    if (request.outputSchema) {
      (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }

    return body;
  }

  private buildRawBody(request: ProviderRequest, streaming: boolean): Record<string, unknown> {
    const mapping = this.config.requestMapping;
    const body: Record<string, unknown> = {};

    if (mapping.modelField) {
      body[mapping.modelField] = mapping.modelValue;
    } else {
      body.model = mapping.modelValue;
    }

    // Anthropic-style messages
    if (mapping.toolFormat === 'anthropic_tools') {
      body.system = request.systemPrompt;
      body.messages = [{ role: 'user', content: request.userMessage }];
    } else {
      body[mapping.messagesField || 'messages'] = [
        { role: mapping.systemRole || 'system', content: request.systemPrompt },
        { role: mapping.userRole || 'user', content: request.userMessage },
      ];
    }

    body[mapping.maxTokensField || 'max_tokens'] = request.maxTokens || 4096;

    if (mapping.temperatureField) {
      body[mapping.temperatureField] = request.temperature || 0.7;
    }

    if (streaming) {
      body[mapping.streamField || 'stream'] = true;
    }

    if (request.tools && request.tools.length > 0 && mapping.toolFormat === 'anthropic_tools') {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    if (mapping.extraFields) {
      Object.assign(body, mapping.extraFields);
    }

    return body;
  }

  // ─── Build request URL ──────────────────────────────────

  private buildUrl(path?: string): string {
    const conn = this.config.connection;
    let url = conn.baseUrl.replace(/\/$/, '');
    let resolvedPath = (path || conn.completionPath);

    // Replace {model} placeholder in path
    resolvedPath = resolvedPath.replace('{model}', this.config.requestMapping.modelValue);

    url += resolvedPath;

    // Add API key as query param if needed
    if (this.config.auth.type === 'api_key_query' && this.config.auth.queryParam) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}${this.config.auth.queryParam}=${this.resolvedApiKey}`;
    }

    return url;
  }

  // ─── Build request headers ──────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const auth = this.config.auth;
    switch (auth.type) {
      case 'bearer':
        headers['Authorization'] = `${auth.tokenPrefix || 'Bearer'} ${this.resolvedApiKey}`;
        break;
      case 'api_key_header':
      case 'custom_header':
        if (auth.headerName) {
          headers[auth.headerName] = this.resolvedApiKey;
        }
        break;
      // 'none' and 'api_key_query' don't need auth headers
    }

    // Add extra headers from request mapping (e.g. anthropic-version)
    if (this.config.requestMapping.extraFields) {
      for (const [key, value] of Object.entries(this.config.requestMapping.extraFields)) {
        if (typeof value === 'string' && key.includes('-')) {
          headers[key] = value;
        }
      }
    }

    return headers;
  }

  // ─── Parse response ─────────────────────────────────────

  private parseResponse(data: unknown, startTime: number): ProviderResponse {
    const mapping = this.config.responseMapping;
    const durationMs = Date.now() - startTime;

    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> | undefined;

    switch (mapping.format) {
      case 'openai':
        content = extractValue(data, 'choices.0.message.content') as string || '';
        promptTokens = extractValue(data, 'usage.prompt_tokens') as number || 0;
        completionTokens = extractValue(data, 'usage.completion_tokens') as number || 0;
        totalTokens = extractValue(data, 'usage.total_tokens') as number || promptTokens + completionTokens;
        toolCalls = this.parseOpenAIToolCalls(data);
        break;

      case 'ollama':
        // Support both regular content and thinking models (DeepSeek, Qwen, etc.)
        content = extractValue(data, 'message.content') as string || '';
        if (!content) {
          content = extractValue(data, 'message.thinking') as string || '';
        }
        promptTokens = extractValue(data, 'prompt_eval_count') as number || 0;
        completionTokens = extractValue(data, 'eval_count') as number || 0;
        totalTokens = promptTokens + completionTokens;
        break;

      case 'gemini':
        content = extractValue(data, 'candidates.0.content.parts.0.text') as string || '';
        promptTokens = extractValue(data, 'usageMetadata.promptTokenCount') as number || 0;
        completionTokens = extractValue(data, 'usageMetadata.candidatesTokenCount') as number || 0;
        totalTokens = extractValue(data, 'usageMetadata.totalTokenCount') as number || promptTokens + completionTokens;
        break;

      case 'raw':
        content = (mapping.contentPath ? extractValue(data, mapping.contentPath) as string : '') || '';
        promptTokens = (mapping.promptTokensPath ? extractValue(data, mapping.promptTokensPath) as number : 0) || 0;
        completionTokens = (mapping.completionTokensPath ? extractValue(data, mapping.completionTokensPath) as number : 0) || 0;
        totalTokens = (mapping.totalTokensPath ? extractValue(data, mapping.totalTokensPath) as number : promptTokens + completionTokens);
        if (mapping.toolCallsPath) {
          const rawCalls = extractValue(data, mapping.toolCallsPath);
          if (Array.isArray(rawCalls)) {
            toolCalls = rawCalls.map((tc: Record<string, unknown>) => {
              const fn = tc.function as Record<string, unknown> | undefined;
              let args: Record<string, unknown> = {};
              try { args = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments as string) : (fn?.arguments as Record<string, unknown>) || {}; } catch { /* skip */ }
              return { name: (fn?.name as string) || (tc.name as string) || '', arguments: args };
            });
          }
        }
        break;
    }

    // Parse JSON from content if applicable
    let parsedJson: Record<string, unknown> | undefined;
    try {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        parsedJson = JSON.parse(trimmed);
      }
    } catch { /* not JSON */ }

    const cost = this.config.cost;
    const costUsd = (promptTokens * (cost?.inputTokenCost || 0)) + (completionTokens * (cost?.outputTokenCost || 0));

    return {
      content,
      parsedJson,
      tokenUsage: { promptTokens, completionTokens, totalTokens, costUsd },
      model: this.config.requestMapping.modelValue,
      durationMs,
      toolCalls,
    };
  }

  private parseOpenAIToolCalls(data: unknown): Array<{ name: string; arguments: Record<string, unknown> }> | undefined {
    const rawCalls = extractValue(data, 'choices.0.message.tool_calls') as Array<Record<string, unknown>> | undefined;
    if (!rawCalls || !Array.isArray(rawCalls)) return undefined;

    return rawCalls.map(tc => {
      const fn = tc.function as Record<string, unknown>;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(fn.arguments as string); } catch { /* skip */ }
      return { name: fn.name as string, arguments: args };
    });
  }

  // ─── ProviderAdapter Implementation ──────────────────────

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const startTime = Date.now();
    const url = this.buildUrl();
    const headers = this.buildHeaders();
    const body = this.buildRequestBody(request, false);
    const timeout = this.config.connection.timeoutMs || 600000; // Default 10 min for local models

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gateway[${this.name}] error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return this.parseResponse(data, startTime);
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const streamConfig = this.config.streaming;
    console.log(`[Gateway.stream] Starting stream for ${this.name}, streamConfig:`, JSON.stringify(streamConfig));
    
    if (!streamConfig || streamConfig.format === 'none') {
      // Fall back to non-streaming
      console.log(`[Gateway.stream] No stream config, falling back to complete()`);
      const result = await this.complete(request);
      yield { content: result.content, done: true };
      return;
    }

    const url = this.buildUrl(this.config.connection.streamingPath);
    const headers = this.buildHeaders();
    const body = this.buildRequestBody(request, true);
    const timeout = this.config.connection.timeoutMs || 600000; // Default 10 min for local models
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new Error(`Gateway[${this.name}] stream error: ${response.status}`);
    }

    if (!response.body) throw new Error('No response body for streaming');

    const decoder = new TextDecoder();
    let buffer = '';

    // Use async iteration - works with both native fetch and undici
    for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(value, { stream: true });

      if (streamConfig.format === 'sse') {
        // Parse SSE: lines starting with "data: "
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const content = (streamConfig.contentPath ? extractValue(parsed, streamConfig.contentPath) as string : '') || '';
            const doneFlag = streamConfig.donePath ? extractValue(parsed, streamConfig.donePath) : undefined;
            const isDone = streamConfig.doneValue !== undefined ? doneFlag === streamConfig.doneValue : false;

            if (content) {
              yield { content, done: isDone };
            }
          } catch { /* skip malformed lines */ }
        }
      } else if (streamConfig.format === 'ndjson') {
        // Parse newline-delimited JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            // Support thinking models: yield BOTH thinking and content
            // Thinking comes first, then content at the end
            const thinking = parsed.message?.thinking || '';
            const content = (streamConfig.contentPath ? extractValue(parsed, streamConfig.contentPath) as string : '') || '';
            const doneFlag = streamConfig.donePath ? extractValue(parsed, streamConfig.donePath) : undefined;
            const isDone = streamConfig.doneValue !== undefined ? doneFlag === streamConfig.doneValue : false;

            // Yield whichever has content (thinking during reasoning, content at end)
            const output = content || thinking;
            if (output || isDone) {
              yield { content: output, done: isDone };
            }
          } catch (parseErr) {
            console.log(`[Gateway.stream] ndjson parse error: ${(parseErr as Error).message}, line: ${line.substring(0, 100)}`);
          }
        }
      }
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    const healthPath = this.config.connection.healthCheckPath;

    if (!healthPath) {
      return { healthy: true, latencyMs: 0 };
    }

    try {
      const url = this.buildUrl(healthPath);
      const headers = this.buildHeaders();
      delete headers['Content-Type']; // GET request

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      // Check for both HTTP success and valid JSON response
      if (!response.ok) {
        return { healthy: false, latencyMs: Date.now() - start, error: `HTTP ${response.status}` };
      }

      // Verify we can parse the response
      try {
        await response.text(); // Ensure response body is readable
      } catch (parseErr) {
        return { healthy: false, latencyMs: Date.now() - start, error: 'Invalid response body' };
      }

      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  validateCapabilities(required: { structuredOutput?: boolean; toolUse?: boolean }): boolean {
    const caps = this.config.capabilities;
    if (required.structuredOutput && !caps.structuredOutput) return false;
    if (required.toolUse && !caps.toolUse) return false;
    return true;
  }

  // ─── Configuration Accessors ────────────────────────────

  getConfig(): GatewayProviderConfig {
    return { ...this.config };
  }

  getCapabilities() {
    return { ...this.config.capabilities };
  }
}

// ─── Factory: Create adapter from config + optional preset ──

export function createGatewayAdapter(
  config: Partial<GatewayProviderConfig> & { name: string },
  apiKey?: string,
  presetName?: string,
): UniversalGatewayAdapter {
  let finalConfig: GatewayProviderConfig;

  if (presetName && GATEWAY_PRESETS[presetName]) {
    // Merge preset with overrides
    const preset = GATEWAY_PRESETS[presetName];
    finalConfig = deepMerge(preset as Record<string, unknown>, config as Record<string, unknown>) as unknown as GatewayProviderConfig;
  } else {
    finalConfig = config as GatewayProviderConfig;
  }

  // Defaults
  if (!finalConfig.cost) {
    finalConfig.cost = { inputTokenCost: 0, outputTokenCost: 0, currency: 'USD' };
  }
  if (!finalConfig.capabilities) {
    finalConfig.capabilities = { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 };
  }

  return new UniversalGatewayAdapter(finalConfig, apiKey);
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] !== undefined && override[key] !== null) {
      if (typeof override[key] === 'object' && !Array.isArray(override[key]) && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        result[key] = deepMerge(base[key] as Record<string, unknown>, override[key] as Record<string, unknown>);
      } else {
        result[key] = override[key];
      }
    }
  }
  return result;
}
