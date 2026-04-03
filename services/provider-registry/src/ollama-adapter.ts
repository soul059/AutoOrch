import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
} from './adapter-interface.js';
import { Agent, setGlobalDispatcher } from 'undici';

// Configure global HTTP agent with extended timeouts for long-running LLM requests
const agent = new Agent({
  bodyTimeout: 600000,      // 10 minutes for response body
  headersTimeout: 600000,   // 10 minutes for headers
  keepAliveTimeout: 600000, // 10 minutes keep-alive
  keepAliveMaxTimeout: 600000,
});
setGlobalDispatcher(agent);

// Retry helper for transient failures
// NOTE: We use minimal provider-level retries (2) because task-level retries also exist.
// This prevents excessive requests (old: 4 provider × 3 task = 12, new: 2 × 3 = 6 max)
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 3000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const errorMsg = lastError.message.toLowerCase();
      
      // 500 errors are often GPU VRAM exhaustion - NOT retryable at provider level
      // Let the task-level retry handle it after a longer cooldown
      const is500Error = errorMsg.includes('500');
      
      // Only retry on connection issues, not server errors
      const isRetryable = !is500Error && (
                          errorMsg.includes('503') ||
                          errorMsg.includes('econnrefused') ||
                          errorMsg.includes('econnreset') ||
                          errorMsg.includes('network') ||
                          errorMsg.includes('etimedout'));
      
      // Timeout/abort errors: only retry once, then let task-level handle it
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('aborted');
      if (isTimeout && attempt >= 1) {
        console.log(`[OllamaAdapter] Timeout/abort error - not retrying at provider level`);
        throw lastError;
      }
      
      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }
      
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.log(`[OllamaAdapter] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}. Retrying in ${backoffDelay}ms...`);
      await new Promise(r => setTimeout(r, backoffDelay));
    }
  }
  throw lastError;
}

export class OllamaAdapter implements ProviderAdapter {
  readonly name: string;
  readonly type = 'OLLAMA';
  private endpoint: string;
  private modelName: string;

  constructor(name: string, endpoint: string, modelName: string) {
    this.name = name;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.modelName = modelName;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    return withRetry(async () => {
      const startTime = Date.now();

      const body: Record<string, unknown> = {
        model: this.modelName,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage },
        ],
        stream: false,
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

      // Add timeout to prevent hanging - 10 minutes for local models
      // Local models can be slow, especially with large context
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

      try {
        const response = await fetch(`${this.endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`Ollama error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json() as {
          message: { content: string; thinking?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const durationMs = Date.now() - startTime;

        // Debug: log raw response structure
        console.log(`[OllamaAdapter.complete] Raw message:`, JSON.stringify(data.message).substring(0, 500));

        // Support both regular content and thinking models (DeepSeek, Qwen, etc.)
        // For non-streaming, content should have the final answer
        const content = data.message?.content || data.message?.thinking || '';
        let parsedJson: Record<string, unknown> | undefined;

        if (request.outputSchema) {
          try {
            parsedJson = JSON.parse(content);
          } catch {
            // JSON parsing failed — will be handled by strict validator
          }
        }

        return {
          content,
          parsedJson,
          tokenUsage: {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            costUsd: 0, // local — no cost
          },
          model: this.modelName,
          durationMs,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }); // Use default maxRetries (2) to prevent excessive requests
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const body = {
      model: this.modelName,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userMessage },
      ],
      stream: true,
      keep_alive: '30m', // Keep model loaded for 30 minutes to prevent timeout during long requests
      options: {
        num_ctx: 8192,   // Increase context window (default is 2048, too small for complex tasks)
        num_predict: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
      },
    };

    // Add timeout for streaming (10 minutes - local models can be slow)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Ollama stream error: ${response.status} - ${errorText}`);
      }

      if (!response.body) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      // Use async iteration - works with both native fetch and undici
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as { message?: { content: string; thinking?: string }; done?: boolean };
            // Support thinking models: yield BOTH thinking and content
            // Thinking comes first, then content at the end
            const thinking = parsed.message?.thinking || '';
            const content = parsed.message?.content || '';
            const output = content || thinking;
            const isDone = parsed.done || false;
            
            if (output || isDone) {
              yield { content: output, done: isDone };
            }
          } catch (e) {
            console.log(`[OllamaAdapter.stream] Parse error:`, (e as Error).message, 'line:', line.substring(0, 100));
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;
      return { healthy: response.ok, latencyMs };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  validateCapabilities(required: { structuredOutput?: boolean; toolUse?: boolean }): boolean {
    if (required.toolUse) return false; // Ollama doesn't natively support tool use
    return true;
  }
}
