// Budget Race Condition Tests
// Tests for concurrent budget checking and cost reservation

import { describe, it, expect } from 'vitest';

// ============================================================================
// BUDGET ENFORCEMENT WITH PENDING COST RESERVATION
// ============================================================================

const DEFAULT_TASK_COST_ESTIMATE = 0.01; // $0.01 per task estimated

interface Run {
  id: string;
  maxBudget: number;
}

interface Task {
  id: string;
  runId: string;
  state: 'PENDING' | 'QUEUED' | 'DISPATCHED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  cost: number | null;
}

interface BudgetLedgerEntry {
  taskId: string;
  cost: number;
}

// Simulates the improved budget check with pending cost reservation
function checkBudgetWithReservation(
  run: Run,
  ledger: BudgetLedgerEntry[],
  pendingTasks: Task[],
  newTaskCostEstimate: number = DEFAULT_TASK_COST_ESTIMATE
): { allowed: boolean; reason?: string; currentSpend: number; pendingReserved: number; available: number } {
  // Calculate confirmed spend from ledger
  const confirmedSpend = ledger
    .filter(e => e.taskId.startsWith(run.id) || pendingTasks.some(t => t.id === e.taskId))
    .reduce((sum, e) => sum + e.cost, 0);

  // Calculate pending tasks (DISPATCHED and RUNNING)
  const activeTasks = pendingTasks.filter(t =>
    t.runId === run.id && (t.state === 'DISPATCHED' || t.state === 'RUNNING')
  );

  // Reserve cost for pending tasks
  const pendingReserved = activeTasks.length * newTaskCostEstimate;

  // Calculate available budget
  const available = run.maxBudget - confirmedSpend - pendingReserved;

  if (available < newTaskCostEstimate) {
    return {
      allowed: false,
      reason: `Budget would be exceeded: ${confirmedSpend.toFixed(4)} spent + ${pendingReserved.toFixed(4)} reserved = ${(confirmedSpend + pendingReserved).toFixed(4)} of ${run.maxBudget.toFixed(4)} max`,
      currentSpend: confirmedSpend,
      pendingReserved,
      available,
    };
  }

  return {
    allowed: true,
    currentSpend: confirmedSpend,
    pendingReserved,
    available,
  };
}

describe('Budget Enforcement with Pending Cost Reservation', () => {
  describe('Basic Budget Checks', () => {
    it('allows task when budget is available', () => {
      const run: Run = { id: 'run_1', maxBudget: 1.0 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.allowed).toBe(true);
      expect(result.currentSpend).toBe(0);
      expect(result.pendingReserved).toBe(0);
      expect(result.available).toBe(1.0);
    });

    it('blocks task when budget is exhausted', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [
        { taskId: 'run_1_task_1', cost: 0.05 },
      ];
      const tasks: Task[] = [];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });

    it('calculates available budget correctly', () => {
      const run: Run = { id: 'run_1', maxBudget: 1.0 };
      const ledger: BudgetLedgerEntry[] = [
        { taskId: 'run_1_task_1', cost: 0.25 },
        { taskId: 'run_1_task_2', cost: 0.30 },
      ];
      const tasks: Task[] = [];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.allowed).toBe(true);
      expect(result.currentSpend).toBeCloseTo(0.55, 10);
      expect(result.available).toBeCloseTo(0.45, 10);
    });
  });

  describe('Pending Task Reservation', () => {
    it('reserves cost for DISPATCHED tasks', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 'task_1', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 'task_2', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 'task_3', runId: 'run_1', state: 'DISPATCHED', cost: null },
      ];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.pendingReserved).toBeCloseTo(0.03, 10); // 3 * 0.01
      expect(result.available).toBeCloseTo(0.02, 10); // 0.05 - 0 - 0.03
    });

    it('reserves cost for RUNNING tasks', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 'task_1', runId: 'run_1', state: 'RUNNING', cost: null },
        { id: 'task_2', runId: 'run_1', state: 'RUNNING', cost: null },
      ];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.pendingReserved).toBe(0.02); // 2 * 0.01
    });

    it('does not reserve cost for SUCCEEDED tasks', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 'task_1', runId: 'run_1', state: 'SUCCEEDED', cost: 0.01 },
        { id: 'task_2', runId: 'run_1', state: 'SUCCEEDED', cost: 0.01 },
      ];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.pendingReserved).toBe(0);
    });

    it('does not reserve cost for PENDING or QUEUED tasks', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 'task_1', runId: 'run_1', state: 'PENDING', cost: null },
        { id: 'task_2', runId: 'run_1', state: 'QUEUED', cost: null },
      ];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.pendingReserved).toBe(0);
    });

    it('only counts tasks from the same run', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 'task_1', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 'task_2', runId: 'run_2', state: 'DISPATCHED', cost: null }, // Different run
        { id: 'task_3', runId: 'run_3', state: 'RUNNING', cost: null },    // Different run
      ];

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.pendingReserved).toBe(0.01); // Only 1 task from run_1
    });
  });

  describe('Race Condition Prevention', () => {
    it('blocks dispatch when pending tasks would exceed budget', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.03 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 'task_1', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 'task_2', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 'task_3', runId: 'run_1', state: 'RUNNING', cost: null },
      ];

      // Budget: 0.03, Pending reserved: 0.03, Available: 0
      // New task would need 0.01 but only 0 available
      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.allowed).toBe(false);
      expect(result.pendingReserved).toBe(0.03);
      expect(result.available).toBe(0);
    });

    it('simulates concurrent dispatch attempt being blocked', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };

      // Initial state: no tasks running
      let tasks: Task[] = [];
      let result = checkBudgetWithReservation(run, [], tasks);
      expect(result.allowed).toBe(true);

      // Dispatcher 1 checks budget and starts dispatching 5 tasks
      tasks = [
        { id: 't1', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 't2', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 't3', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 't4', runId: 'run_1', state: 'DISPATCHED', cost: null },
        { id: 't5', runId: 'run_1', state: 'DISPATCHED', cost: null },
      ];

      // Dispatcher 2 tries to dispatch another task - should be blocked
      result = checkBudgetWithReservation(run, [], tasks);
      expect(result.allowed).toBe(false);
      expect(result.pendingReserved).toBe(0.05);
    });

    it('combines confirmed spend and pending reservation', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.11 }; // Slightly higher to avoid edge case
      const ledger: BudgetLedgerEntry[] = [
        { taskId: 'run_1_task_1', cost: 0.04 },
        { taskId: 'run_1_task_2', cost: 0.03 },
      ];
      const tasks: Task[] = [
        { id: 'task_3', runId: 'run_1', state: 'RUNNING', cost: null },
        { id: 'task_4', runId: 'run_1', state: 'DISPATCHED', cost: null },
      ];

      // Spent: 0.07, Reserved: 0.02, Available: 0.02
      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.currentSpend).toBe(0.07);
      expect(result.pendingReserved).toBe(0.02);
      expect(result.available).toBeCloseTo(0.02, 10);
      expect(result.allowed).toBe(true); // Enough budget for one more task
    });

    it('rejects when combined spend+reserved exceeds budget', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.08 };
      const ledger: BudgetLedgerEntry[] = [
        { taskId: 'run_1_task_1', cost: 0.04 },
        { taskId: 'run_1_task_2', cost: 0.03 },
      ];
      const tasks: Task[] = [
        { id: 'task_3', runId: 'run_1', state: 'RUNNING', cost: null },
        { id: 'task_4', runId: 'run_1', state: 'DISPATCHED', cost: null },
      ];

      // Spent: 0.07, Reserved: 0.02, Total: 0.09 > Max: 0.08
      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });
  });

  describe('Custom Cost Estimates', () => {
    it('uses custom task cost estimate', () => {
      const run: Run = { id: 'run_1', maxBudget: 1.0 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = [
        { id: 't1', runId: 'run_1', state: 'RUNNING', cost: null },
      ];

      // With high estimate
      const result = checkBudgetWithReservation(run, ledger, tasks, 0.50);

      expect(result.pendingReserved).toBe(0.50);
      expect(result.available).toBe(0.50);
    });

    it('blocks with high estimate when default would allow', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.10 };
      const ledger: BudgetLedgerEntry[] = [{ taskId: 'run_1_t0', cost: 0.05 }];
      const tasks: Task[] = [
        { id: 't1', runId: 'run_1', state: 'RUNNING', cost: null },
      ];

      // With default (0.01): would allow (0.05 + 0.01 = 0.06 < 0.10)
      const defaultResult = checkBudgetWithReservation(run, ledger, tasks, 0.01);
      expect(defaultResult.allowed).toBe(true);

      // With high estimate (0.10): would block (0.05 + 0.10 = 0.15 > 0.10)
      const highResult = checkBudgetWithReservation(run, ledger, tasks, 0.10);
      expect(highResult.allowed).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles zero budget', () => {
      const run: Run = { id: 'run_1', maxBudget: 0 };
      const result = checkBudgetWithReservation(run, [], []);

      expect(result.allowed).toBe(false);
    });

    it('handles negative available (over budget)', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.05 };
      const ledger: BudgetLedgerEntry[] = [{ taskId: 'run_1_t1', cost: 0.06 }]; // Already over

      const result = checkBudgetWithReservation(run, ledger, []);

      expect(result.allowed).toBe(false);
      expect(result.available).toBeLessThan(0);
    });

    it('handles very large budgets', () => {
      const run: Run = { id: 'run_1', maxBudget: 1000000 };
      const ledger: BudgetLedgerEntry[] = [];
      const tasks: Task[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `t${i}`,
        runId: 'run_1',
        state: 'DISPATCHED' as const,
        cost: null,
      }));

      const result = checkBudgetWithReservation(run, ledger, tasks);

      expect(result.allowed).toBe(true);
      expect(result.pendingReserved).toBe(10); // 1000 * 0.01
    });

    it('handles floating point precision', () => {
      const run: Run = { id: 'run_1', maxBudget: 0.30 };
      const ledger: BudgetLedgerEntry[] = [
        { taskId: 'run_1_t1', cost: 0.10 },
        { taskId: 'run_1_t2', cost: 0.10 },
        { taskId: 'run_1_t3', cost: 0.10 },
      ];

      const result = checkBudgetWithReservation(run, ledger, []);

      // Should be exactly at budget (0.30 spent, 0.00 available)
      expect(result.currentSpend).toBeCloseTo(0.30, 10);
      expect(result.available).toBeCloseTo(0, 10);
    });
  });
});
