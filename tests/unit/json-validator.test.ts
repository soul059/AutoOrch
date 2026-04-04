// JSON Validator Verification Tests
// Tests strict/lenient validation modes for routing and approval outputs

import { describe, it, expect } from 'vitest';

// Replicate the strict JSON validator logic for testing
function validateStrictJson(raw: string): { valid: boolean; parsed?: unknown; error?: string } {
  try {
    const parsed = JSON.parse(raw);
    return { valid: true, parsed };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

function repairAndParseJson(raw: string): { valid: boolean; parsed?: unknown; repaired?: boolean; error?: string } {
  // Try direct parse first
  const direct = validateStrictJson(raw);
  if (direct.valid) return { ...direct, repaired: false };

  // Attempt repair: extract JSON from markdown code blocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const inner = validateStrictJson(codeBlockMatch[1].trim());
    if (inner.valid) return { ...inner, repaired: true };
  }

  // Attempt repair: find first { and last }
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    const extracted = raw.slice(braceStart, braceEnd + 1);
    const inner = validateStrictJson(extracted);
    if (inner.valid) return { ...inner, repaired: true };
  }

  // Attempt repair: fix trailing commas
  const cleaned = raw.replace(/,\s*([}\]])/g, '$1');
  const inner2 = validateStrictJson(cleaned);
  if (inner2.valid) return { ...inner2, repaired: true };

  return { valid: false, error: 'Could not repair JSON' };
}

describe('Strict JSON Validator', () => {
  it('accepts valid JSON', () => {
    const result = validateStrictJson('{"decision": "approve", "reason": "safe"}');
    expect(result.valid).toBe(true);
    expect(result.parsed).toEqual({ decision: 'approve', reason: 'safe' });
  });

  it('accepts valid JSON arrays', () => {
    const result = validateStrictJson('[1, 2, 3]');
    expect(result.valid).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const result = validateStrictJson('{decision: approve}');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects trailing commas in strict mode', () => {
    const result = validateStrictJson('{"a": 1, "b": 2,}');
    expect(result.valid).toBe(false);
  });

  it('rejects plain text', () => {
    const result = validateStrictJson('I approve this action');
    expect(result.valid).toBe(false);
  });

  it('rejects empty string', () => {
    const result = validateStrictJson('');
    expect(result.valid).toBe(false);
  });
});

describe('Lenient JSON Repair', () => {
  it('passes valid JSON through without repair', () => {
    const result = repairAndParseJson('{"ok": true}');
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(false);
  });

  it('extracts JSON from markdown code blocks', () => {
    const raw = 'Here is the result:\n```json\n{"action": "deploy"}\n```\nDone.';
    const result = repairAndParseJson(raw);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.parsed).toEqual({ action: 'deploy' });
  });

  it('extracts JSON from surrounding text via brace matching', () => {
    const raw = 'The answer is {"status": "ok", "count": 5} and that is all.';
    const result = repairAndParseJson(raw);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it('fixes trailing commas', () => {
    const raw = '{"a": 1, "b": 2,}';
    const result = repairAndParseJson(raw);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it('fails on completely unparseable content', () => {
    const raw = 'This is just plain english text with no JSON at all.';
    const result = repairAndParseJson(raw);
    expect(result.valid).toBe(false);
  });
});
