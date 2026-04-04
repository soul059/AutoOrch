// Verification V6: Budget Enforcement
// Verifies budget enforcement at run level and role level,
// including mixed local/cloud usage reporting.

import { describe, it, expect } from 'vitest';

// ─── Budget types ───────────────────────────────────────────

interface BudgetLimit {
  maxTokens: number;
  maxCostUsd: number;
  maxLoopIterations: number;
}

interface RoleBudgetPolicy {
  maxTokensPerTask: number;
  maxCostPerTask: number;
  maxRetries: number;
}

interface TaskUsage {
  taskId: string;
  agentRole: string;
  providerId: string;
  providerType: 'OLLAMA' | 'GEMINI' | 'OPENAI_COMPATIBLE';
  tokens: number;
  costUsd: number;
}

interface BudgetStatus {
  allowed: boolean;
  warning: boolean;
  reason?: string;
  tokenPercent: number;
  costPercent: number;
  iterationPercent: number;
}

// ─── Budget enforcement logic ───────────────────────────────

const WARNING_THRESHOLD = 0.8;

function checkRunBudget(limit: BudgetLimit, tasks: TaskUsage[]): BudgetStatus {
  const totalTokens = tasks.reduce((sum, t) => sum + t.tokens, 0);
  const totalCost = tasks.reduce((sum, t) => sum + t.costUsd, 0);
  const iterations = tasks.length;

  const tokenPercent = totalTokens / limit.maxTokens;
  const costPercent = totalCost / limit.maxCostUsd;
  const iterationPercent = iterations / limit.maxLoopIterations;

  if (totalTokens >= limit.maxTokens) {
    return { allowed: false, warning: false, reason: `Token budget exceeded: ${totalTokens}/${limit.maxTokens}`, tokenPercent, costPercent, iterationPercent };
  }
  if (totalCost >= limit.maxCostUsd) {
    return { allowed: false, warning: false, reason: `Cost budget exceeded: $${totalCost.toFixed(4)}/$${limit.maxCostUsd}`, tokenPercent, costPercent, iterationPercent };
  }
  if (iterations >= limit.maxLoopIterations) {
    return { allowed: false, warning: false, reason: `Iteration limit reached: ${iterations}/${limit.maxLoopIterations}`, tokenPercent, costPercent, iterationPercent };
  }

  const warning = tokenPercent >= WARNING_THRESHOLD || costPercent >= WARNING_THRESHOLD || iterationPercent >= WARNING_THRESHOLD;

  return { allowed: true, warning, tokenPercent, costPercent, iterationPercent };
}

function checkRoleBudget(policy: RoleBudgetPolicy, taskUsage: TaskUsage): { allowed: boolean; reason?: string } {
  if (taskUsage.tokens > policy.maxTokensPerTask) {
    return { allowed: false, reason: `Role token limit exceeded: ${taskUsage.tokens}/${policy.maxTokensPerTask}` };
  }
  if (taskUsage.costUsd > policy.maxCostPerTask) {
    return { allowed: false, reason: `Role cost limit exceeded: $${taskUsage.costUsd}/$${policy.maxCostPerTask}` };
  }
  return { allowed: true };
}

// ─── Cost calculation helpers ───────────────────────────────

function calculateCost(providerType: string, tokens: number): number {
  switch (providerType) {
    case 'OLLAMA': return 0; // Always free
    case 'GEMINI': return tokens * 0.00001;
    case 'OPENAI_COMPATIBLE': return tokens * 0.00003;
    default: return 0;
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('V6: Run-Level Budget Enforcement', () => {
  const limit: BudgetLimit = { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 };

  it('allows usage well within budget', () => {
    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'OLLAMA', tokens: 1000, costUsd: 0 },
      { taskId: 't2', agentRole: 'BUILDER', providerId: 'p2', providerType: 'GEMINI', tokens: 2000, costUsd: 0.02 },
    ];

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(true);
    expect(status.warning).toBe(false);
  });

  it('warns at 80% token usage', () => {
    const tasks: TaskUsage[] = Array.from({ length: 10 }, (_, i) => ({
      taskId: `t${i}`, agentRole: 'BUILDER', providerId: 'p1', providerType: 'OLLAMA' as const,
      tokens: 8500, costUsd: 0,
    }));

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(true);
    expect(status.warning).toBe(true);
    expect(status.tokenPercent).toBeGreaterThanOrEqual(0.8);
  });

  it('warns at 80% cost usage', () => {
    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'GEMINI', tokens: 5000, costUsd: 8.5 },
    ];

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(true);
    expect(status.warning).toBe(true);
    expect(status.costPercent).toBeGreaterThanOrEqual(0.8);
  });

  it('warns at 80% iteration usage', () => {
    const tasks: TaskUsage[] = Array.from({ length: 42 }, (_, i) => ({
      taskId: `t${i}`, agentRole: 'BUILDER', providerId: 'p1', providerType: 'OLLAMA' as const,
      tokens: 100, costUsd: 0,
    }));

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(true);
    expect(status.warning).toBe(true);
    expect(status.iterationPercent).toBeGreaterThanOrEqual(0.8);
  });

  it('denies when token budget exceeded', () => {
    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'OLLAMA', tokens: 100000, costUsd: 0 },
    ];

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain('Token');
  });

  it('denies when cost budget exceeded', () => {
    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'GEMINI', tokens: 5000, costUsd: 10.0 },
    ];

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain('Cost');
  });

  it('denies when iteration limit reached', () => {
    const tasks: TaskUsage[] = Array.from({ length: 50 }, (_, i) => ({
      taskId: `t${i}`, agentRole: 'BUILDER', providerId: 'p1', providerType: 'OLLAMA' as const,
      tokens: 100, costUsd: 0,
    }));

    const status = checkRunBudget(limit, tasks);
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain('Iteration');
  });
});

describe('V6: Role-Level Budget Enforcement', () => {
  const plannerPolicy: RoleBudgetPolicy = { maxTokensPerTask: 10000, maxCostPerTask: 1.0, maxRetries: 2 };
  const builderPolicy: RoleBudgetPolicy = { maxTokensPerTask: 50000, maxCostPerTask: 5.0, maxRetries: 3 };

  it('allows task within role token limit', () => {
    const task: TaskUsage = { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'GEMINI', tokens: 5000, costUsd: 0.05 };
    expect(checkRoleBudget(plannerPolicy, task).allowed).toBe(true);
  });

  it('denies task exceeding role token limit', () => {
    const task: TaskUsage = { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'GEMINI', tokens: 15000, costUsd: 0.15 };
    const result = checkRoleBudget(plannerPolicy, task);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Role token limit');
  });

  it('denies task exceeding role cost limit', () => {
    const task: TaskUsage = { taskId: 't1', agentRole: 'PLANNER', providerId: 'p1', providerType: 'OPENAI_COMPATIBLE', tokens: 5000, costUsd: 1.5 };
    const result = checkRoleBudget(plannerPolicy, task);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Role cost limit');
  });

  it('different roles have different budget limits', () => {
    const expensiveTask: TaskUsage = { taskId: 't1', agentRole: 'BUILDER', providerId: 'p1', providerType: 'OPENAI_COMPATIBLE', tokens: 30000, costUsd: 3.0 };

    // Exceeds PLANNER limits
    expect(checkRoleBudget(plannerPolicy, expensiveTask).allowed).toBe(false);

    // Within BUILDER limits
    expect(checkRoleBudget(builderPolicy, expensiveTask).allowed).toBe(true);
  });
});

describe('V6: Mixed Local/Cloud Usage Reporting', () => {
  it('correctly reports zero cost for Ollama tasks', () => {
    const cost = calculateCost('OLLAMA', 10000);
    expect(cost).toBe(0);
  });

  it('correctly calculates Gemini cost', () => {
    const cost = calculateCost('GEMINI', 10000);
    expect(cost).toBeCloseTo(0.1, 5);
  });

  it('correctly calculates OpenAI cost', () => {
    const cost = calculateCost('OPENAI_COMPATIBLE', 10000);
    expect(cost).toBeCloseTo(0.3, 5);
  });

  it('mixed run accumulates only cloud costs', () => {
    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'ollama', providerType: 'OLLAMA', tokens: 5000, costUsd: calculateCost('OLLAMA', 5000) },
      { taskId: 't2', agentRole: 'RESEARCHER', providerId: 'gemini', providerType: 'GEMINI', tokens: 3000, costUsd: calculateCost('GEMINI', 3000) },
      { taskId: 't3', agentRole: 'BUILDER', providerId: 'ollama', providerType: 'OLLAMA', tokens: 8000, costUsd: calculateCost('OLLAMA', 8000) },
      { taskId: 't4', agentRole: 'REVIEWER', providerId: 'openai', providerType: 'OPENAI_COMPATIBLE', tokens: 2000, costUsd: calculateCost('OPENAI_COMPATIBLE', 2000) },
    ];

    const totalTokens = tasks.reduce((sum, t) => sum + t.tokens, 0);
    const totalCost = tasks.reduce((sum, t) => sum + t.costUsd, 0);
    const ollamaTokens = tasks.filter(t => t.providerType === 'OLLAMA').reduce((sum, t) => sum + t.tokens, 0);
    const ollamaCost = tasks.filter(t => t.providerType === 'OLLAMA').reduce((sum, t) => sum + t.costUsd, 0);
    const cloudCost = tasks.filter(t => t.providerType !== 'OLLAMA').reduce((sum, t) => sum + t.costUsd, 0);

    expect(totalTokens).toBe(18000);
    expect(ollamaTokens).toBe(13000);
    expect(ollamaCost).toBe(0);
    expect(cloudCost).toBeGreaterThan(0);
    expect(totalCost).toBeCloseTo(cloudCost, 10);
  });

  it('budget reporting breaks down by provider type', () => {
    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'ollama', providerType: 'OLLAMA', tokens: 5000, costUsd: 0 },
      { taskId: 't2', agentRole: 'BUILDER', providerId: 'gemini', providerType: 'GEMINI', tokens: 3000, costUsd: 0.03 },
      { taskId: 't3', agentRole: 'REVIEWER', providerId: 'openai', providerType: 'OPENAI_COMPATIBLE', tokens: 2000, costUsd: 0.06 },
    ];

    const byType = tasks.reduce((acc, t) => {
      if (!acc[t.providerType]) acc[t.providerType] = { tokens: 0, cost: 0, tasks: 0 };
      acc[t.providerType].tokens += t.tokens;
      acc[t.providerType].cost += t.costUsd;
      acc[t.providerType].tasks += 1;
      return acc;
    }, {} as Record<string, { tokens: number; cost: number; tasks: number }>);

    expect(byType.OLLAMA.tokens).toBe(5000);
    expect(byType.OLLAMA.cost).toBe(0);
    expect(byType.GEMINI.tokens).toBe(3000);
    expect(byType.GEMINI.cost).toBeCloseTo(0.03, 5);
    expect(byType.OPENAI_COMPATIBLE.tokens).toBe(2000);
    expect(byType.OPENAI_COMPATIBLE.cost).toBeCloseTo(0.06, 5);
  });

  it('budget check considers total across all provider types', () => {
    const limit: BudgetLimit = { maxTokens: 10000, maxCostUsd: 0.1, maxLoopIterations: 50 };

    const tasks: TaskUsage[] = [
      { taskId: 't1', agentRole: 'PLANNER', providerId: 'ollama', providerType: 'OLLAMA', tokens: 4000, costUsd: 0 },
      { taskId: 't2', agentRole: 'BUILDER', providerId: 'gemini', providerType: 'GEMINI', tokens: 4000, costUsd: 0.04 },
      { taskId: 't3', agentRole: 'REVIEWER', providerId: 'ollama', providerType: 'OLLAMA', tokens: 3000, costUsd: 0 },
    ];

    const status = checkRunBudget(limit, tasks);
    // 4000 + 4000 + 3000 = 11000 > 10000
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain('Token');
  });
});
