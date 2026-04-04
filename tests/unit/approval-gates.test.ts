// Approval Gate Verification Tests
// Validates that approval gates block high-risk actions and rejection returns safe state

import { describe, it, expect } from 'vitest';

// Risk classification logic (mirrors services/policy-engine/src/index.ts)
type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface ActionEvaluation {
  action: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  blocked: boolean;
  reason?: string;
}

const BLOCKED_ACTIONS = new Set(['rm_rf', 'format_disk', 'drop_database', 'sudo']);
const HIGH_RISK_ACTIONS = new Set([
  'bash_exec', 'file_write', 'deploy', 'payment',
  'external_api_call', 'database_write', 'send_email',
]);
const MEDIUM_RISK_ACTIONS = new Set(['file_read', 'database_read', 'http_get']);

function evaluateAction(action: string): ActionEvaluation {
  if (BLOCKED_ACTIONS.has(action)) {
    return { action, riskLevel: 'CRITICAL', requiresApproval: false, blocked: true, reason: 'Action is permanently blocked' };
  }
  if (HIGH_RISK_ACTIONS.has(action)) {
    return { action, riskLevel: 'HIGH', requiresApproval: true, blocked: false };
  }
  if (MEDIUM_RISK_ACTIONS.has(action)) {
    return { action, riskLevel: 'MEDIUM', requiresApproval: false, blocked: false };
  }
  return { action, riskLevel: 'LOW', requiresApproval: false, blocked: false };
}

// Approval state machine
type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

function processApproval(
  currentState: ApprovalState,
  decision: 'approve' | 'reject' | 'expire'
): { newState: ApprovalState; runShouldPause: boolean } {
  if (currentState !== 'PENDING') {
    throw new Error(`Cannot process approval in state ${currentState}`);
  }

  switch (decision) {
    case 'approve':
      return { newState: 'APPROVED', runShouldPause: false };
    case 'reject':
      return { newState: 'REJECTED', runShouldPause: true };
    case 'expire':
      return { newState: 'EXPIRED', runShouldPause: true };
  }
}

describe('Action Risk Classification', () => {
  it('blocks destructive actions', () => {
    for (const action of ['rm_rf', 'format_disk', 'drop_database', 'sudo']) {
      const result = evaluateAction(action);
      expect(result.blocked).toBe(true);
      expect(result.riskLevel).toBe('CRITICAL');
    }
  });

  it('requires approval for high-risk actions', () => {
    for (const action of ['bash_exec', 'file_write', 'deploy', 'payment', 'send_email']) {
      const result = evaluateAction(action);
      expect(result.blocked).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe('HIGH');
    }
  });

  it('allows medium-risk actions without approval', () => {
    for (const action of ['file_read', 'database_read', 'http_get']) {
      const result = evaluateAction(action);
      expect(result.blocked).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.riskLevel).toBe('MEDIUM');
    }
  });

  it('classifies unknown actions as LOW risk', () => {
    const result = evaluateAction('unknown_action');
    expect(result.riskLevel).toBe('LOW');
    expect(result.blocked).toBe(false);
    expect(result.requiresApproval).toBe(false);
  });
});

describe('Approval Gate Behavior', () => {
  it('approval allows run to continue', () => {
    const result = processApproval('PENDING', 'approve');
    expect(result.newState).toBe('APPROVED');
    expect(result.runShouldPause).toBe(false);
  });

  it('rejection pauses the run', () => {
    const result = processApproval('PENDING', 'reject');
    expect(result.newState).toBe('REJECTED');
    expect(result.runShouldPause).toBe(true);
  });

  it('expiration pauses the run (fail-closed)', () => {
    const result = processApproval('PENDING', 'expire');
    expect(result.newState).toBe('EXPIRED');
    expect(result.runShouldPause).toBe(true);
  });

  it('cannot approve an already-approved approval', () => {
    expect(() => processApproval('APPROVED', 'approve')).toThrow();
  });

  it('cannot reject an already-rejected approval', () => {
    expect(() => processApproval('REJECTED', 'reject')).toThrow();
  });

  it('cannot process an expired approval', () => {
    expect(() => processApproval('EXPIRED', 'approve')).toThrow();
  });
});

describe('Budget Enforcement', () => {
  interface BudgetLimits {
    maxTokens: number;
    maxCostUsd: number;
    maxIterations: number;
  }

  interface Usage {
    tokensUsed: number;
    costUsd: number;
    iterations: number;
  }

  function checkBudget(
    limits: BudgetLimits,
    usage: Usage
  ): { allowed: boolean; warning: boolean; reason?: string } {
    const WARNING_THRESHOLD = 0.8;

    if (usage.tokensUsed >= limits.maxTokens) {
      return { allowed: false, warning: false, reason: 'Token budget exceeded' };
    }
    if (usage.costUsd >= limits.maxCostUsd) {
      return { allowed: false, warning: false, reason: 'Cost budget exceeded' };
    }
    if (usage.iterations >= limits.maxIterations) {
      return { allowed: false, warning: false, reason: 'Iteration limit reached' };
    }

    const tokenRatio = usage.tokensUsed / limits.maxTokens;
    const costRatio = usage.costUsd / limits.maxCostUsd;
    const iterRatio = usage.iterations / limits.maxIterations;
    const warning = tokenRatio >= WARNING_THRESHOLD || costRatio >= WARNING_THRESHOLD || iterRatio >= WARNING_THRESHOLD;

    return { allowed: true, warning };
  }

  const limits: BudgetLimits = { maxTokens: 100000, maxCostUsd: 5.0, maxIterations: 50 };

  it('allows usage within budget', () => {
    const result = checkBudget(limits, { tokensUsed: 5000, costUsd: 0.5, iterations: 5 });
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(false);
  });

  it('warns at 80% threshold', () => {
    const result = checkBudget(limits, { tokensUsed: 85000, costUsd: 0.5, iterations: 5 });
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
  });

  it('denies when token budget exceeded', () => {
    const result = checkBudget(limits, { tokensUsed: 100000, costUsd: 0.5, iterations: 5 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Token');
  });

  it('denies when cost budget exceeded', () => {
    const result = checkBudget(limits, { tokensUsed: 5000, costUsd: 5.0, iterations: 5 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Cost');
  });

  it('denies when iteration limit reached', () => {
    const result = checkBudget(limits, { tokensUsed: 5000, costUsd: 0.5, iterations: 50 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Iteration');
  });
});
