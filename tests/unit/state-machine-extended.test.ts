// Extended State Machine Tests
// Additional tests for edge cases, error handling, and concurrent state transitions

import { describe, it, expect } from 'vitest';

// Import actual transition maps
import {
  LEGAL_RUN_TRANSITIONS,
  LEGAL_TASK_TRANSITIONS,
} from '../../services/orchestrator/src/state-machine.js';

// ============================================================================
// RUN STATE MACHINE EXTENDED TESTS
// ============================================================================

describe('Run State Machine - Extended', () => {
  describe('State Transition Completeness', () => {
    it('has exactly 10 run states', () => {
      expect(Object.keys(LEGAL_RUN_TRANSITIONS).length).toBe(10);
    });

    it('includes all expected states', () => {
      const expectedStates = [
        'DRAFT', 'PLANNING', 'ROUTING', 'EXECUTING',
        'WAITING_APPROVAL', 'RETRYING', 'PAUSED',
        'FAILED', 'COMPLETED', 'CANCELLED'
      ];
      
      for (const state of expectedStates) {
        expect(LEGAL_RUN_TRANSITIONS).toHaveProperty(state);
      }
    });
  });

  describe('Workflow Paths', () => {
    it('happy path: DRAFT → PLANNING → ROUTING → EXECUTING → COMPLETED', () => {
      expect(LEGAL_RUN_TRANSITIONS.DRAFT).toContain('PLANNING');
      expect(LEGAL_RUN_TRANSITIONS.PLANNING).toContain('ROUTING');
      expect(LEGAL_RUN_TRANSITIONS.ROUTING).toContain('EXECUTING');
      expect(LEGAL_RUN_TRANSITIONS.EXECUTING).toContain('COMPLETED');
    });

    it('approval path: EXECUTING → WAITING_APPROVAL → EXECUTING', () => {
      expect(LEGAL_RUN_TRANSITIONS.EXECUTING).toContain('WAITING_APPROVAL');
      expect(LEGAL_RUN_TRANSITIONS.WAITING_APPROVAL).toContain('EXECUTING');
    });

    it('retry path: EXECUTING → RETRYING → EXECUTING', () => {
      expect(LEGAL_RUN_TRANSITIONS.EXECUTING).toContain('RETRYING');
      expect(LEGAL_RUN_TRANSITIONS.RETRYING).toContain('EXECUTING');
    });

    it('failure path: EXECUTING → FAILED', () => {
      expect(LEGAL_RUN_TRANSITIONS.EXECUTING).toContain('FAILED');
    });

    it('resume path: FAILED → PLANNING', () => {
      expect(LEGAL_RUN_TRANSITIONS.FAILED).toContain('PLANNING');
    });

    it('pause path: EXECUTING → PAUSED → EXECUTING', () => {
      expect(LEGAL_RUN_TRANSITIONS.EXECUTING).toContain('PAUSED');
      expect(LEGAL_RUN_TRANSITIONS.PAUSED).toContain('EXECUTING');
    });
  });

  describe('Cancellation', () => {
    it('DRAFT can be cancelled', () => {
      expect(LEGAL_RUN_TRANSITIONS.DRAFT).toContain('CANCELLED');
    });

    it('PLANNING can be cancelled', () => {
      expect(LEGAL_RUN_TRANSITIONS.PLANNING).toContain('CANCELLED');
    });

    it('EXECUTING can be cancelled', () => {
      expect(LEGAL_RUN_TRANSITIONS.EXECUTING).toContain('CANCELLED');
    });

    it('WAITING_APPROVAL can be cancelled', () => {
      expect(LEGAL_RUN_TRANSITIONS.WAITING_APPROVAL).toContain('CANCELLED');
    });

    it('RETRYING can be cancelled', () => {
      expect(LEGAL_RUN_TRANSITIONS.RETRYING).toContain('CANCELLED');
    });

    it('PAUSED can be cancelled', () => {
      expect(LEGAL_RUN_TRANSITIONS.PAUSED).toContain('CANCELLED');
    });

    it('CANCELLED cannot transition anywhere (terminal)', () => {
      expect(LEGAL_RUN_TRANSITIONS.CANCELLED).toEqual([]);
    });
  });

  describe('Terminal States', () => {
    it('COMPLETED is terminal', () => {
      expect(LEGAL_RUN_TRANSITIONS.COMPLETED).toEqual([]);
    });

    it('CANCELLED is terminal', () => {
      expect(LEGAL_RUN_TRANSITIONS.CANCELLED).toEqual([]);
    });

    it('FAILED is resumable (not fully terminal)', () => {
      expect(LEGAL_RUN_TRANSITIONS.FAILED).not.toEqual([]);
      expect(LEGAL_RUN_TRANSITIONS.FAILED).toContain('PLANNING');
    });
  });

  describe('Invalid Transitions', () => {
    it('cannot skip PLANNING from DRAFT', () => {
      expect(LEGAL_RUN_TRANSITIONS.DRAFT).not.toContain('EXECUTING');
      expect(LEGAL_RUN_TRANSITIONS.DRAFT).not.toContain('ROUTING');
    });

    it('cannot go back from COMPLETED', () => {
      expect(LEGAL_RUN_TRANSITIONS.COMPLETED).not.toContain('EXECUTING');
      expect(LEGAL_RUN_TRANSITIONS.COMPLETED).not.toContain('DRAFT');
    });

    it('cannot go directly from DRAFT to terminal states except CANCELLED', () => {
      expect(LEGAL_RUN_TRANSITIONS.DRAFT).not.toContain('COMPLETED');
      expect(LEGAL_RUN_TRANSITIONS.DRAFT).not.toContain('FAILED');
    });
  });
});

// ============================================================================
// TASK STATE MACHINE EXTENDED TESTS
// ============================================================================

describe('Task State Machine - Extended', () => {
  describe('State Transition Completeness', () => {
    it('has exactly 8 task states', () => {
      expect(Object.keys(LEGAL_TASK_TRANSITIONS).length).toBe(8);
    });

    it('includes all expected states', () => {
      const expectedStates = [
        'PENDING', 'QUEUED', 'DISPATCHED', 'RUNNING',
        'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'
      ];
      
      for (const state of expectedStates) {
        expect(LEGAL_TASK_TRANSITIONS).toHaveProperty(state);
      }
    });
  });

  describe('Task Workflow Paths', () => {
    it('happy path: PENDING → QUEUED → DISPATCHED → RUNNING → SUCCEEDED', () => {
      expect(LEGAL_TASK_TRANSITIONS.PENDING).toContain('QUEUED');
      expect(LEGAL_TASK_TRANSITIONS.QUEUED).toContain('DISPATCHED');
      expect(LEGAL_TASK_TRANSITIONS.DISPATCHED).toContain('RUNNING');
      expect(LEGAL_TASK_TRANSITIONS.RUNNING).toContain('SUCCEEDED');
    });

    it('failure path: RUNNING → FAILED', () => {
      expect(LEGAL_TASK_TRANSITIONS.RUNNING).toContain('FAILED');
    });

    it('retry path: FAILED → QUEUED', () => {
      expect(LEGAL_TASK_TRANSITIONS.FAILED).toContain('QUEUED');
    });

    it('skip path: PENDING → SKIPPED', () => {
      expect(LEGAL_TASK_TRANSITIONS.PENDING).toContain('SKIPPED');
    });

    it('skip after failure: FAILED → SKIPPED', () => {
      expect(LEGAL_TASK_TRANSITIONS.FAILED).toContain('SKIPPED');
    });
  });

  describe('Cancellation', () => {
    it('PENDING can be cancelled', () => {
      expect(LEGAL_TASK_TRANSITIONS.PENDING).toContain('CANCELLED');
    });

    it('QUEUED can be cancelled', () => {
      expect(LEGAL_TASK_TRANSITIONS.QUEUED).toContain('CANCELLED');
    });

    it('DISPATCHED can be cancelled', () => {
      expect(LEGAL_TASK_TRANSITIONS.DISPATCHED).toContain('CANCELLED');
    });

    it('RUNNING can be cancelled', () => {
      expect(LEGAL_TASK_TRANSITIONS.RUNNING).toContain('CANCELLED');
    });
  });

  describe('Terminal States', () => {
    it('SUCCEEDED is terminal', () => {
      expect(LEGAL_TASK_TRANSITIONS.SUCCEEDED).toEqual([]);
    });

    it('SKIPPED is terminal', () => {
      expect(LEGAL_TASK_TRANSITIONS.SKIPPED).toEqual([]);
    });

    it('CANCELLED is terminal', () => {
      expect(LEGAL_TASK_TRANSITIONS.CANCELLED).toEqual([]);
    });

    it('FAILED is recoverable (retry or skip)', () => {
      expect(LEGAL_TASK_TRANSITIONS.FAILED).toContain('QUEUED');
      expect(LEGAL_TASK_TRANSITIONS.FAILED).toContain('SKIPPED');
    });
  });

  describe('Invalid Transitions', () => {
    it('cannot go backwards from RUNNING to QUEUED', () => {
      expect(LEGAL_TASK_TRANSITIONS.RUNNING).not.toContain('QUEUED');
      expect(LEGAL_TASK_TRANSITIONS.RUNNING).not.toContain('PENDING');
    });

    it('cannot skip DISPATCHED', () => {
      expect(LEGAL_TASK_TRANSITIONS.QUEUED).not.toContain('RUNNING');
    });

    it('cannot go from SUCCEEDED to any state', () => {
      expect(LEGAL_TASK_TRANSITIONS.SUCCEEDED).toEqual([]);
    });
  });
});

// ============================================================================
// TRANSITION VALIDATION HELPER
// ============================================================================

type RunState = keyof typeof LEGAL_RUN_TRANSITIONS;
type TaskState = keyof typeof LEGAL_TASK_TRANSITIONS;

function isValidRunTransition(from: string, to: string): boolean {
  const transitions = LEGAL_RUN_TRANSITIONS[from as RunState];
  return transitions?.includes(to as RunState) ?? false;
}

function isValidTaskTransition(from: string, to: string): boolean {
  const transitions = LEGAL_TASK_TRANSITIONS[from as TaskState];
  return transitions?.includes(to as TaskState) ?? false;
}

describe('Transition Validation Helpers', () => {
  describe('Run Transitions', () => {
    it('validates legal transitions', () => {
      expect(isValidRunTransition('DRAFT', 'PLANNING')).toBe(true);
      expect(isValidRunTransition('EXECUTING', 'COMPLETED')).toBe(true);
      expect(isValidRunTransition('FAILED', 'PLANNING')).toBe(true);
    });

    it('rejects illegal transitions', () => {
      expect(isValidRunTransition('DRAFT', 'COMPLETED')).toBe(false);
      expect(isValidRunTransition('COMPLETED', 'DRAFT')).toBe(false);
      expect(isValidRunTransition('CANCELLED', 'PLANNING')).toBe(false);
    });

    it('handles unknown states', () => {
      expect(isValidRunTransition('UNKNOWN', 'PLANNING')).toBe(false);
      expect(isValidRunTransition('DRAFT', 'UNKNOWN')).toBe(false);
    });
  });

  describe('Task Transitions', () => {
    it('validates legal transitions', () => {
      expect(isValidTaskTransition('PENDING', 'QUEUED')).toBe(true);
      expect(isValidTaskTransition('RUNNING', 'SUCCEEDED')).toBe(true);
      expect(isValidTaskTransition('FAILED', 'QUEUED')).toBe(true);
    });

    it('rejects illegal transitions', () => {
      expect(isValidTaskTransition('PENDING', 'RUNNING')).toBe(false);
      expect(isValidTaskTransition('SUCCEEDED', 'FAILED')).toBe(false);
    });
  });
});

// ============================================================================
// STATE REACHABILITY ANALYSIS
// ============================================================================

function findAllReachableStates(startState: string, transitionMap: Record<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue = [startState];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const next = transitionMap[current] || [];
    for (const state of next) {
      if (!visited.has(state)) {
        queue.push(state);
      }
    }
  }

  return visited;
}

describe('State Reachability Analysis', () => {
  describe('Run States', () => {
    it('all states reachable from DRAFT', () => {
      const reachable = findAllReachableStates('DRAFT', LEGAL_RUN_TRANSITIONS);
      
      expect(reachable.has('PLANNING')).toBe(true);
      expect(reachable.has('EXECUTING')).toBe(true);
      expect(reachable.has('COMPLETED')).toBe(true);
      expect(reachable.has('FAILED')).toBe(true);
      expect(reachable.has('CANCELLED')).toBe(true);
    });

    it('terminal states cannot reach non-terminal', () => {
      const fromCompleted = findAllReachableStates('COMPLETED', LEGAL_RUN_TRANSITIONS);
      expect(fromCompleted.size).toBe(1); // Only itself
      
      const fromCancelled = findAllReachableStates('CANCELLED', LEGAL_RUN_TRANSITIONS);
      expect(fromCancelled.size).toBe(1);
    });

    it('FAILED can reach COMPLETED through resume', () => {
      const fromFailed = findAllReachableStates('FAILED', LEGAL_RUN_TRANSITIONS);
      expect(fromFailed.has('PLANNING')).toBe(true);
      expect(fromFailed.has('COMPLETED')).toBe(true);
    });
  });

  describe('Task States', () => {
    it('all terminal states reachable from PENDING', () => {
      const reachable = findAllReachableStates('PENDING', LEGAL_TASK_TRANSITIONS);
      
      expect(reachable.has('SUCCEEDED')).toBe(true);
      expect(reachable.has('FAILED')).toBe(true);
      expect(reachable.has('SKIPPED')).toBe(true);
      expect(reachable.has('CANCELLED')).toBe(true);
    });
  });
});

// ============================================================================
// BATCH STATE OPERATIONS
// ============================================================================

interface StateUpdate {
  entityId: string;
  fromState: string;
  toState: string;
}

function validateBatchTransitions(
  updates: StateUpdate[],
  isValid: (from: string, to: string) => boolean
): { valid: StateUpdate[]; invalid: StateUpdate[] } {
  const valid: StateUpdate[] = [];
  const invalid: StateUpdate[] = [];

  for (const update of updates) {
    if (isValid(update.fromState, update.toState)) {
      valid.push(update);
    } else {
      invalid.push(update);
    }
  }

  return { valid, invalid };
}

describe('Batch State Operations', () => {
  it('separates valid and invalid transitions', () => {
    const updates: StateUpdate[] = [
      { entityId: 't1', fromState: 'PENDING', toState: 'QUEUED' },      // valid
      { entityId: 't2', fromState: 'RUNNING', toState: 'SUCCEEDED' },   // valid
      { entityId: 't3', fromState: 'PENDING', toState: 'RUNNING' },     // invalid
      { entityId: 't4', fromState: 'SUCCEEDED', toState: 'FAILED' },    // invalid
    ];

    const result = validateBatchTransitions(updates, isValidTaskTransition);

    expect(result.valid.length).toBe(2);
    expect(result.invalid.length).toBe(2);
    expect(result.valid.map(u => u.entityId)).toEqual(['t1', 't2']);
    expect(result.invalid.map(u => u.entityId)).toEqual(['t3', 't4']);
  });

  it('handles all valid updates', () => {
    const updates: StateUpdate[] = [
      { entityId: 'r1', fromState: 'DRAFT', toState: 'PLANNING' },
      { entityId: 'r2', fromState: 'EXECUTING', toState: 'COMPLETED' },
    ];

    const result = validateBatchTransitions(updates, isValidRunTransition);

    expect(result.valid.length).toBe(2);
    expect(result.invalid.length).toBe(0);
  });

  it('handles all invalid updates', () => {
    const updates: StateUpdate[] = [
      { entityId: 'r1', fromState: 'COMPLETED', toState: 'DRAFT' },
      { entityId: 'r2', fromState: 'CANCELLED', toState: 'EXECUTING' },
    ];

    const result = validateBatchTransitions(updates, isValidRunTransition);

    expect(result.valid.length).toBe(0);
    expect(result.invalid.length).toBe(2);
  });

  it('handles empty batch', () => {
    const result = validateBatchTransitions([], isValidRunTransition);

    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([]);
  });
});
