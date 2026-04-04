// Checkpoint Recovery Verification Tests
// Validates that checkpoint save/load maintains correct state

import { describe, it, expect } from 'vitest';

interface Checkpoint {
  id: string;
  runId: string;
  state: string;
  taskStates: Record<string, string>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Run {
  id: string;
  state: string;
  tasks: Array<{ id: string; state: string; output?: unknown }>;
}

// Simulate checkpoint creation
function createCheckpoint(run: Run): Checkpoint {
  return {
    id: `chk_${Date.now()}`,
    runId: run.id,
    state: run.state,
    taskStates: Object.fromEntries(run.tasks.map(t => [t.id, t.state])),
    metadata: {
      taskCount: run.tasks.length,
      completedTasks: run.tasks.filter(t => t.state === 'SUCCEEDED').length,
      failedTasks: run.tasks.filter(t => t.state === 'FAILED').length,
    },
    createdAt: new Date().toISOString(),
  };
}

// Simulate checkpoint restoration
function restoreFromCheckpoint(checkpoint: Checkpoint): { runState: string; taskStates: Record<string, string> } {
  // On restore, EXECUTING becomes PAUSED, RUNNING tasks become QUEUED (for re-dispatch)
  const restoredRunState = checkpoint.state === 'EXECUTING' ? 'PAUSED' : checkpoint.state;

  const restoredTaskStates: Record<string, string> = {};
  for (const [taskId, state] of Object.entries(checkpoint.taskStates)) {
    if (state === 'RUNNING' || state === 'DISPATCHED') {
      restoredTaskStates[taskId] = 'QUEUED'; // Re-queue in-flight tasks
    } else {
      restoredTaskStates[taskId] = state;
    }
  }

  return { runState: restoredRunState, taskStates: restoredTaskStates };
}

describe('Checkpoint Creation', () => {
  it('captures run state correctly', () => {
    const run: Run = {
      id: 'run_1',
      state: 'EXECUTING',
      tasks: [
        { id: 't1', state: 'SUCCEEDED' },
        { id: 't2', state: 'RUNNING' },
        { id: 't3', state: 'PENDING' },
      ],
    };

    const checkpoint = createCheckpoint(run);
    expect(checkpoint.runId).toBe('run_1');
    expect(checkpoint.state).toBe('EXECUTING');
    expect(checkpoint.taskStates).toEqual({ t1: 'SUCCEEDED', t2: 'RUNNING', t3: 'PENDING' });
  });

  it('counts completed and failed tasks in metadata', () => {
    const run: Run = {
      id: 'run_2',
      state: 'EXECUTING',
      tasks: [
        { id: 't1', state: 'SUCCEEDED' },
        { id: 't2', state: 'SUCCEEDED' },
        { id: 't3', state: 'FAILED' },
        { id: 't4', state: 'RUNNING' },
      ],
    };

    const checkpoint = createCheckpoint(run);
    expect(checkpoint.metadata.taskCount).toBe(4);
    expect(checkpoint.metadata.completedTasks).toBe(2);
    expect(checkpoint.metadata.failedTasks).toBe(1);
  });
});

describe('Checkpoint Restoration', () => {
  it('pauses EXECUTING runs on restore', () => {
    const checkpoint: Checkpoint = {
      id: 'chk_1',
      runId: 'run_1',
      state: 'EXECUTING',
      taskStates: { t1: 'SUCCEEDED', t2: 'RUNNING' },
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    const restored = restoreFromCheckpoint(checkpoint);
    expect(restored.runState).toBe('PAUSED');
  });

  it('re-queues RUNNING tasks for re-dispatch', () => {
    const checkpoint: Checkpoint = {
      id: 'chk_2',
      runId: 'run_2',
      state: 'EXECUTING',
      taskStates: { t1: 'SUCCEEDED', t2: 'RUNNING', t3: 'DISPATCHED', t4: 'PENDING' },
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    const restored = restoreFromCheckpoint(checkpoint);
    expect(restored.taskStates.t1).toBe('SUCCEEDED');  // Completed stays
    expect(restored.taskStates.t2).toBe('QUEUED');       // Running → re-queued
    expect(restored.taskStates.t3).toBe('QUEUED');       // Dispatched → re-queued
    expect(restored.taskStates.t4).toBe('PENDING');      // Pending stays
  });

  it('preserves WAITING_APPROVAL state on restore', () => {
    const checkpoint: Checkpoint = {
      id: 'chk_3',
      runId: 'run_3',
      state: 'WAITING_APPROVAL',
      taskStates: { t1: 'SUCCEEDED' },
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    const restored = restoreFromCheckpoint(checkpoint);
    expect(restored.runState).toBe('WAITING_APPROVAL');
  });

  it('preserves FAILED state on restore', () => {
    const checkpoint: Checkpoint = {
      id: 'chk_4',
      runId: 'run_4',
      state: 'FAILED',
      taskStates: { t1: 'SUCCEEDED', t2: 'FAILED' },
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    const restored = restoreFromCheckpoint(checkpoint);
    expect(restored.runState).toBe('FAILED');
    expect(restored.taskStates.t2).toBe('FAILED');
  });
});

describe('Checkpoint Pruning', () => {
  it('keeps only the most recent N checkpoints', () => {
    const maxCheckpoints = 10;
    const checkpoints: Checkpoint[] = [];

    // Create 15 checkpoints
    for (let i = 0; i < 15; i++) {
      checkpoints.push({
        id: `chk_${i}`,
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: {},
        metadata: {},
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    // Sort by creation time desc, keep only maxCheckpoints
    const sorted = checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pruned = sorted.slice(0, maxCheckpoints);

    expect(pruned.length).toBe(10);
    expect(pruned[0].id).toBe('chk_14'); // Most recent
    expect(pruned[9].id).toBe('chk_5');  // 10th most recent
  });
});
