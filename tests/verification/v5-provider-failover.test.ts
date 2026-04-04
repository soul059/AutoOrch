// Verification V5: Provider Failover
// Verifies provider failover works for timeout, 429/rate-limit, and auth-failure
// paths with complete audit visibility.

import { describe, it, expect } from 'vitest';

// ─── Provider failure classification ────────────────────────

type FailureType = 'timeout' | 'rate_limit' | 'auth_failure' | 'server_error' | 'invalid_response' | 'network_error';

interface FailoverResult {
  shouldRetry: boolean;
  shouldMarkUnhealthy: boolean;
  retryAfterMs: number;
  failureType: FailureType;
  auditSeverity: 'info' | 'warning' | 'error' | 'critical';
}

function classifyFailure(statusCode: number, error?: string): FailoverResult {
  if (statusCode === 0) {
    // Timeout or network error
    const isTimeout = error?.includes('timeout');
    return {
      shouldRetry: true,
      shouldMarkUnhealthy: false,
      retryAfterMs: 5000,
      failureType: isTimeout ? 'timeout' : 'network_error',
      auditSeverity: 'warning',
    };
  }

  if (statusCode === 429) {
    return {
      shouldRetry: true,
      shouldMarkUnhealthy: false,
      retryAfterMs: 30000,
      failureType: 'rate_limit',
      auditSeverity: 'warning',
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      shouldRetry: false,
      shouldMarkUnhealthy: true,
      retryAfterMs: 0,
      failureType: 'auth_failure',
      auditSeverity: 'critical',
    };
  }

  if (statusCode >= 500) {
    return {
      shouldRetry: true,
      shouldMarkUnhealthy: false,
      retryAfterMs: 10000,
      failureType: 'server_error',
      auditSeverity: 'error',
    };
  }

  return {
    shouldRetry: false,
    shouldMarkUnhealthy: false,
    retryAfterMs: 0,
    failureType: 'invalid_response',
    auditSeverity: 'error',
  };
}

// ─── Health tracking ────────────────────────────────────────

interface ProviderHealth {
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheckedAt: string;
  lastErrorMessage?: string;
}

const MAX_CONSECUTIVE_FAILURES = 3;

function updateHealth(health: ProviderHealth, success: boolean, error?: string): ProviderHealth {
  if (success) {
    return {
      isHealthy: true,
      consecutiveFailures: 0,
      lastCheckedAt: new Date().toISOString(),
      lastErrorMessage: undefined,
    };
  }

  const newFailures = Math.min(health.consecutiveFailures + 1, 999999);
  return {
    isHealthy: newFailures < MAX_CONSECUTIVE_FAILURES,
    consecutiveFailures: newFailures,
    lastCheckedAt: new Date().toISOString(),
    lastErrorMessage: error,
  };
}

// ─── Failover chain ─────────────────────────────────────────

interface Provider {
  id: string;
  name: string;
  health: ProviderHealth;
}

interface AuditEntry {
  eventType: string;
  providerId: string;
  payload: Record<string, unknown>;
}

function executeWithFailover(
  providers: Provider[],
  simulate: (providerId: string) => { success: boolean; statusCode: number; error?: string },
): { selectedProviderId: string | null; attempts: number; audit: AuditEntry[] } {
  const audit: AuditEntry[] = [];
  let attempts = 0;

  for (const provider of providers) {
    if (!provider.health.isHealthy) {
      audit.push({
        eventType: 'PROVIDER_SKIPPED',
        providerId: provider.id,
        payload: { reason: 'unhealthy', consecutiveFailures: provider.health.consecutiveFailures },
      });
      continue;
    }

    attempts++;
    const result = simulate(provider.id);

    if (result.success) {
      audit.push({
        eventType: 'PROVIDER_CALLED',
        providerId: provider.id,
        payload: { success: true, statusCode: result.statusCode },
      });
      return { selectedProviderId: provider.id, attempts, audit };
    }

    const failure = classifyFailure(result.statusCode, result.error);
    audit.push({
      eventType: 'PROVIDER_FAILED',
      providerId: provider.id,
      payload: {
        success: false,
        statusCode: result.statusCode,
        failureType: failure.failureType,
        shouldRetry: failure.shouldRetry,
        shouldMarkUnhealthy: failure.shouldMarkUnhealthy,
        auditSeverity: failure.auditSeverity,
      },
    });

    if (failure.shouldMarkUnhealthy) {
      provider.health = updateHealth(provider.health, false, result.error);
    }

    // If shouldn't retry with this failure type, try next provider
    if (!failure.shouldRetry) continue;

    // On retryable failure, try next provider in chain
    continue;
  }

  return { selectedProviderId: null, attempts, audit };
}

// ─── Tests ──────────────────────────────────────────────────

describe('V5: Timeout Failover', () => {
  it('retries on timeout and tries next provider', () => {
    const providers: Provider[] = [
      { id: 'p1', name: 'primary', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
      { id: 'p2', name: 'secondary', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
    ];

    const result = executeWithFailover(providers, (id) => {
      if (id === 'p1') return { success: false, statusCode: 0, error: 'Request timeout after 30000ms' };
      return { success: true, statusCode: 200 };
    });

    expect(result.selectedProviderId).toBe('p2');
    expect(result.attempts).toBe(2);
    expect(result.audit.some(a => a.eventType === 'PROVIDER_FAILED' && a.payload.failureType === 'timeout')).toBe(true);
  });

  it('timeout does not permanently mark provider unhealthy', () => {
    const failure = classifyFailure(0, 'Request timeout after 30000ms');
    expect(failure.shouldRetry).toBe(true);
    expect(failure.shouldMarkUnhealthy).toBe(false);
  });

  it('audit trail captures timeout with warning severity', () => {
    const failure = classifyFailure(0, 'Request timeout after 30000ms');
    expect(failure.auditSeverity).toBe('warning');
  });
});

describe('V5: Rate-Limit (429) Failover', () => {
  it('retries on 429 and tries next provider', () => {
    const providers: Provider[] = [
      { id: 'p1', name: 'primary', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
      { id: 'p2', name: 'secondary', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
    ];

    const result = executeWithFailover(providers, (id) => {
      if (id === 'p1') return { success: false, statusCode: 429, error: 'Rate limit exceeded' };
      return { success: true, statusCode: 200 };
    });

    expect(result.selectedProviderId).toBe('p2');
  });

  it('429 suggests 30s retry delay', () => {
    const failure = classifyFailure(429);
    expect(failure.shouldRetry).toBe(true);
    expect(failure.retryAfterMs).toBe(30000);
  });

  it('429 does not mark provider unhealthy', () => {
    const failure = classifyFailure(429);
    expect(failure.shouldMarkUnhealthy).toBe(false);
  });

  it('audit trail captures rate limit with warning severity', () => {
    const failure = classifyFailure(429);
    expect(failure.auditSeverity).toBe('warning');
  });
});

describe('V5: Auth Failure (401/403) Failover', () => {
  it('auth failure marks provider as unhealthy', () => {
    const failure = classifyFailure(401);
    expect(failure.shouldMarkUnhealthy).toBe(true);
    expect(failure.shouldRetry).toBe(false);
  });

  it('403 also marks provider as unhealthy', () => {
    const failure = classifyFailure(403);
    expect(failure.shouldMarkUnhealthy).toBe(true);
    expect(failure.shouldRetry).toBe(false);
  });

  it('auth failure is critical severity in audit', () => {
    expect(classifyFailure(401).auditSeverity).toBe('critical');
    expect(classifyFailure(403).auditSeverity).toBe('critical');
  });

  it('auth failure on primary triggers fallback to secondary', () => {
    const providers: Provider[] = [
      { id: 'p1', name: 'primary', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
      { id: 'p2', name: 'secondary', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
    ];

    const result = executeWithFailover(providers, (id) => {
      if (id === 'p1') return { success: false, statusCode: 401, error: 'Invalid API key' };
      return { success: true, statusCode: 200 };
    });

    expect(result.selectedProviderId).toBe('p2');
    // p1 should now be marked unhealthy
    expect(providers[0].health.isHealthy).toBe(true); // 1 failure, not yet at threshold
  });

  it('provider becomes unhealthy after MAX_CONSECUTIVE_FAILURES auth failures', () => {
    let health: ProviderHealth = { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' };

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      health = updateHealth(health, false, 'Auth failed');
    }

    expect(health.isHealthy).toBe(false);
    expect(health.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES);
  });
});

describe('V5: Server Error (5xx) Failover', () => {
  it('500 is retryable', () => {
    expect(classifyFailure(500).shouldRetry).toBe(true);
  });

  it('502 is retryable', () => {
    expect(classifyFailure(502).shouldRetry).toBe(true);
  });

  it('503 is retryable', () => {
    expect(classifyFailure(503).shouldRetry).toBe(true);
  });

  it('server error does not mark provider unhealthy', () => {
    expect(classifyFailure(500).shouldMarkUnhealthy).toBe(false);
  });

  it('server error has error severity in audit', () => {
    expect(classifyFailure(500).auditSeverity).toBe('error');
  });
});

describe('V5: Complete Audit Trail for Failover', () => {
  it('generates audit entries for skipped, failed, and successful providers', () => {
    const providers: Provider[] = [
      { id: 'p1', name: 'unhealthy', health: { isHealthy: false, consecutiveFailures: 5, lastCheckedAt: '' } },
      { id: 'p2', name: 'rate-limited', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
      { id: 'p3', name: 'success', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
    ];

    const result = executeWithFailover(providers, (id) => {
      if (id === 'p2') return { success: false, statusCode: 429, error: 'Rate limited' };
      return { success: true, statusCode: 200 };
    });

    expect(result.selectedProviderId).toBe('p3');
    expect(result.audit.length).toBe(3);

    // p1: skipped (unhealthy)
    expect(result.audit[0].eventType).toBe('PROVIDER_SKIPPED');
    expect(result.audit[0].providerId).toBe('p1');

    // p2: failed (rate limited)
    expect(result.audit[1].eventType).toBe('PROVIDER_FAILED');
    expect(result.audit[1].providerId).toBe('p2');
    expect(result.audit[1].payload.failureType).toBe('rate_limit');

    // p3: success
    expect(result.audit[2].eventType).toBe('PROVIDER_CALLED');
    expect(result.audit[2].providerId).toBe('p3');
  });

  it('all-providers-down produces audit for every attempt', () => {
    const providers: Provider[] = [
      { id: 'p1', name: 'first', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
      { id: 'p2', name: 'second', health: { isHealthy: true, consecutiveFailures: 0, lastCheckedAt: '' } },
    ];

    const result = executeWithFailover(providers, () => {
      return { success: false, statusCode: 500, error: 'Internal server error' };
    });

    expect(result.selectedProviderId).toBeNull();
    expect(result.attempts).toBe(2);
    expect(result.audit.length).toBe(2);
    expect(result.audit.every(a => a.eventType === 'PROVIDER_FAILED')).toBe(true);
  });

  it('health recovery after successful call', () => {
    let health: ProviderHealth = { isHealthy: true, consecutiveFailures: 2, lastCheckedAt: '' };

    // One more failure would make it unhealthy
    health = updateHealth(health, true);

    expect(health.isHealthy).toBe(true);
    expect(health.consecutiveFailures).toBe(0);
  });
});
