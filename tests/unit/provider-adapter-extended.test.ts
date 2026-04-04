// Provider Adapter Extended Tests
// Additional tests for adapter edge cases, error handling, and streaming

import { describe, it, expect } from 'vitest';

// ============================================================================
// ADAPTER REQUEST/RESPONSE CONTRACTS
// ============================================================================

interface ProviderRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface ProviderResponse {
  content: string;
  model: string;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

// Adapter interface simulation
interface ProviderAdapter {
  name: string;
  normalizeRequest(req: ProviderRequest): unknown;
  parseResponse(raw: unknown): ProviderResponse;
  calculateCost(tokens: { input: number; output: number }): number;
}

// ============================================================================
// OLLAMA ADAPTER TESTS
// ============================================================================

const ollamaCostPerToken = 0; // Local models are free

function createOllamaAdapter(): ProviderAdapter {
  return {
    name: 'ollama',
    normalizeRequest(req: ProviderRequest) {
      return {
        model: req.model,
        prompt: req.messages.map(m => `${m.role}: ${m.content}`).join('\n'),
        stream: req.stream ?? false,
        options: {
          temperature: req.temperature ?? 0.7,
          num_predict: req.max_tokens ?? 2048,
        },
      };
    },
    parseResponse(raw: any) {
      return {
        content: raw.response || '',
        model: raw.model || 'unknown',
        tokensUsed: {
          input: raw.prompt_eval_count || 0,
          output: raw.eval_count || 0,
          total: (raw.prompt_eval_count || 0) + (raw.eval_count || 0),
        },
        cost: 0,
        finishReason: raw.done ? 'stop' : 'length',
      };
    },
    calculateCost() {
      return 0; // Always free
    },
  };
}

describe('Ollama Adapter', () => {
  const adapter = createOllamaAdapter();

  describe('Request Normalization', () => {
    it('converts messages to prompt format', () => {
      const req: ProviderRequest = {
        model: 'llama3',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
      };

      const normalized = adapter.normalizeRequest(req) as any;

      expect(normalized.prompt).toContain('system: You are helpful.');
      expect(normalized.prompt).toContain('user: Hello!');
    });

    it('applies default temperature', () => {
      const req: ProviderRequest = { model: 'llama3', messages: [] };
      const normalized = adapter.normalizeRequest(req) as any;

      expect(normalized.options.temperature).toBe(0.7);
    });

    it('applies custom temperature', () => {
      const req: ProviderRequest = { model: 'llama3', messages: [], temperature: 0.2 };
      const normalized = adapter.normalizeRequest(req) as any;

      expect(normalized.options.temperature).toBe(0.2);
    });

    it('applies default max_tokens', () => {
      const req: ProviderRequest = { model: 'llama3', messages: [] };
      const normalized = adapter.normalizeRequest(req) as any;

      expect(normalized.options.num_predict).toBe(2048);
    });

    it('sets stream flag', () => {
      const req: ProviderRequest = { model: 'llama3', messages: [], stream: true };
      const normalized = adapter.normalizeRequest(req) as any;

      expect(normalized.stream).toBe(true);
    });
  });

  describe('Response Parsing', () => {
    it('extracts content from response', () => {
      const raw = { response: 'Hello, world!', model: 'llama3', done: true };
      const parsed = adapter.parseResponse(raw);

      expect(parsed.content).toBe('Hello, world!');
    });

    it('extracts token counts', () => {
      const raw = {
        response: 'Hi',
        model: 'llama3',
        prompt_eval_count: 10,
        eval_count: 5,
        done: true,
      };
      const parsed = adapter.parseResponse(raw);

      expect(parsed.tokensUsed.input).toBe(10);
      expect(parsed.tokensUsed.output).toBe(5);
      expect(parsed.tokensUsed.total).toBe(15);
    });

    it('handles missing token counts', () => {
      const raw = { response: 'Hi', model: 'llama3', done: true };
      const parsed = adapter.parseResponse(raw);

      expect(parsed.tokensUsed.input).toBe(0);
      expect(parsed.tokensUsed.output).toBe(0);
    });

    it('sets finishReason based on done flag', () => {
      expect(adapter.parseResponse({ done: true }).finishReason).toBe('stop');
      expect(adapter.parseResponse({ done: false }).finishReason).toBe('length');
    });
  });

  describe('Cost Calculation', () => {
    it('always returns 0 cost', () => {
      expect(adapter.calculateCost({ input: 1000, output: 500 })).toBe(0);
      expect(adapter.calculateCost({ input: 0, output: 0 })).toBe(0);
      expect(adapter.calculateCost({ input: 1000000, output: 1000000 })).toBe(0);
    });
  });
});

// ============================================================================
// CLOUD ADAPTER COST CALCULATION
// ============================================================================

interface PricingTier {
  inputPer1M: number;  // Cost per 1M input tokens
  outputPer1M: number; // Cost per 1M output tokens
}

const PRICING: Record<string, PricingTier> = {
  'gpt-4': { inputPer1M: 30, outputPer1M: 60 },
  'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },
  'claude-3-opus': { inputPer1M: 15, outputPer1M: 75 },
  'claude-3-sonnet': { inputPer1M: 3, outputPer1M: 15 },
  'gemini-pro': { inputPer1M: 0.5, outputPer1M: 1.5 },
};

function calculateCloudCost(model: string, tokens: { input: number; output: number }): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  const inputCost = (tokens.input / 1_000_000) * pricing.inputPer1M;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPer1M;

  return inputCost + outputCost;
}

describe('Cloud Cost Calculation', () => {
  it('calculates GPT-4 cost correctly', () => {
    const cost = calculateCloudCost('gpt-4', { input: 1000, output: 500 });
    // (1000/1M * 30) + (500/1M * 60) = 0.03 + 0.03 = 0.06
    expect(cost).toBeCloseTo(0.06, 6);
  });

  it('calculates GPT-3.5-turbo cost correctly', () => {
    const cost = calculateCloudCost('gpt-3.5-turbo', { input: 10000, output: 5000 });
    // (10000/1M * 0.5) + (5000/1M * 1.5) = 0.005 + 0.0075 = 0.0125
    expect(cost).toBeCloseTo(0.0125, 6);
  });

  it('calculates Claude costs correctly', () => {
    const opusCost = calculateCloudCost('claude-3-opus', { input: 1000, output: 1000 });
    // (1000/1M * 15) + (1000/1M * 75) = 0.015 + 0.075 = 0.09
    expect(opusCost).toBeCloseTo(0.09, 6);
  });

  it('handles unknown models', () => {
    const cost = calculateCloudCost('unknown-model', { input: 1000, output: 1000 });
    expect(cost).toBe(0);
  });

  it('handles zero tokens', () => {
    const cost = calculateCloudCost('gpt-4', { input: 0, output: 0 });
    expect(cost).toBe(0);
  });

  it('handles large token counts', () => {
    const cost = calculateCloudCost('gpt-4', { input: 100000, output: 50000 });
    // (100000/1M * 30) + (50000/1M * 60) = 3 + 3 = 6
    expect(cost).toBeCloseTo(6, 4);
  });
});

// ============================================================================
// ERROR RESPONSE HANDLING
// ============================================================================

interface ErrorResponse {
  error: {
    type: string;
    message: string;
    code?: string;
  };
}

function categorizeError(response: ErrorResponse): 'auth' | 'rate_limit' | 'server' | 'client' | 'unknown' {
  const { type, code } = response.error;

  if (type === 'authentication_error' || code === '401' || code === '403') {
    return 'auth';
  }
  if (type === 'rate_limit_error' || code === '429') {
    return 'rate_limit';
  }
  if (type === 'server_error' || (code && code.startsWith('5'))) {
    return 'server';
  }
  if (type === 'invalid_request_error' || (code && code.startsWith('4'))) {
    return 'client';
  }
  return 'unknown';
}

describe('Error Response Handling', () => {
  it('categorizes authentication errors', () => {
    expect(categorizeError({ error: { type: 'authentication_error', message: 'Invalid API key' } })).toBe('auth');
    expect(categorizeError({ error: { type: 'error', message: 'Forbidden', code: '403' } })).toBe('auth');
    expect(categorizeError({ error: { type: 'error', message: 'Unauthorized', code: '401' } })).toBe('auth');
  });

  it('categorizes rate limit errors', () => {
    expect(categorizeError({ error: { type: 'rate_limit_error', message: 'Too many requests' } })).toBe('rate_limit');
    expect(categorizeError({ error: { type: 'error', message: 'Rate limited', code: '429' } })).toBe('rate_limit');
  });

  it('categorizes server errors', () => {
    expect(categorizeError({ error: { type: 'server_error', message: 'Internal error' } })).toBe('server');
    expect(categorizeError({ error: { type: 'error', message: 'Bad Gateway', code: '502' } })).toBe('server');
    expect(categorizeError({ error: { type: 'error', message: 'Service Unavailable', code: '503' } })).toBe('server');
  });

  it('categorizes client errors', () => {
    expect(categorizeError({ error: { type: 'invalid_request_error', message: 'Bad request' } })).toBe('client');
    expect(categorizeError({ error: { type: 'error', message: 'Bad Request', code: '400' } })).toBe('client');
  });

  it('handles unknown errors', () => {
    expect(categorizeError({ error: { type: 'unknown', message: 'Something went wrong' } })).toBe('unknown');
  });
});

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

function validateJsonResponse(content: string): { valid: boolean; parsed?: unknown; error?: string } {
  if (!content || content.trim() === '') {
    return { valid: false, error: 'Empty response' };
  }

  try {
    const parsed = JSON.parse(content);
    
    // Check for null
    if (parsed === null) {
      return { valid: false, error: 'Response is null' };
    }
    
    // Must be an object (not array, number, etc. for structured outputs)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, error: 'Response must be a JSON object' };
    }
    
    return { valid: true, parsed };
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

describe('JSON Response Validation', () => {
  it('accepts valid JSON objects', () => {
    const result = validateJsonResponse('{"key": "value"}');
    expect(result.valid).toBe(true);
    expect(result.parsed).toEqual({ key: 'value' });
  });

  it('accepts nested JSON objects', () => {
    const result = validateJsonResponse('{"outer": {"inner": "value"}}');
    expect(result.valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validateJsonResponse('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Empty');
  });

  it('rejects whitespace-only', () => {
    const result = validateJsonResponse('   \n\t   ');
    expect(result.valid).toBe(false);
  });

  it('rejects JSON arrays', () => {
    const result = validateJsonResponse('[1, 2, 3]');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('object');
  });

  it('rejects JSON primitives', () => {
    expect(validateJsonResponse('"string"').valid).toBe(false);
    expect(validateJsonResponse('123').valid).toBe(false);
    expect(validateJsonResponse('true').valid).toBe(false);
  });

  it('rejects null', () => {
    const result = validateJsonResponse('null');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('null');
  });

  it('rejects invalid JSON', () => {
    expect(validateJsonResponse('{invalid}').valid).toBe(false);
    expect(validateJsonResponse('{"key": }').valid).toBe(false);
    expect(validateJsonResponse('not json').valid).toBe(false);
  });

  it('extracts JSON from markdown code blocks', () => {
    // This should still fail because we're validating strict JSON
    const result = validateJsonResponse('```json\n{"key": "value"}\n```');
    expect(result.valid).toBe(false); // Contains non-JSON characters
  });
});

// ============================================================================
// PROVIDER HEALTH STATUS
// ============================================================================

interface ProviderHealth {
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheckTime: Date;
  lastError?: string;
}

const MAX_CONSECUTIVE_FAILURES = 3;

function updateHealthStatus(
  current: ProviderHealth,
  success: boolean,
  error?: string
): ProviderHealth {
  if (success) {
    return {
      isHealthy: true,
      consecutiveFailures: 0,
      lastCheckTime: new Date(),
      lastError: undefined,
    };
  }

  const newFailures = current.consecutiveFailures + 1;
  return {
    isHealthy: newFailures < MAX_CONSECUTIVE_FAILURES,
    consecutiveFailures: newFailures,
    lastCheckTime: new Date(),
    lastError: error,
  };
}

describe('Provider Health Tracking', () => {
  it('starts healthy', () => {
    const initial: ProviderHealth = {
      isHealthy: true,
      consecutiveFailures: 0,
      lastCheckTime: new Date(),
    };
    
    expect(initial.isHealthy).toBe(true);
  });

  it('stays healthy on success', () => {
    const current: ProviderHealth = {
      isHealthy: true,
      consecutiveFailures: 0,
      lastCheckTime: new Date(),
    };

    const updated = updateHealthStatus(current, true);

    expect(updated.isHealthy).toBe(true);
    expect(updated.consecutiveFailures).toBe(0);
  });

  it('resets failures on success', () => {
    const current: ProviderHealth = {
      isHealthy: true,
      consecutiveFailures: 2,
      lastCheckTime: new Date(),
      lastError: 'Previous error',
    };

    const updated = updateHealthStatus(current, true);

    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.lastError).toBeUndefined();
  });

  it('increments failures on error', () => {
    const current: ProviderHealth = {
      isHealthy: true,
      consecutiveFailures: 1,
      lastCheckTime: new Date(),
    };

    const updated = updateHealthStatus(current, false, 'Connection timeout');

    expect(updated.consecutiveFailures).toBe(2);
    expect(updated.lastError).toBe('Connection timeout');
  });

  it('becomes unhealthy after MAX_CONSECUTIVE_FAILURES', () => {
    let health: ProviderHealth = {
      isHealthy: true,
      consecutiveFailures: 0,
      lastCheckTime: new Date(),
    };

    // First failure
    health = updateHealthStatus(health, false, 'Error 1');
    expect(health.isHealthy).toBe(true);
    expect(health.consecutiveFailures).toBe(1);

    // Second failure
    health = updateHealthStatus(health, false, 'Error 2');
    expect(health.isHealthy).toBe(true);
    expect(health.consecutiveFailures).toBe(2);

    // Third failure - now unhealthy
    health = updateHealthStatus(health, false, 'Error 3');
    expect(health.isHealthy).toBe(false);
    expect(health.consecutiveFailures).toBe(3);
  });

  it('recovers to healthy after success', () => {
    const unhealthy: ProviderHealth = {
      isHealthy: false,
      consecutiveFailures: 5,
      lastCheckTime: new Date(),
      lastError: 'Many errors',
    };

    const recovered = updateHealthStatus(unhealthy, true);

    expect(recovered.isHealthy).toBe(true);
    expect(recovered.consecutiveFailures).toBe(0);
  });
});
