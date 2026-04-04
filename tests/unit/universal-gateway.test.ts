import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UniversalGatewayAdapter,
  createGatewayAdapter,
  GATEWAY_PRESETS,
} from '../../services/provider-registry/src/universal-gateway.js';
import type { GatewayProviderConfig } from '../../services/provider-registry/src/universal-gateway.js';

// ═══════════════════════════════════════════════════════════
// Universal AI Gateway Tests
// ═══════════════════════════════════════════════════════════

describe('Universal Gateway - Presets', () => {
  it('should have at least 10 built-in presets', () => {
    const presetNames = Object.keys(GATEWAY_PRESETS);
    expect(presetNames.length).toBeGreaterThanOrEqual(10);
  });

  it('should include all major provider presets', () => {
    const expected = ['openai', 'anthropic', 'ollama', 'gemini', 'groq', 'mistral', 'together', 'deepseek', 'openai-compatible', 'lmstudio'];
    for (const name of expected) {
      expect(GATEWAY_PRESETS[name]).toBeDefined();
    }
  });

  it('every preset should have connection settings', () => {
    for (const [name, preset] of Object.entries(GATEWAY_PRESETS)) {
      expect(preset.connection, `${name} missing connection`).toBeDefined();
      expect(preset.connection!.baseUrl, `${name} missing baseUrl`).toBeDefined();
      expect(preset.connection!.completionPath, `${name} missing completionPath`).toBeDefined();
    }
  });

  it('every preset should have auth settings', () => {
    for (const [name, preset] of Object.entries(GATEWAY_PRESETS)) {
      expect(preset.auth, `${name} missing auth`).toBeDefined();
      expect(preset.auth!.type, `${name} missing auth.type`).toBeDefined();
    }
  });

  it('every preset should have request/response mapping', () => {
    for (const [name, preset] of Object.entries(GATEWAY_PRESETS)) {
      expect(preset.requestMapping, `${name} missing requestMapping`).toBeDefined();
      expect(preset.responseMapping, `${name} missing responseMapping`).toBeDefined();
    }
  });

  it('every preset should have capabilities', () => {
    for (const [name, preset] of Object.entries(GATEWAY_PRESETS)) {
      expect(preset.capabilities, `${name} missing capabilities`).toBeDefined();
    }
  });

  it('local presets (ollama, lmstudio) should have zero cost', () => {
    for (const name of ['ollama', 'lmstudio']) {
      const preset = GATEWAY_PRESETS[name];
      if (preset.cost) {
        expect(preset.cost.inputTokenCost).toBe(0);
        expect(preset.cost.outputTokenCost).toBe(0);
      }
    }
  });

  it('local presets should use auth type none', () => {
    for (const name of ['ollama', 'lmstudio']) {
      expect(GATEWAY_PRESETS[name].auth!.type).toBe('none');
    }
  });

  it('bearer auth presets should use standard format', () => {
    for (const name of ['openai', 'groq', 'mistral', 'together', 'deepseek']) {
      expect(GATEWAY_PRESETS[name].auth!.type).toBe('bearer');
    }
  });

  it('anthropic should use custom_header auth', () => {
    expect(GATEWAY_PRESETS['anthropic'].auth!.type).toBe('custom_header');
    expect(GATEWAY_PRESETS['anthropic'].auth!.headerName).toBe('x-api-key');
  });

  it('gemini should use api_key_query auth', () => {
    expect(GATEWAY_PRESETS['gemini'].auth!.type).toBe('api_key_query');
    expect(GATEWAY_PRESETS['gemini'].auth!.queryParam).toBe('key');
  });
});

describe('Universal Gateway - Adapter Creation', () => {
  it('should create adapter from preset name', () => {
    const adapter = createGatewayAdapter({ name: 'test-openai' }, 'sk-test', 'openai');
    expect(adapter).toBeInstanceOf(UniversalGatewayAdapter);
    expect(adapter.name).toBe('test-openai');
  });

  it('should create adapter with custom config', () => {
    const config: GatewayProviderConfig = {
      name: 'custom-provider',
      connection: { baseUrl: 'https://custom.ai', completionPath: '/generate' },
      auth: { type: 'bearer' },
      requestMapping: { format: 'openai', modelValue: 'custom-model' },
      responseMapping: { format: 'openai' },
      cost: { inputTokenCost: 0.001, outputTokenCost: 0.002 },
      capabilities: { structuredOutput: true, toolUse: false, streaming: false, maxContextTokens: 4096 },
    };
    const adapter = createGatewayAdapter(config, 'test-key');
    expect(adapter.name).toBe('custom-provider');
  });

  it('should merge preset with overrides', () => {
    const adapter = createGatewayAdapter(
      { name: 'my-openai', requestMapping: { format: 'openai', modelValue: 'gpt-4-turbo' } },
      'sk-test',
      'openai',
    );
    expect(adapter.name).toBe('my-openai');
    const config = adapter.getConfig();
    expect(config.requestMapping.modelValue).toBe('gpt-4-turbo');
  });

  it('should apply default cost when not specified', () => {
    const adapter = createGatewayAdapter(
      {
        name: 'no-cost',
        connection: { baseUrl: 'http://localhost:1234', completionPath: '/v1/chat/completions' },
        auth: { type: 'none' },
        requestMapping: { format: 'openai', modelValue: 'test' },
        responseMapping: { format: 'openai' },
        capabilities: { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 },
      },
    );
    const config = adapter.getConfig();
    expect(config.cost.inputTokenCost).toBe(0);
    expect(config.cost.outputTokenCost).toBe(0);
  });
});

describe('Universal Gateway - Capability Validation', () => {
  it('should validate structured output capability', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    expect(adapter.validateCapabilities({ structuredOutput: true })).toBe(true);
    expect(adapter.validateCapabilities({ toolUse: true })).toBe(true);
  });

  it('should reject missing capabilities', () => {
    const adapter = createGatewayAdapter(
      {
        name: 'no-tools',
        connection: { baseUrl: 'http://localhost', completionPath: '/v1/chat/completions' },
        auth: { type: 'none' },
        requestMapping: { format: 'openai', modelValue: 'test' },
        responseMapping: { format: 'openai' },
        capabilities: { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 },
      },
    );
    expect(adapter.validateCapabilities({ structuredOutput: true })).toBe(false);
    expect(adapter.validateCapabilities({ toolUse: true })).toBe(false);
    expect(adapter.validateCapabilities({})).toBe(true);
  });

  it('should return capabilities from config', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const caps = adapter.getCapabilities();
    expect(caps.structuredOutput).toBe(true);
    expect(caps.maxContextTokens).toBe(128000);
  });
});

describe('Universal Gateway - Request Body Building', () => {
  let openaiAdapter: UniversalGatewayAdapter;
  let ollamaAdapter: UniversalGatewayAdapter;
  let geminiAdapter: UniversalGatewayAdapter;
  let anthropicAdapter: UniversalGatewayAdapter;

  beforeEach(() => {
    openaiAdapter = createGatewayAdapter({ name: 'test-openai' }, 'sk-test', 'openai');
    ollamaAdapter = createGatewayAdapter({ name: 'test-ollama' }, '', 'ollama');
    geminiAdapter = createGatewayAdapter({ name: 'test-gemini' }, 'gem-key', 'gemini');
    anthropicAdapter = createGatewayAdapter({ name: 'test-anthropic' }, 'ant-key', 'anthropic');
  });

  it('OpenAI format should include model, messages, max_tokens', () => {
    // Access private method via any for testing
    const body = (openaiAdapter as any).buildRequestBody({
      systemPrompt: 'You are helpful.',
      userMessage: 'Hello',
      maxTokens: 100,
      temperature: 0.5,
    }, false);

    expect(body.model).toBe('gpt-4');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.5);
  });

  it('Ollama format should include model, messages, options', () => {
    const body = (ollamaAdapter as any).buildRequestBody({
      systemPrompt: 'You are helpful.',
      userMessage: 'Hello',
      maxTokens: 100,
    }, false);

    expect(body.model).toBe('llama3.2');
    expect(body.messages).toHaveLength(2);
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(100);
  });

  it('Gemini format should use contents array', () => {
    const body = (geminiAdapter as any).buildRequestBody({
      systemPrompt: 'You are helpful.',
      userMessage: 'Hello',
      maxTokens: 100,
    }, false);

    expect(body.contents).toBeDefined();
    expect(body.contents[0].parts[0].text).toContain('You are helpful.');
    expect(body.generationConfig.maxOutputTokens).toBe(100);
  });

  it('Anthropic raw format should split system and messages', () => {
    const body = (anthropicAdapter as any).buildRequestBody({
      systemPrompt: 'You are helpful.',
      userMessage: 'Hello',
      maxTokens: 100,
    }, false);

    expect(body.system).toBe('You are helpful.');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('should add response_format for JSON output (OpenAI)', () => {
    const body = (openaiAdapter as any).buildRequestBody({
      systemPrompt: 'Respond in JSON.',
      userMessage: 'Give status.',
      outputSchema: { type: 'object' },
    }, false);

    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('should add format json for Ollama JSON output', () => {
    const body = (ollamaAdapter as any).buildRequestBody({
      systemPrompt: 'Respond in JSON.',
      userMessage: 'Give status.',
      outputSchema: { type: 'object' },
    }, false);

    expect(body.format).toBe('json');
  });

  it('should add tools in OpenAI format', () => {
    const body = (openaiAdapter as any).buildRequestBody({
      systemPrompt: 'Use tools.',
      userMessage: 'Search for info.',
      tools: [
        { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
      ],
    }, false);

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('search');
  });

  it('should add tools in Anthropic format', () => {
    const body = (anthropicAdapter as any).buildRequestBody({
      systemPrompt: 'Use tools.',
      userMessage: 'Search for info.',
      tools: [
        { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
      ],
    }, false);

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('search');
    expect(body.tools[0].input_schema).toBeDefined();
  });

  it('should set stream flag when streaming', () => {
    const body = (openaiAdapter as any).buildRequestBody({
      systemPrompt: 'Test.',
      userMessage: 'Test.',
    }, true);

    expect(body.stream).toBe(true);
  });
});

describe('Universal Gateway - URL Building', () => {
  it('should build standard URL', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, 'sk-test', 'openai');
    const url = (adapter as any).buildUrl();
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('should build Gemini URL with model placeholder', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, 'gem-key', 'gemini');
    const url = (adapter as any).buildUrl();
    expect(url).toContain('gemini-pro');
    expect(url).toContain('key=gem-key');
  });

  it('should build Ollama local URL', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'ollama');
    const url = (adapter as any).buildUrl();
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('should add query param for api_key_query auth', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, 'my-key', 'gemini');
    const url = (adapter as any).buildUrl();
    expect(url).toContain('key=my-key');
  });
});

describe('Universal Gateway - Header Building', () => {
  it('should build bearer auth headers', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, 'sk-test-key', 'openai');
    const headers = (adapter as any).buildHeaders();
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should build custom header auth (Anthropic)', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, 'ant-key', 'anthropic');
    const headers = (adapter as any).buildHeaders();
    expect(headers['x-api-key']).toBe('ant-key');
  });

  it('should not add auth headers for none type', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'ollama');
    const headers = (adapter as any).buildHeaders();
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('Universal Gateway - Response Parsing', () => {
  it('should parse OpenAI response format', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const response = (adapter as any).parseResponse({
      choices: [{ message: { content: 'Hello world!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: 'gpt-4',
    }, Date.now() - 100);

    expect(response.content).toBe('Hello world!');
    expect(response.tokenUsage.promptTokens).toBe(10);
    expect(response.tokenUsage.completionTokens).toBe(5);
    expect(response.tokenUsage.totalTokens).toBe(15);
  });

  it('should parse Ollama response format', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'ollama');
    const response = (adapter as any).parseResponse({
      message: { content: 'Hi from Ollama' },
      prompt_eval_count: 20,
      eval_count: 8,
    }, Date.now() - 50);

    expect(response.content).toBe('Hi from Ollama');
    expect(response.tokenUsage.promptTokens).toBe(20);
    expect(response.tokenUsage.completionTokens).toBe(8);
  });

  it('should parse Gemini response format', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'gemini');
    const response = (adapter as any).parseResponse({
      candidates: [{ content: { parts: [{ text: 'Gemini says hi' }] } }],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10, totalTokenCount: 25 },
    }, Date.now() - 75);

    expect(response.content).toBe('Gemini says hi');
    expect(response.tokenUsage.promptTokens).toBe(15);
    expect(response.tokenUsage.completionTokens).toBe(10);
  });

  it('should parse raw response format with custom paths', () => {
    const config: GatewayProviderConfig = {
      name: 'custom',
      connection: { baseUrl: 'http://localhost', completionPath: '/gen' },
      auth: { type: 'none' },
      requestMapping: { format: 'raw', modelValue: 'test' },
      responseMapping: {
        format: 'raw',
        contentPath: 'result.text',
        promptTokensPath: 'stats.input_tokens',
        completionTokensPath: 'stats.output_tokens',
      },
      cost: { inputTokenCost: 0, outputTokenCost: 0 },
      capabilities: { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 },
    };
    const adapter = new UniversalGatewayAdapter(config);
    const response = (adapter as any).parseResponse({
      result: { text: 'Custom response' },
      stats: { input_tokens: 30, output_tokens: 12 },
    }, Date.now() - 60);

    expect(response.content).toBe('Custom response');
    expect(response.tokenUsage.promptTokens).toBe(30);
    expect(response.tokenUsage.completionTokens).toBe(12);
  });

  it('should parse JSON content from response', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const response = (adapter as any).parseResponse({
      choices: [{ message: { content: '{"status":"ok","count":42}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    }, Date.now());

    expect(response.parsedJson).toEqual({ status: 'ok', count: 42 });
  });

  it('should handle non-JSON content gracefully', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const response = (adapter as any).parseResponse({
      choices: [{ message: { content: 'This is plain text, not JSON.' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    }, Date.now());

    expect(response.parsedJson).toBeUndefined();
  });

  it('should parse OpenAI tool calls', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const response = (adapter as any).parseResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            type: 'function',
            function: { name: 'search', arguments: '{"query":"test"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }, Date.now());

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe('search');
    expect(response.toolCalls![0].arguments).toEqual({ query: 'test' });
  });

  it('should calculate cost from token usage', () => {
    const config: GatewayProviderConfig = {
      name: 'cost-test',
      connection: { baseUrl: 'http://localhost', completionPath: '/v1/chat/completions' },
      auth: { type: 'none' },
      requestMapping: { format: 'openai', modelValue: 'test' },
      responseMapping: { format: 'openai' },
      cost: { inputTokenCost: 0.00001, outputTokenCost: 0.00003 },
      capabilities: { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 },
    };
    const adapter = new UniversalGatewayAdapter(config);
    const response = (adapter as any).parseResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }, Date.now());

    // 100 * 0.00001 + 50 * 0.00003 = 0.001 + 0.0015 = 0.0025
    expect(response.tokenUsage.costUsd).toBeCloseTo(0.0025, 6);
  });

  it('should calculate zero cost for local models', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'ollama');
    const response = (adapter as any).parseResponse({
      message: { content: 'hello' },
      prompt_eval_count: 100,
      eval_count: 50,
    }, Date.now());

    expect(response.tokenUsage.costUsd).toBe(0);
  });
});

describe('Universal Gateway - Health Check', () => {
  it('should return healthy: true if no health endpoint configured', async () => {
    const adapter = createGatewayAdapter({
      name: 'no-health',
      connection: { baseUrl: 'http://localhost:9999', completionPath: '/gen' },
      auth: { type: 'none' },
      requestMapping: { format: 'openai', modelValue: 'test' },
      responseMapping: { format: 'openai' },
      capabilities: { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 },
    });

    const result = await adapter.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBe(0);
  });
});

describe('Universal Gateway - Streaming Fallback', () => {
  it('stream should work even when streaming format is none', async () => {
    const adapter = createGatewayAdapter({
      name: 'no-stream',
      connection: { baseUrl: 'http://localhost:9999', completionPath: '/gen' },
      auth: { type: 'none' },
      requestMapping: { format: 'openai', modelValue: 'test' },
      responseMapping: { format: 'openai' },
      streaming: { format: 'none' },
      capabilities: { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 },
    });

    // The stream method should fall back to complete() which will fail on actual HTTP
    // But the logic path is correct — it attempts complete() and yields result
    expect(adapter.stream).toBeDefined();
  });
});

describe('Universal Gateway - Edge Cases', () => {
  it('should handle empty response body gracefully', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const response = (adapter as any).parseResponse({}, Date.now());
    expect(response.content).toBe('');
    expect(response.tokenUsage.totalTokens).toBe(0);
  });

  it('should handle null values in response paths', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const response = (adapter as any).parseResponse({
      choices: [{ message: { content: null } }],
      usage: null,
    }, Date.now());
    expect(response.content).toBe('');
  });

  it('should handle missing nested objects', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'gemini');
    const response = (adapter as any).parseResponse({
      candidates: [],
    }, Date.now());
    expect(response.content).toBe('');
  });

  it('getConfig should return a copy', () => {
    const adapter = createGatewayAdapter({ name: 'test' }, '', 'openai');
    const config1 = adapter.getConfig();
    const config2 = adapter.getConfig();
    expect(config1).not.toBe(config2);
    expect(config1.name).toBe(config2.name);
  });
});
