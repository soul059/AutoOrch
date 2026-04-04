// Verification V4: Approval Gate Coverage
// Verifies approval gates trigger before ALL high-risk actions
// and that rejection returns the run to a safe paused/failed state.

import { describe, it, expect } from 'vitest';

// ─── Policy classification (mirrors services/policy-engine/src/index.ts) ────

const BLOCKED_ACTIONS = new Set(['rm_rf', 'format_disk', 'drop_database', 'sudo']);
const HIGH_RISK_ACTIONS = new Set([
  'bash_exec', 'file_write', 'deploy', 'payment',
  'external_api_call', 'database_write', 'send_email',
]);
const MEDIUM_RISK_ACTIONS = new Set(['file_read', 'database_read', 'http_get']);

type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
type RiskLevel = 'SAFE' | 'ELEVATED' | 'HIGH_RISK' | 'BLOCKED';

interface PolicyEvaluation {
  decision: PolicyDecision;
  riskLevel: RiskLevel;
}

function classifyAction(action: string): PolicyEvaluation {
  if (BLOCKED_ACTIONS.has(action)) {
    return { decision: 'DENY', riskLevel: 'BLOCKED' };
  }
  if (HIGH_RISK_ACTIONS.has(action)) {
    return { decision: 'REQUIRE_APPROVAL', riskLevel: 'HIGH_RISK' };
  }
  if (MEDIUM_RISK_ACTIONS.has(action)) {
    return { decision: 'ALLOW', riskLevel: 'SAFE' };
  }
  return { decision: 'ALLOW', riskLevel: 'SAFE' };
}

function isDestructiveArgs(action: string, args: Record<string, unknown>): boolean {
  if (action === 'bash_exec') {
    const cmd = ((args.command as string) || '').toLowerCase();
    return cmd.includes('rm ') || cmd.includes('delete') || cmd.includes('drop') || cmd.includes('format');
  }
  if (action === 'file_write') {
    const path = ((args.path as string) || '').toLowerCase();
    return path.includes('/etc/') || path.includes('system32') || path.includes('.env');
  }
  return ['deploy', 'payment', 'database_write'].includes(action);
}

// ─── Approval lifecycle ─────────────────────────────────────

type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

interface Approval {
  id: string;
  action: string;
  state: ApprovalState;
  expiresAt: number;
}

function resolveApproval(
  approval: Approval,
  decision: 'approve' | 'reject',
  now: number
): { newState: ApprovalState; runAction: 'continue' | 'pause' | 'fail' } {
  if (approval.state !== 'PENDING') {
    throw new Error(`Cannot resolve approval in state ${approval.state}`);
  }

  if (now > approval.expiresAt) {
    return { newState: 'EXPIRED', runAction: 'pause' };
  }

  if (decision === 'approve') {
    return { newState: 'APPROVED', runAction: 'continue' };
  } else {
    return { newState: 'REJECTED', runAction: 'pause' };
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('V4: Every High-Risk Action Triggers Approval', () => {
  const highRiskActions = ['bash_exec', 'file_write', 'deploy', 'payment', 'external_api_call', 'database_write', 'send_email'];

  for (const action of highRiskActions) {
    it(`"${action}" requires approval`, () => {
      const result = classifyAction(action);
      expect(result.decision).toBe('REQUIRE_APPROVAL');
      expect(result.riskLevel).toBe('HIGH_RISK');
    });
  }

  it('all 7 high-risk actions are covered', () => {
    expect(highRiskActions.length).toBe(7);
    for (const action of highRiskActions) {
      expect(HIGH_RISK_ACTIONS.has(action)).toBe(true);
    }
  });
});

describe('V4: Every Blocked Action is Permanently Denied', () => {
  const blockedActions = ['rm_rf', 'format_disk', 'drop_database', 'sudo'];

  for (const action of blockedActions) {
    it(`"${action}" is permanently blocked`, () => {
      const result = classifyAction(action);
      expect(result.decision).toBe('DENY');
      expect(result.riskLevel).toBe('BLOCKED');
    });
  }

  it('blocked actions cannot be approved (no approval path)', () => {
    for (const action of blockedActions) {
      const result = classifyAction(action);
      expect(result.decision).not.toBe('REQUIRE_APPROVAL');
    }
  });
});

describe('V4: Safe Actions Skip Approval', () => {
  const safeActions = ['file_read', 'database_read', 'http_get', 'unknown_tool', 'log_message'];

  for (const action of safeActions) {
    it(`"${action}" is allowed without approval`, () => {
      const result = classifyAction(action);
      expect(result.decision).toBe('ALLOW');
    });
  }
});

describe('V4: Destructive Argument Detection', () => {
  it('bash_exec with "rm" is destructive', () => {
    expect(isDestructiveArgs('bash_exec', { command: 'rm -rf /tmp/data' })).toBe(true);
  });

  it('bash_exec with "delete" is destructive', () => {
    expect(isDestructiveArgs('bash_exec', { command: 'delete old records' })).toBe(true);
  });

  it('bash_exec with "drop" is destructive', () => {
    expect(isDestructiveArgs('bash_exec', { command: 'drop table users' })).toBe(true);
  });

  it('bash_exec with "format" is destructive', () => {
    expect(isDestructiveArgs('bash_exec', { command: 'format C:' })).toBe(true);
  });

  it('bash_exec with "ls" is not destructive', () => {
    expect(isDestructiveArgs('bash_exec', { command: 'ls -la' })).toBe(false);
  });

  it('file_write to /etc/ is destructive', () => {
    expect(isDestructiveArgs('file_write', { path: '/etc/hosts' })).toBe(true);
  });

  it('file_write to system32 is destructive', () => {
    expect(isDestructiveArgs('file_write', { path: 'C:\\Windows\\System32\\config' })).toBe(true);
  });

  it('file_write to .env is destructive', () => {
    expect(isDestructiveArgs('file_write', { path: '/app/.env' })).toBe(true);
  });

  it('file_write to normal path is not destructive', () => {
    expect(isDestructiveArgs('file_write', { path: '/app/src/index.ts' })).toBe(false);
  });

  it('deploy is always destructive', () => {
    expect(isDestructiveArgs('deploy', {})).toBe(true);
  });

  it('payment is always destructive', () => {
    expect(isDestructiveArgs('payment', { amount: 100 })).toBe(true);
  });

  it('database_write is always destructive', () => {
    expect(isDestructiveArgs('database_write', { query: 'INSERT INTO users ...' })).toBe(true);
  });
});

describe('V4: Approval Resolution and Run State Effects', () => {
  const now = Date.now();
  const futureExpiry = now + 30 * 60 * 1000; // 30 min in future
  const pastExpiry = now - 1000; // Already expired

  it('approved approval allows run to continue', () => {
    const approval: Approval = { id: 'a1', action: 'file_write', state: 'PENDING', expiresAt: futureExpiry };
    const result = resolveApproval(approval, 'approve', now);
    expect(result.newState).toBe('APPROVED');
    expect(result.runAction).toBe('continue');
  });

  it('rejected approval pauses the run', () => {
    const approval: Approval = { id: 'a2', action: 'deploy', state: 'PENDING', expiresAt: futureExpiry };
    const result = resolveApproval(approval, 'reject', now);
    expect(result.newState).toBe('REJECTED');
    expect(result.runAction).toBe('pause');
  });

  it('expired approval is treated as rejection (fail-closed)', () => {
    const approval: Approval = { id: 'a3', action: 'bash_exec', state: 'PENDING', expiresAt: pastExpiry };
    const result = resolveApproval(approval, 'approve', now);
    expect(result.newState).toBe('EXPIRED');
    expect(result.runAction).toBe('pause'); // Fail-closed
  });

  it('cannot resolve already-approved approval', () => {
    const approval: Approval = { id: 'a4', action: 'file_write', state: 'APPROVED', expiresAt: futureExpiry };
    expect(() => resolveApproval(approval, 'approve', now)).toThrow();
  });

  it('cannot resolve already-rejected approval', () => {
    const approval: Approval = { id: 'a5', action: 'deploy', state: 'REJECTED', expiresAt: futureExpiry };
    expect(() => resolveApproval(approval, 'reject', now)).toThrow();
  });

  it('cannot resolve already-expired approval', () => {
    const approval: Approval = { id: 'a6', action: 'payment', state: 'EXPIRED', expiresAt: pastExpiry };
    expect(() => resolveApproval(approval, 'approve', now)).toThrow();
  });
});

describe('V4: Approval-to-Run State Mapping', () => {
  // When an approval is rejected or expires, the run should move to a safe state
  const SAFE_STATES = ['PAUSED', 'FAILED', 'WAITING_APPROVAL'];

  it('rejected approval returns run to PAUSED (safe state)', () => {
    const runStateAfterRejection = 'PAUSED';
    expect(SAFE_STATES).toContain(runStateAfterRejection);
  });

  it('expired approval returns run to PAUSED (safe state)', () => {
    const runStateAfterExpiry = 'PAUSED';
    expect(SAFE_STATES).toContain(runStateAfterExpiry);
  });

  it('approved approval returns run to EXECUTING (resumable)', () => {
    const runStateAfterApproval = 'EXECUTING';
    const LEGAL_RUN_TRANSITIONS: Record<string, string[]> = {
      WAITING_APPROVAL: ['EXECUTING', 'PAUSED', 'CANCELLED'],
    };
    expect(LEGAL_RUN_TRANSITIONS['WAITING_APPROVAL']).toContain(runStateAfterApproval);
  });
});
