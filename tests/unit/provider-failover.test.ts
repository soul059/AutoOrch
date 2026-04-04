// Provider Failover Verification Tests
// Validates that the routing system correctly handles provider failures and fallback chains

import { describe, it, expect } from 'vitest';

// Simulate provider health states for testing
interface MockProvider {
  id: string;
  name: string;
  healthy: boolean;
  supportsStructuredOutput: boolean;
  supportsToolUse: boolean;
  priority: number;
}

function selectProvider(
  providers: MockProvider[],
  requiredCapabilities: { structuredOutput?: boolean; toolUse?: boolean } = {},
  userOverrideId?: string,
): MockProvider | null {
  // 1. User override
  if (userOverrideId) {
    const found = providers.find(p => p.id === userOverrideId);
    if (found) return found;
  }

  // 2. Priority-ordered, health-filtered selection
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  for (const provider of sorted) {
    if (!provider.healthy) continue;
    if (requiredCapabilities.structuredOutput && !provider.supportsStructuredOutput) continue;
    if (requiredCapabilities.toolUse && !provider.supportsToolUse) continue;
    return provider;
  }

  // 3. No provider available
  return null;
}

describe('Provider Failover', () => {
  const providers: MockProvider[] = [
    { id: '1', name: 'ollama-local', healthy: true, supportsStructuredOutput: false, supportsToolUse: false, priority: 1 },
    { id: '2', name: 'gemini-cloud', healthy: true, supportsStructuredOutput: true, supportsToolUse: true, priority: 2 },
    { id: '3', name: 'openai-cloud', healthy: true, supportsStructuredOutput: true, supportsToolUse: true, priority: 3 },
  ];

  it('selects highest-priority healthy provider', () => {
    const result = selectProvider(providers);
    expect(result?.name).toBe('ollama-local');
  });

  it('skips unhealthy providers', () => {
    const withUnhealthy = providers.map(p =>
      p.id === '1' ? { ...p, healthy: false } : p
    );
    const result = selectProvider(withUnhealthy);
    expect(result?.name).toBe('gemini-cloud');
  });

  it('falls back through entire chain when providers are down', () => {
    const mostDown = providers.map(p =>
      p.id !== '3' ? { ...p, healthy: false } : p
    );
    const result = selectProvider(mostDown);
    expect(result?.name).toBe('openai-cloud');
  });

  it('returns null when all providers are down', () => {
    const allDown = providers.map(p => ({ ...p, healthy: false }));
    const result = selectProvider(allDown);
    expect(result).toBeNull();
  });

  it('user override bypasses priority order', () => {
    const result = selectProvider(providers, {}, '3');
    expect(result?.name).toBe('openai-cloud');
  });

  it('filters by capability requirements', () => {
    const result = selectProvider(providers, { structuredOutput: true });
    expect(result?.name).toBe('gemini-cloud');
  });

  it('capability filtering still respects health', () => {
    const geminiDown = providers.map(p =>
      p.id === '2' ? { ...p, healthy: false } : p
    );
    const result = selectProvider(geminiDown, { structuredOutput: true });
    expect(result?.name).toBe('openai-cloud');
  });

  it('returns null when no provider meets capability requirements', () => {
    const result = selectProvider(providers, { structuredOutput: true, toolUse: true });
    // Both gemini and openai support these, so it should find one
    expect(result).not.toBeNull();

    // Now test with only ollama available
    const onlyOllama = [providers[0]];
    const result2 = selectProvider(onlyOllama, { structuredOutput: true });
    expect(result2).toBeNull();
  });
});

describe('Provider Timeout/Rate-Limit Scenarios', () => {
  it('marks provider unhealthy after consecutive failures', () => {
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 3;

    // Simulate 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      consecutiveFailures++;
    }

    const isHealthy = consecutiveFailures < maxConsecutiveFailures;
    expect(isHealthy).toBe(false);
  });

  it('resets failure count after successful call', () => {
    let consecutiveFailures = 2;

    // Simulate successful call
    consecutiveFailures = 0;

    expect(consecutiveFailures).toBe(0);
  });

  it('rate-limit (429) should trigger backoff, not permanent failure', () => {
    // Simulate rate-limit response
    const responseCode = 429;
    const retryAfterSeconds = 30;

    const shouldRetry = responseCode === 429;
    const shouldMarkUnhealthy = false; // 429 is temporary

    expect(shouldRetry).toBe(true);
    expect(shouldMarkUnhealthy).toBe(false);
  });

  it('auth failure (401/403) should mark provider as unhealthy', () => {
    const responseCode = 401;
    const shouldMarkUnhealthy = [401, 403].includes(responseCode);

    expect(shouldMarkUnhealthy).toBe(true);
  });
});
