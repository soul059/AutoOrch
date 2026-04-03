import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from './adapter-interface.js';

export class GeminiAdapter implements ProviderAdapter {
  readonly name: string;
  readonly type = 'GEMINI';
  private apiKey: string;
  private modelName: string;

  constructor(name: string, apiKey: string, modelName: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          parts: [{ text: `${request.systemPrompt}\n\n${request.userMessage}` }],
        },
      ],
      generationConfig: {
        maxOutputTokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
      },
    };

    if (request.outputSchema) {
      (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini error: ${response.status} ${errorText.substring(0, 500)}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const durationMs = Date.now() - startTime;

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsedJson: Record<string, unknown> | undefined;

    if (request.outputSchema) {
      try {
        parsedJson = JSON.parse(content);
      } catch {
        // JSON parsing failed
      }
    }

    const usage = data.usageMetadata;
    const promptTokens = usage?.promptTokenCount || 0;
    const completionTokens = usage?.candidatesTokenCount || 0;

    return {
      content,
      parsedJson,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: usage?.totalTokenCount || promptTokens + completionTokens,
        costUsd: (promptTokens * 0.00000025) + (completionTokens * 0.0000005),
      },
      model: this.modelName,
      durationMs,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return { healthy: response.ok, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  validateCapabilities(required: { structuredOutput?: boolean; toolUse?: boolean }): boolean {
    // Gemini supports structured output and tool use
    return true;
  }
}
