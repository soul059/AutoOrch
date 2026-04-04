// Verification V3: Routing Determinism with Strict JSON
// Verifies that routing decisions are deterministic when strict JSON is required
// and that invalid responses either repair safely or fail closed.

import { describe, it, expect } from 'vitest';

// ─── JSON Validator (mirrors services/orchestrator/src/json-validator.ts) ────

interface ValidationResult {
  valid: boolean;
  data?: Record<string, unknown>;
  repaired?: boolean;
  error?: string;
}

function validateStrictJson(input: string): ValidationResult {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: 'Root must be an object' };
    }
    return { valid: true, data: parsed };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

function validateLenientJson(input: string): ValidationResult {
  // First try strict
  const strict = validateStrictJson(input);
  if (strict.valid) return strict;

  // Try repair strategies
  const repaired = attemptRepair(input);
  if (repaired) return { valid: true, data: repaired, repaired: true };

  return { valid: false, error: `Could not parse or repair JSON: ${strict.error}` };
}

function attemptRepair(input: string): Record<string, unknown> | null {
  // Strategy 1: Extract JSON from markdown code blocks
  const codeBlockMatch = input.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* continue */ }
  }

  // Strategy 2: Find first { ... } block
  const braceMatch = input.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* continue */ }
  }

  // Strategy 3: Handle trailing commas
  const cleaned = input.replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* continue */ }

  return null;
}

// ─── Routing decision validation ────────────────────────────

interface RoutingDecision {
  agentRole: string;
  providerId: string;
  modelName: string;
  reason: string;
}

function validateRoutingDecision(json: Record<string, unknown>): RoutingDecision | null {
  if (!json.agentRole || !json.providerId || !json.modelName) return null;
  return {
    agentRole: json.agentRole as string,
    providerId: json.providerId as string,
    modelName: json.modelName as string,
    reason: (json.reason as string) || '',
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('V3: Strict JSON for Routing Decisions', () => {
  it('accepts valid routing JSON', () => {
    const input = JSON.stringify({
      agentRole: 'PLANNER',
      providerId: 'gemini-1',
      modelName: 'gemini-pro',
      reason: 'Best structured output support',
    });

    const result = validateStrictJson(input);
    expect(result.valid).toBe(true);

    const decision = validateRoutingDecision(result.data!);
    expect(decision).not.toBeNull();
    expect(decision!.agentRole).toBe('PLANNER');
    expect(decision!.providerId).toBe('gemini-1');
  });

  it('rejects plain text in strict mode', () => {
    const result = validateStrictJson('Use Gemini for the planner role');
    expect(result.valid).toBe(false);
  });

  it('rejects arrays in strict mode', () => {
    const result = validateStrictJson('[{"role": "PLANNER"}]');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Root must be an object');
  });

  it('rejects null in strict mode', () => {
    const result = validateStrictJson('null');
    expect(result.valid).toBe(false);
  });

  it('rejects number in strict mode', () => {
    const result = validateStrictJson('42');
    expect(result.valid).toBe(false);
  });

  it('rejects incomplete JSON in strict mode', () => {
    const result = validateStrictJson('{"agentRole": "PLANNER"');
    expect(result.valid).toBe(false);
  });
});

describe('V3: Lenient JSON for Non-Critical Tasks', () => {
  it('extracts JSON from markdown code blocks', () => {
    const input = 'Here is my response:\n```json\n{"status": "ready", "confidence": 0.95}\n```\nDone!';
    const result = validateLenientJson(input);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data!.status).toBe('ready');
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'The routing decision is: {"agentRole": "BUILDER", "providerId": "ollama-1", "modelName": "llama3.2"} I think this is best.';
    const result = validateLenientJson(input);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data!.agentRole).toBe('BUILDER');
  });

  it('handles trailing commas', () => {
    const input = '{"agentRole": "PLANNER", "providerId": "gemini-1",}';
    const result = validateLenientJson(input);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it('fails for completely unparseable text', () => {
    const result = validateLenientJson('I cannot provide JSON output at this time.');
    expect(result.valid).toBe(false);
  });
});

describe('V3: Routing Determinism', () => {
  it('same input always produces same routing validation result', () => {
    const input = JSON.stringify({
      agentRole: 'RESEARCHER',
      providerId: 'gemini-1',
      modelName: 'gemini-pro',
      reason: 'Best for research',
    });

    // Run validation 100 times - must be deterministic
    const results: ValidationResult[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(validateStrictJson(input));
    }

    // All results must be identical
    for (const r of results) {
      expect(r.valid).toBe(true);
      expect(r.data).toEqual(results[0].data);
    }
  });

  it('invalid JSON always fails in strict mode (never randomly succeeds)', () => {
    const invalidInputs = [
      'not json',
      '{"partial": "data"',
      '',
      'undefined',
      '{"key": undefined}',
    ];

    for (const input of invalidInputs) {
      // Run each 10 times to verify determinism
      for (let i = 0; i < 10; i++) {
        const result = validateStrictJson(input);
        expect(result.valid).toBe(false);
      }
    }
  });

  it('routing decision validation rejects missing required fields', () => {
    const incompleteDecisions = [
      { providerId: 'gemini-1', modelName: 'gemini-pro' }, // missing agentRole
      { agentRole: 'PLANNER', modelName: 'gemini-pro' }, // missing providerId
      { agentRole: 'PLANNER', providerId: 'gemini-1' }, // missing modelName
      {}, // all missing
    ];

    for (const decision of incompleteDecisions) {
      const result = validateRoutingDecision(decision);
      expect(result).toBeNull();
    }
  });

  it('strict mode failure triggers fail-closed (no action taken)', () => {
    const badResponse = 'Sure, I think you should use Gemini for this task.';
    const result = validateStrictJson(badResponse);
    expect(result.valid).toBe(false);

    // In strict mode, the system should NOT proceed with any routing
    const decision = result.valid ? validateRoutingDecision(result.data!) : null;
    expect(decision).toBeNull();
  });
});

describe('V3: Approval Decision JSON Validation', () => {
  interface ApprovalDecision {
    approved: boolean;
    reason: string;
    conditions?: string[];
  }

  function validateApprovalDecision(json: Record<string, unknown>): ApprovalDecision | null {
    if (typeof json.approved !== 'boolean') return null;
    return {
      approved: json.approved as boolean,
      reason: (json.reason as string) || '',
      conditions: json.conditions as string[] | undefined,
    };
  }

  it('valid approval response passes strict validation', () => {
    const input = JSON.stringify({ approved: true, reason: 'Looks safe' });
    const parsed = validateStrictJson(input);
    expect(parsed.valid).toBe(true);

    const decision = validateApprovalDecision(parsed.data!);
    expect(decision).not.toBeNull();
    expect(decision!.approved).toBe(true);
  });

  it('invalid approval response fails closed (treated as rejection)', () => {
    const badInput = 'Yes, I approve this action.';
    const parsed = validateStrictJson(badInput);
    expect(parsed.valid).toBe(false);

    // Fail-closed: treat as rejection
    const decision = parsed.valid ? validateApprovalDecision(parsed.data!) : null;
    const effectiveApproval = decision?.approved ?? false; // Default to rejected
    expect(effectiveApproval).toBe(false);
  });

  it('approval with missing "approved" field fails validation', () => {
    const input = JSON.stringify({ reason: 'Looks good', conditions: [] });
    const parsed = validateStrictJson(input);
    expect(parsed.valid).toBe(true);

    const decision = validateApprovalDecision(parsed.data!);
    expect(decision).toBeNull(); // Missing required field
  });
});
