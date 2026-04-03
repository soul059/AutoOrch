// Strict JSON output validator for routing and approval decisions

export interface ValidationResult {
  valid: boolean;
  parsed?: Record<string, unknown>;
  error?: string;
  repaired?: boolean;
}

// Validate that a provider response contains valid JSON matching the expected schema
export function validateStrictJson(
  content: string,
  requiredFields: string[],
  allowRepair: boolean = false
): ValidationResult {
  // 1. Try direct JSON parse
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(content);
    const missingFields = requiredFields.filter(f => !(f in parsed!));
    if (missingFields.length === 0) {
      return { valid: true, parsed };
    }
    // JSON is valid but missing fields
    if (!allowRepair) {
      return { valid: false, error: `Missing required fields: ${missingFields.join(', ')}`, parsed };
    }
    // For repair mode with valid JSON that has missing fields, return as-is with error
    return { valid: false, error: `Missing required fields: ${missingFields.join(', ')}`, parsed };
  } catch {
    // 2. Try to extract JSON from markdown code blocks (only if initial parse failed)
    if (allowRepair) {
      const repaired = tryRepairJson(content);
      if (repaired) {
        const missingFields = requiredFields.filter(f => !(f in repaired));
        if (missingFields.length === 0) {
          return { valid: true, parsed: repaired, repaired: true };
        }
        return { valid: false, error: `Repaired JSON still missing fields: ${missingFields.join(', ')}`, parsed: repaired, repaired: true };
      }
    }
    return { valid: false, error: `Invalid JSON: ${content.slice(0, 100)}...` };
  }
}

// Attempt to repair common JSON issues from model outputs
function tryRepairJson(content: string): Record<string, unknown> | null {
  // Try extracting from markdown code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Try extracting from curly braces
  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // continue
    }
  }

  // Try fixing common issues: trailing commas, single quotes
  let fixed = content
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/'/g, '"');
  try {
    return JSON.parse(fixed);
  } catch {
    // give up
  }

  return null;
}

// Validate routing decision output
export function validateRoutingDecision(content: string): ValidationResult {
  return validateStrictJson(content, ['tasks'], false);
}

// Validate approval decision output
export function validateApprovalDecision(content: string): ValidationResult {
  return validateStrictJson(content, ['decision', 'reason'], false);
}

// Validate agent output against its role schema
export function validateAgentOutput(content: string, requiredFields: string[], isCritical: boolean): ValidationResult {
  return validateStrictJson(content, requiredFields, !isCritical);
}
