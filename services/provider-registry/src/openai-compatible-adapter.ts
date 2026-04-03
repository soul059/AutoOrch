import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from './adapter-interface.js';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: string;
  readonly type = 'OPENAI_COMPATIBLE';
  private endpoint: string;
  private apiKey: string;
  private modelName: string;

  constructor(name: string, endpoint: string, apiKey: string, modelName: string) {
    this.name = name;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    const messages = [
      { role: 'system' as const, content: request.systemPrompt },
      { role: 'user' as const, content: request.userMessage },
    ];

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature || 0.7,
    };

    if (request.outputSchema) {
      body.response_format = { type: 'json_object' };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI-compatible error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const durationMs = Date.now() - startTime;

    const content = data.choices?.[0]?.message?.content || '';
    let parsedJson: Record<string, unknown> | undefined;

    if (request.outputSchema) {
      try {
        parsedJson = JSON.parse(content);
      } catch {
        // JSON parsing failed
      }
    }

    const toolCalls = data.choices?.[0]?.message?.tool_calls?.map(tc => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Malformed tool call arguments from provider
      }
      return { name: tc.function.name, arguments: args };
    });

    const usage = data.usage;
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;

    return {
      content,
      parsedJson,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: usage?.total_tokens || promptTokens + completionTokens,
        costUsd: (promptTokens * 0.000003) + (completionTokens * 0.000006),
      },
      model: this.modelName,
      durationMs,
      toolCalls,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return { healthy: response.ok, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  validateCapabilities(required: { structuredOutput?: boolean; toolUse?: boolean }): boolean {
    return true;
  }
}
