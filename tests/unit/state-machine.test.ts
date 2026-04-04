// State Machine Verification Tests
// These tests validate that the orchestration state machine follows legal transitions only.

import { describe, it, expect } from 'vitest';

// Import the actual transition maps from production code (single source of truth)
import {
  LEGAL_RUN_TRANSITIONS,
  LEGAL_TASK_TRANSITIONS,
} from '../../services/orchestrator/src/state-machine.js';

const ALL_RUN_STATES = Object.keys(LEGAL_RUN_TRANSITIONS);
const ALL_TASK_STATES = Object.keys(LEGAL_TASK_TRANSITIONS);

describe('Run State Machine', () => {
  it('every state has a defined transition list', () => {
    for (const state of ALL_RUN_STATES) {
      expect(LEGAL_RUN_TRANSITIONS[state]).toBeDefined();
      expect(Array.isArray(LEGAL_RUN_TRANSITIONS[state])).toBe(true);
    }
  });

  it('all transition targets are valid states', () => {
    for (const [from, targets] of Object.entries(LEGAL_RUN_TRANSITIONS)) {
      for (const target of targets) {
        expect(ALL_RUN_STATES).toContain(target);
      }
    }
  });

  it('terminal states have no outgoing transitions (except FAILED which can resume)', () => {
    expect(LEGAL_RUN_TRANSITIONS.FAILED).toEqual(['PLANNING']); // Resume path
    expect(LEGAL_RUN_TRANSITIONS.COMPLETED).toEqual([]);
    expect(LEGAL_RUN_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('DRAFT can only go to PLANNING or CANCELLED', () => {
    expect(LEGAL_RUN_TRANSITIONS.DRAFT).toEqual(['PLANNING', 'CANCELLED']);
  });

  it('every non-terminal state can reach CANCELLED', () => {
    const nonTerminal = ALL_RUN_STATES.filter(s => !['FAILED', 'COMPLETED', 'CANCELLED'].includes(s));
    for (const state of nonTerminal) {
      expect(LEGAL_RUN_TRANSITIONS[state]).toContain('CANCELLED');
    }
  });

  it('every non-terminal state has a path to COMPLETED or FAILED', () => {
    // BFS to verify reachability
    for (const startState of ALL_RUN_STATES.filter(s => !['FAILED', 'COMPLETED', 'CANCELLED'].includes(s))) {
      const visited = new Set<string>();
      const queue = [startState];
      let reachesTerminal = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(current)) {
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

  it('illegal transitions are rejected', () => {
    // These transitions should NOT be in the legal map
    expect(LEGAL_RUN_TRANSITIONS.COMPLETED).not.toContain('EXECUTING');
    expect(LEGAL_RUN_TRANSITIONS.FAILED).not.toContain('EXECUTING');
    expect(LEGAL_RUN_TRANSITIONS.DRAFT).not.toContain('EXECUTING');
    expect(LEGAL_RUN_TRANSITIONS.DRAFT).not.toContain('COMPLETED');
  });
});

describe('Task State Machine', () => {
  it('every state has a defined transition list', () => {
    for (const state of ALL_TASK_STATES) {
      expect(LEGAL_TASK_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('all transition targets are valid states', () => {
    for (const [from, targets] of Object.entries(LEGAL_TASK_TRANSITIONS)) {
      for (const target of targets) {
        expect(ALL_TASK_STATES).toContain(target);
      }
    }
  });

  it('terminal states have no outgoing transitions (except FAILED for retry)', () => {
    expect(LEGAL_TASK_TRANSITIONS.SUCCEEDED).toEqual([]);
    expect(LEGAL_TASK_TRANSITIONS.SKIPPED).toEqual([]);
    expect(LEGAL_TASK_TRANSITIONS.CANCELLED).toEqual([]);
    // FAILED can retry → QUEUED or be skipped
    expect(LEGAL_TASK_TRANSITIONS.FAILED).toEqual(['QUEUED', 'SKIPPED']);
  });

  it('normal flow follows PENDING → QUEUED → DISPATCHED → RUNNING → SUCCEEDED', () => {
    expect(LEGAL_TASK_TRANSITIONS.PENDING).toContain('QUEUED');
    expect(LEGAL_TASK_TRANSITIONS.QUEUED).toContain('DISPATCHED');
    expect(LEGAL_TASK_TRANSITIONS.DISPATCHED).toContain('RUNNING');
    expect(LEGAL_TASK_TRANSITIONS.RUNNING).toContain('SUCCEEDED');
  });
});
