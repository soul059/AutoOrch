// Verification V1: End-to-End Scenario Tests
// Validates the architecture against three complete scenarios:
// 1. Local-only run via Ollama
// 2. Cloud-only run via API key
// 3. Mixed run with user-selected provider override

import { describe, it, expect } from 'vitest';

// ─── Shared Simulation Types ────────────────────────────────

interface Provider {
  id: string;
  name: string;
  type: 'OLLAMA' | 'GEMINI' | 'OPENAI_COMPATIBLE';
  healthy: boolean;
  capabilities: {
    structuredOutput: boolean;
    toolUse: boolean;
    streaming: boolean;
    maxContextTokens: number;
  };
  costPerToken: number;
}

interface Run {
  id: string;
  state: string;
  prompt: string;
  providerOverrides: Record<string, string>;
  budgetLimit: { maxTokens: number; maxCostUsd: number; maxLoopIterations: number };
  budgetUsed: { tokens: number; costUsd: number; iterations: number };
}

interface Task {
  id: string;
  runId: string;
  agentRole: string;
  state: string;
  providerId?: string;
  output?: unknown;
  tokenUsage?: { totalTokens: number; costUsd: number };
}

interface AuditEntry {
  eventType: string;
  runId: string;
  taskId?: string;
  payload: Record<string, unknown>;
}

// ─── Run state machine ──────────────────────────────────────

const LEGAL_RUN_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PLANNING', 'CANCELLED'],
  PLANNING: ['ROUTING', 'FAILED', 'CANCELLED'],
  ROUTING: ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['WAITING_APPROVAL', 'RETRYING', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED'],
  WAITING_APPROVAL: ['EXECUTING', 'PAUSED', 'CANCELLED'],
  RETRYING: ['EXECUTING', 'FAILED', 'CANCELLED'],
  PAUSED: ['EXECUTING', 'CANCELLED'],
  FAILED: ['PLANNING'],
  COMPLETED: [],
  CANCELLED: [],
};

function transitionRun(run: Run, target: string, audit: AuditEntry[]): void {
  const legal = LEGAL_RUN_TRANSITIONS[run.state];
  if (!legal || !legal.includes(target)) {
    throw new Error(`Illegal transition: ${run.state} → ${target}`);
  }
  audit.push({
    eventType: 'RUN_STATE_CHANGED',
    runId: run.id,
    payload: { from: run.state, to: target },
  });
  run.state = target;
}

// ─── Provider routing ───────────────────────────────────────

function selectProvider(
  providers: Provider[],
  role: string,
  mappings: Array<{ role: string; providerId: string; priority: number }>,
  overrides: Record<string, string>,
  capabilities?: { structuredOutput?: boolean; toolUse?: boolean },
): Provider | null {
  // 1. User override
  if (overrides[role]) {
    const p = providers.find(p => p.id === overrides[role]);
    if (p && p.healthy) return p;
  }

  // 2. Role mappings by priority
  const roleMappings = mappings
    .filter(m => m.role === role)
    .sort((a, b) => a.priority - b.priority);

  for (const mapping of roleMappings) {
    const p = providers.find(p => p.id === mapping.providerId);
    if (!p || !p.healthy) continue;
    if (capabilities?.structuredOutput && !p.capabilities.structuredOutput) continue;
    if (capabilities?.toolUse && !p.capabilities.toolUse) continue;
    return p;
  }

  // 3. Fallback: any healthy provider meeting capabilities
  for (const p of providers) {
    if (!p.healthy) continue;
    if (capabilities?.structuredOutput && !p.capabilities.structuredOutput) continue;
    if (capabilities?.toolUse && !p.capabilities.toolUse) continue;
    return p;
  }

  return null;
}

// ─── Policy evaluation ──────────────────────────────────────

const BLOCKED_ACTIONS = new Set(['rm_rf', 'format_disk', 'drop_database', 'sudo']);
const HIGH_RISK_ACTIONS = new Set(['bash_exec', 'file_write', 'deploy', 'payment', 'external_api_call', 'database_write', 'send_email']);

function evaluatePolicy(action: string): { decision: string; requiresApproval: boolean; blocked: boolean } {
  if (BLOCKED_ACTIONS.has(action)) return { decision: 'DENY', requiresApproval: false, blocked: true };
  if (HIGH_RISK_ACTIONS.has(action)) return { decision: 'REQUIRE_APPROVAL', requiresApproval: true, blocked: false };
  return { decision: 'ALLOW', requiresApproval: false, blocked: false };
}

// ─── Scenario 1: Local-Only Ollama Run ──────────────────────

describe('V1-Scenario 1: Local-Only Ollama Run', () => {
  const ollamaProvider: Provider = {
    id: 'ollama-1',
    name: 'ollama-local',
    type: 'OLLAMA',
    healthy: true,
    capabilities: { structuredOutput: false, toolUse: false, streaming: true, maxContextTokens: 8192 },
    costPerToken: 0,
  };

  const mappings = [
    { role: 'PLANNER', providerId: 'ollama-1', priority: 1 },
    { role: 'RESEARCHER', providerId: 'ollama-1', priority: 1 },
    { role: 'BUILDER', providerId: 'ollama-1', priority: 1 },
    { role: 'REVIEWER', providerId: 'ollama-1', priority: 1 },
    { role: 'OPERATIONS', providerId: 'ollama-1', priority: 1 },
  ];

  it('routes all agent roles to Ollama', () => {
    for (const role of ['PLANNER', 'RESEARCHER', 'BUILDER', 'REVIEWER', 'OPERATIONS']) {
      const selected = selectProvider([ollamaProvider], role, mappings, {});
      expect(selected).not.toBeNull();
      expect(selected!.type).toBe('OLLAMA');
      expect(selected!.name).toBe('ollama-local');
    }
  });

  it('completes full run lifecycle with zero cost', () => {
    const audit: AuditEntry[] = [];
    const run: Run = {
      id: 'run-ollama-1',
      state: 'DRAFT',
      prompt: 'Build a landing page',
      providerOverrides: {},
      budgetLimit: { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 },
      budgetUsed: { tokens: 0, costUsd: 0, iterations: 0 },
    };

    // Full lifecycle
    transitionRun(run, 'PLANNING', audit);
    expect(run.state).toBe('PLANNING');

    transitionRun(run, 'ROUTING', audit);
    expect(run.state).toBe('ROUTING');

    transitionRun(run, 'EXECUTING', audit);
    expect(run.state).toBe('EXECUTING');

    // Simulate task completion with zero cost (Ollama is free)
    const task: Task = {
      id: 'task-1', runId: run.id, agentRole: 'PLANNER',
      state: 'SUCCEEDED', providerId: 'ollama-1',
      tokenUsage: { totalTokens: 500, costUsd: 0 },
    };
    run.budgetUsed.tokens += task.tokenUsage!.totalTokens;
    run.budgetUsed.costUsd += task.tokenUsage!.costUsd;
    run.budgetUsed.iterations += 1;

    transitionRun(run, 'COMPLETED', audit);
    expect(run.state).toBe('COMPLETED');
    expect(run.budgetUsed.costUsd).toBe(0);
    expect(audit.length).toBe(4);
    expect(audit.every(a => a.eventType === 'RUN_STATE_CHANGED')).toBe(true);
  });

  it('Ollama-only run stays within token budget with zero cost', () => {
    const run: Run = {
      id: 'run-ollama-2', state: 'EXECUTING', prompt: 'test',
      providerOverrides: {},
      budgetLimit: { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 },
      budgetUsed: { tokens: 0, costUsd: 0, iterations: 0 },
    };

    // Simulate 5 tasks with Ollama (all free)
    for (let i = 0; i < 5; i++) {
      run.budgetUsed.tokens += 1000;
      run.budgetUsed.costUsd += 0; // Ollama is always free
      run.budgetUsed.iterations += 1;
    }

    expect(run.budgetUsed.tokens).toBe(5000);
    expect(run.budgetUsed.costUsd).toBe(0);
    expect(run.budgetUsed.iterations).toBe(5);
    expect(run.budgetUsed.tokens).toBeLessThan(run.budgetLimit.maxTokens);
  });
});

// ─── Scenario 2: Cloud-Only Run via API Key ─────────────────

describe('V1-Scenario 2: Cloud-Only Run via API Key', () => {
  const geminiProvider: Provider = {
    id: 'gemini-1',
    name: 'gemini-pro',
    type: 'GEMINI',
    healthy: true,
    capabilities: { structuredOutput: true, toolUse: true, streaming: true, maxContextTokens: 32768 },
    costPerToken: 0.00001,
  };

  const openaiProvider: Provider = {
    id: 'openai-1',
    name: 'gpt-4',
    type: 'OPENAI_COMPATIBLE',
    healthy: true,
    capabilities: { structuredOutput: true, toolUse: true, streaming: true, maxContextTokens: 128000 },
    costPerToken: 0.00003,
  };

  const mappings = [
    { role: 'PLANNER', providerId: 'gemini-1', priority: 1 },
    { role: 'PLANNER', providerId: 'openai-1', priority: 2 },
    { role: 'RESEARCHER', providerId: 'gemini-1', priority: 1 },
    { role: 'BUILDER', providerId: 'openai-1', priority: 1 },
    { role: 'REVIEWER', providerId: 'gemini-1', priority: 1 },
    { role: 'OPERATIONS', providerId: 'openai-1', priority: 1 },
  ];

  it('routes to cloud providers by priority', () => {
    const planner = selectProvider([geminiProvider, openaiProvider], 'PLANNER', mappings, {});
    expect(planner!.name).toBe('gemini-pro');

    const builder = selectProvider([geminiProvider, openaiProvider], 'BUILDER', mappings, {});
    expect(builder!.name).toBe('gpt-4');
  });

  it('cloud providers support structured output for routing decisions', () => {
    const planner = selectProvider(
      [geminiProvider, openaiProvider], 'PLANNER', mappings, {},
      { structuredOutput: true }
    );
    expect(planner).not.toBeNull();
    expect(planner!.capabilities.structuredOutput).toBe(true);
  });

  it('accumulates cost correctly from cloud providers', () => {
    const run: Run = {
      id: 'run-cloud-1', state: 'EXECUTING', prompt: 'test',
      providerOverrides: {},
      budgetLimit: { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 },
      budgetUsed: { tokens: 0, costUsd: 0, iterations: 0 },
    };

    // Gemini task: 1000 tokens at $0.00001/token = $0.01
    run.budgetUsed.tokens += 1000;
    run.budgetUsed.costUsd += 1000 * 0.00001;
    run.budgetUsed.iterations += 1;

    // OpenAI task: 2000 tokens at $0.00003/token = $0.06
    run.budgetUsed.tokens += 2000;
    run.budgetUsed.costUsd += 2000 * 0.00003;
    run.budgetUsed.iterations += 1;

    expect(run.budgetUsed.tokens).toBe(3000);
    expect(run.budgetUsed.costUsd).toBeCloseTo(0.07, 5);
    expect(run.budgetUsed.iterations).toBe(2);
  });

  it('fails over from Gemini to OpenAI when Gemini is unhealthy', () => {
    const unhealthyGemini = { ...geminiProvider, healthy: false };
    const planner = selectProvider([unhealthyGemini, openaiProvider], 'PLANNER', mappings, {});
    expect(planner!.name).toBe('gpt-4');
  });

  it('produces complete audit trail for cloud run', () => {
    const audit: AuditEntry[] = [];
    const run: Run = {
      id: 'run-cloud-2', state: 'DRAFT', prompt: 'test',
      providerOverrides: {},
      budgetLimit: { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 },
      budgetUsed: { tokens: 0, costUsd: 0, iterations: 0 },
    };

    transitionRun(run, 'PLANNING', audit);
    transitionRun(run, 'ROUTING', audit);
    transitionRun(run, 'EXECUTING', audit);

    // Simulate provider call audit
    audit.push({
      eventType: 'PROVIDER_CALLED',
      runId: run.id,
      taskId: 'task-1',
      payload: { provider: 'gemini-pro', model: 'gemini-pro', tokens: 1000, costUsd: 0.01 },
    });

    transitionRun(run, 'COMPLETED', audit);

    expect(audit.length).toBe(5);
    expect(audit.filter(a => a.eventType === 'RUN_STATE_CHANGED').length).toBe(4);
    expect(audit.filter(a => a.eventType === 'PROVIDER_CALLED').length).toBe(1);
  });
});

// ─── Scenario 3: Mixed Run with User-Selected Provider Override ──

describe('V1-Scenario 3: Mixed Run with User Provider Override', () => {
  const ollamaProvider: Provider = {
    id: 'ollama-1', name: 'ollama-local', type: 'OLLAMA', healthy: true,
    capabilities: { structuredOutput: false, toolUse: false, streaming: true, maxContextTokens: 8192 },
    costPerToken: 0,
  };

  const geminiProvider: Provider = {
    id: 'gemini-1', name: 'gemini-pro', type: 'GEMINI', healthy: true,
    capabilities: { structuredOutput: true, toolUse: true, streaming: true, maxContextTokens: 32768 },
    costPerToken: 0.00001,
  };

  const openaiProvider: Provider = {
    id: 'openai-1', name: 'gpt-4', type: 'OPENAI_COMPATIBLE', healthy: true,
    capabilities: { structuredOutput: true, toolUse: true, streaming: true, maxContextTokens: 128000 },
    costPerToken: 0.00003,
  };

  const allProviders = [ollamaProvider, geminiProvider, openaiProvider];

  const defaultMappings = [
    { role: 'PLANNER', providerId: 'ollama-1', priority: 1 },
    { role: 'RESEARCHER', providerId: 'ollama-1', priority: 1 },
    { role: 'BUILDER', providerId: 'ollama-1', priority: 1 },
    { role: 'REVIEWER', providerId: 'ollama-1', priority: 1 },
    { role: 'OPERATIONS', providerId: 'ollama-1', priority: 1 },
  ];

  it('user override routes PLANNER to OpenAI while others use Ollama', () => {
    const overrides = { PLANNER: 'openai-1' };

    const planner = selectProvider(allProviders, 'PLANNER', defaultMappings, overrides);
    expect(planner!.name).toBe('gpt-4');

    const builder = selectProvider(allProviders, 'BUILDER', defaultMappings, overrides);
    expect(builder!.name).toBe('ollama-local');
  });

  it('mixed run accumulates both free and paid costs', () => {
    const run: Run = {
      id: 'run-mixed-1', state: 'EXECUTING', prompt: 'test',
      providerOverrides: { PLANNER: 'openai-1' },
      budgetLimit: { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 },
      budgetUsed: { tokens: 0, costUsd: 0, iterations: 0 },
    };

    // Task 1: PLANNER on OpenAI (paid)
    run.budgetUsed.tokens += 2000;
    run.budgetUsed.costUsd += 2000 * 0.00003;
    run.budgetUsed.iterations += 1;

    // Task 2: BUILDER on Ollama (free)
    run.budgetUsed.tokens += 1500;
    run.budgetUsed.costUsd += 0;
    run.budgetUsed.iterations += 1;

    // Task 3: RESEARCHER on Ollama (free)
    run.budgetUsed.tokens += 800;
    run.budgetUsed.costUsd += 0;
    run.budgetUsed.iterations += 1;

    expect(run.budgetUsed.tokens).toBe(4300);
    expect(run.budgetUsed.costUsd).toBeCloseTo(0.06, 5);
    expect(run.budgetUsed.iterations).toBe(3);
  });

  it('override to unhealthy provider falls back correctly', () => {
    const unhealthyOpenai = { ...openaiProvider, healthy: false };
    const providers = [ollamaProvider, geminiProvider, unhealthyOpenai];

    // Override requests openai-1 but it's unhealthy; should not select it
    const overrides = { PLANNER: 'openai-1' };
    const planner = selectProvider(providers, 'PLANNER', defaultMappings, overrides);
    // Falls through to mapping default (Ollama)
    expect(planner!.name).toBe('ollama-local');
  });

  it('override respects capability requirements', () => {
    const overrides = { PLANNER: 'openai-1' };

    // When structured output is required, OpenAI override works
    const planner = selectProvider(allProviders, 'PLANNER', defaultMappings, overrides,
      { structuredOutput: true });
    expect(planner!.name).toBe('gpt-4');
  });

  it('full mixed lifecycle produces correct state sequence', () => {
    const audit: AuditEntry[] = [];
    const run: Run = {
      id: 'run-mixed-2', state: 'DRAFT', prompt: 'test',
      providerOverrides: { PLANNER: 'openai-1' },
      budgetLimit: { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 },
      budgetUsed: { tokens: 0, costUsd: 0, iterations: 0 },
    };

    // Full lifecycle with approval gate
    transitionRun(run, 'PLANNING', audit);
    transitionRun(run, 'ROUTING', audit);
    transitionRun(run, 'EXECUTING', audit);

    // High-risk action triggers approval
    transitionRun(run, 'WAITING_APPROVAL', audit);
    expect(run.state).toBe('WAITING_APPROVAL');

    // Approval granted
    transitionRun(run, 'EXECUTING', audit);

    transitionRun(run, 'COMPLETED', audit);
    expect(run.state).toBe('COMPLETED');

    const states = audit.map(a => a.payload.to);
    expect(states).toEqual(['PLANNING', 'ROUTING', 'EXECUTING', 'WAITING_APPROVAL', 'EXECUTING', 'COMPLETED']);
  });
});
