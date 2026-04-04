// Verification V2: State Machine Completeness
// Verifies every orchestration state has a legal next state and recovery path after restart.

import { describe, it, expect } from 'vitest';

// Import from production code (single source of truth)
import {
  LEGAL_RUN_TRANSITIONS,
  LEGAL_TASK_TRANSITIONS,
} from '../../services/orchestrator/src/state-machine.js';

const ALL_RUN_STATES = Object.keys(LEGAL_RUN_TRANSITIONS);
const ALL_TASK_STATES = Object.keys(LEGAL_TASK_TRANSITIONS);

// ─── Crash recovery rules ───────────────────────────────────

// When the system crashes, active states need recovery mapping
function getRunRecoveryState(stateAtCrash: string): string {
  switch (stateAtCrash) {
    case 'EXECUTING': return 'PAUSED';
    case 'ROUTING': return 'PAUSED';
    case 'PLANNING': return 'PAUSED';
    case 'RETRYING': return 'PAUSED';
    case 'WAITING_APPROVAL': return 'WAITING_APPROVAL'; // Preserve — approval still pending
    case 'PAUSED': return 'PAUSED'; // Already paused
    case 'DRAFT': return 'DRAFT'; // Not started, safe
    case 'FAILED': return 'FAILED'; // Terminal, safe
    case 'COMPLETED': return 'COMPLETED'; // Terminal, safe
    case 'CANCELLED': return 'CANCELLED'; // Terminal, safe
    default: return 'FAILED';
  }
}

function getTaskRecoveryState(stateAtCrash: string): string {
  switch (stateAtCrash) {
    case 'RUNNING': return 'QUEUED'; // Re-queue for re-dispatch
    case 'DISPATCHED': return 'QUEUED'; // Re-queue
    case 'QUEUED': return 'QUEUED'; // Already queued, safe
    case 'PENDING': return 'PENDING'; // Not started, safe
    case 'SUCCEEDED': return 'SUCCEEDED'; // Completed, preserve
    case 'FAILED': return 'FAILED'; // Failed, preserve
    case 'SKIPPED': return 'SKIPPED'; // Skipped, preserve
    case 'CANCELLED': return 'CANCELLED'; // Cancelled, preserve
    default: return 'FAILED';
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('V2: Run State Completeness', () => {
  it('every run state has a defined transition list', () => {
    for (const state of ALL_RUN_STATES) {
      expect(LEGAL_RUN_TRANSITIONS[state]).toBeDefined();
      expect(Array.isArray(LEGAL_RUN_TRANSITIONS[state])).toBe(true);
    }
  });

  it('every non-terminal run state has at least one outgoing transition', () => {
    const trulyTerminal = ['COMPLETED', 'CANCELLED'];
    for (const state of ALL_RUN_STATES) {
      if (trulyTerminal.includes(state)) continue;
      expect(LEGAL_RUN_TRANSITIONS[state].length).toBeGreaterThan(0);
    }
  });

  it('COMPLETED and CANCELLED are the only fully terminal states', () => {
    for (const state of ALL_RUN_STATES) {
      if (LEGAL_RUN_TRANSITIONS[state].length === 0) {
        expect(['COMPLETED', 'CANCELLED']).toContain(state);
      }
    }
  });

  it('FAILED has a resume path (FAILED → PLANNING)', () => {
    expect(LEGAL_RUN_TRANSITIONS.FAILED).toContain('PLANNING');
    expect(LEGAL_RUN_TRANSITIONS.FAILED.length).toBe(1);
  });

  it('every non-terminal state can reach COMPLETED through some path', () => {
    for (const start of ALL_RUN_STATES.filter(s => !['COMPLETED', 'CANCELLED'].includes(s))) {
      const visited = new Set<string>();
      const queue = [start];
      let canComplete = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        if (current === 'COMPLETED') { canComplete = true; break; }

        for (const next of LEGAL_RUN_TRANSITIONS[current] || []) {
          queue.push(next);
        }
      }

      expect(canComplete).toBe(true);
    }
  });

  it('every non-terminal state can reach CANCELLED directly', () => {
    const nonTerminal = ALL_RUN_STATES.filter(s => !['COMPLETED', 'CANCELLED'].includes(s));
    for (const state of nonTerminal) {
      // FAILED can be cancelled indirectly (FAILED → PLANNING → CANCELLED)
      if (state === 'FAILED') {
        const visited = new Set<string>();
        const queue = [state];
        let canCancel = false;
        while (queue.length > 0) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);
          if (current === 'CANCELLED') { canCancel = true; break; }
          for (const next of LEGAL_RUN_TRANSITIONS[current] || []) queue.push(next);
        }
        expect(canCancel).toBe(true);
      } else {
        expect(LEGAL_RUN_TRANSITIONS[state]).toContain('CANCELLED');
      }
    }
  });

  it('no transition creates a cycle without an exit', () => {
    // Check that no set of states forms a closed cycle (no path to terminal)
    for (const start of ALL_RUN_STATES) {
      if (['COMPLETED', 'CANCELLED'].includes(start)) continue;

      const visited = new Set<string>();
      const queue = [start];
      let reachesTerminal = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        if (['COMPLETED', 'CANCELLED'].includes(current)) {
          reachesTerminal = true;
          break;
        }

        for (const next of LEGAL_RUN_TRANSITIONS[current] || []) {
          queue.push(next);
        }
      }

      expect(reachesTerminal).toBe(true);
    }
  });
});

describe('V2: Task State Completeness', () => {
  it('every task state has a defined transition list', () => {
    for (const state of ALL_TASK_STATES) {
      expect(LEGAL_TASK_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('FAILED can retry (FAILED → QUEUED) or skip (FAILED → SKIPPED)', () => {
    expect(LEGAL_TASK_TRANSITIONS.FAILED).toContain('QUEUED');
    expect(LEGAL_TASK_TRANSITIONS.FAILED).toContain('SKIPPED');
  });

  it('normal happy path is PENDING → QUEUED → DISPATCHED → RUNNING → SUCCEEDED', () => {
    const path = ['PENDING', 'QUEUED', 'DISPATCHED', 'RUNNING', 'SUCCEEDED'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(LEGAL_TASK_TRANSITIONS[path[i]]).toContain(path[i + 1]);
    }
  });

  it('every non-terminal task state can reach SUCCEEDED', () => {
    for (const start of ALL_TASK_STATES.filter(s => !['SUCCEEDED', 'SKIPPED', 'CANCELLED'].includes(s))) {
      const visited = new Set<string>();
      const queue = [start];
      let canSucceed = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        if (current === 'SUCCEEDED') { canSucceed = true; break; }

        for (const next of LEGAL_TASK_TRANSITIONS[current] || []) {
          queue.push(next);
        }
      }

      expect(canSucceed).toBe(true);
    }
  });
});

describe('V2: Crash Recovery from Every Run State', () => {
  it('DRAFT survives crash (stays DRAFT)', () => {
    expect(getRunRecoveryState('DRAFT')).toBe('DRAFT');
  });

  it('PLANNING transitions to PAUSED on crash', () => {
    const recovered = getRunRecoveryState('PLANNING');
    expect(recovered).toBe('PAUSED');
    // PAUSED has a legal next state
    expect(LEGAL_RUN_TRANSITIONS[recovered].length).toBeGreaterThan(0);
  });

  it('ROUTING transitions to PAUSED on crash', () => {
    const recovered = getRunRecoveryState('ROUTING');
    expect(recovered).toBe('PAUSED');
  });

  it('EXECUTING transitions to PAUSED on crash', () => {
    const recovered = getRunRecoveryState('EXECUTING');
    expect(recovered).toBe('PAUSED');
  });

  it('WAITING_APPROVAL preserves state on crash', () => {
    const recovered = getRunRecoveryState('WAITING_APPROVAL');
    expect(recovered).toBe('WAITING_APPROVAL');
  });

  it('RETRYING transitions to PAUSED on crash', () => {
    const recovered = getRunRecoveryState('RETRYING');
    expect(recovered).toBe('PAUSED');
  });

  it('PAUSED stays PAUSED on crash', () => {
    const recovered = getRunRecoveryState('PAUSED');
    expect(recovered).toBe('PAUSED');
  });

  it('FAILED stays FAILED on crash', () => {
    const recovered = getRunRecoveryState('FAILED');
    expect(recovered).toBe('FAILED');
  });

  it('COMPLETED stays COMPLETED on crash', () => {
    const recovered = getRunRecoveryState('COMPLETED');
    expect(recovered).toBe('COMPLETED');
  });

  it('CANCELLED stays CANCELLED on crash', () => {
    const recovered = getRunRecoveryState('CANCELLED');
    expect(recovered).toBe('CANCELLED');
  });

  it('every recovered run state has a valid next transition', () => {
    for (const state of ALL_RUN_STATES) {
      const recovered = getRunRecoveryState(state);
      expect(ALL_RUN_STATES).toContain(recovered);
      // If recovered state is not truly terminal, it must have transitions
      if (!['COMPLETED', 'CANCELLED'].includes(recovered)) {
        expect(LEGAL_RUN_TRANSITIONS[recovered].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('V2: Crash Recovery from Every Task State', () => {
  it('RUNNING tasks are re-queued on crash', () => {
    expect(getTaskRecoveryState('RUNNING')).toBe('QUEUED');
  });

  it('DISPATCHED tasks are re-queued on crash', () => {
    expect(getTaskRecoveryState('DISPATCHED')).toBe('QUEUED');
  });

  it('QUEUED tasks stay QUEUED on crash', () => {
    expect(getTaskRecoveryState('QUEUED')).toBe('QUEUED');
  });

  it('PENDING tasks stay PENDING on crash', () => {
    expect(getTaskRecoveryState('PENDING')).toBe('PENDING');
  });

  it('SUCCEEDED tasks are preserved on crash', () => {
    expect(getTaskRecoveryState('SUCCEEDED')).toBe('SUCCEEDED');
  });

  it('FAILED tasks are preserved on crash', () => {
    expect(getTaskRecoveryState('FAILED')).toBe('FAILED');
  });

  it('SKIPPED tasks are preserved on crash', () => {
    expect(getTaskRecoveryState('SKIPPED')).toBe('SKIPPED');
  });

  it('CANCELLED tasks are preserved on crash', () => {
    expect(getTaskRecoveryState('CANCELLED')).toBe('CANCELLED');
  });

  it('every recovered task state is a valid state', () => {
    for (const state of ALL_TASK_STATES) {
      const recovered = getTaskRecoveryState(state);
      expect(ALL_TASK_STATES).toContain(recovered);
    }
  });
});
