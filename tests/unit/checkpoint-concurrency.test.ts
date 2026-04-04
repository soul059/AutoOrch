// Checkpoint Concurrency Tests
// Tests for double-restore prevention and idempotent checkpoint operations

import { describe, it, expect } from 'vitest';

// ============================================================================
// CHECKPOINT IDEMPOTENCY
// ============================================================================

interface Run {
  id: string;
  state: string;
  lastRestoredCheckpointId: string | null;
}

interface Checkpoint {
  id: string;
  runId: string;
  state: string;
  taskStates: Record<string, string>;
  createdAt: Date;
}

// Valid states for checkpoint restoration
const RESTORABLE_RUN_STATES = ['FAILED', 'CANCELLED', 'PAUSED'];

// Simulates the double-restore prevention logic
function canRestoreCheckpoint(run: Run, checkpoint: Checkpoint): { allowed: boolean; reason?: string } {
  // Verify checkpoint belongs to this run
  if (checkpoint.runId !== run.id) {
    return { allowed: false, reason: 'Checkpoint belongs to different run' };
  }

  // Verify run is in a valid state for restoration
  if (!RESTORABLE_RUN_STATES.includes(run.state)) {
    return { allowed: false, reason: `Cannot restore while run is in ${run.state} state` };
  }

  // Check if this exact checkpoint was already restored (idempotency check)
  if (run.lastRestoredCheckpointId === checkpoint.id) {
    return { allowed: false, reason: 'Checkpoint already restored (idempotent rejection)' };
  }

  return { allowed: true };
}

// Simulates checkpoint restoration with state update
function restoreCheckpoint(
  run: Run,
  checkpoint: Checkpoint
): { success: boolean; newRunState: string; newTaskStates: Record<string, string>; reason?: string } {
  const canRestore = canRestoreCheckpoint(run, checkpoint);
  if (!canRestore.allowed) {
    return {
      success: false,
      newRunState: run.state,
      newTaskStates: {},
      reason: canRestore.reason,
    };
  }

  // Calculate new states
  const newRunState = checkpoint.state === 'EXECUTING' ? 'PAUSED' : checkpoint.state;
  
  const newTaskStates: Record<string, string> = {};
  for (const [taskId, state] of Object.entries(checkpoint.taskStates)) {
    if (state === 'RUNNING' || state === 'DISPATCHED') {
      newTaskStates[taskId] = 'QUEUED';
    } else {
      newTaskStates[taskId] = state;
    }
  }

  return {
    success: true,
    newRunState,
    newTaskStates,
  };
}

describe('Checkpoint Double-Restore Prevention', () => {
  describe('Idempotency Check', () => {
    it('blocks restoration of already-restored checkpoint', () => {
      const run: Run = {
        id: 'run_1',
        state: 'FAILED',
        lastRestoredCheckpointId: 'chk_123',
      };
      
      const checkpoint: Checkpoint = {
        id: 'chk_123', // Same as lastRestoredCheckpointId
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: {},
        createdAt: new Date(),
      };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('already restored');
    });

    it('allows restoration of different checkpoint', () => {
      const run: Run = {
        id: 'run_1',
        state: 'FAILED',
        lastRestoredCheckpointId: 'chk_old',
      };
      
      const checkpoint: Checkpoint = {
        id: 'chk_new', // Different from lastRestoredCheckpointId
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: {},
        createdAt: new Date(),
      };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      
      expect(result.allowed).toBe(true);
    });

    it('allows first restoration when lastRestoredCheckpointId is null', () => {
      const run: Run = {
        id: 'run_1',
        state: 'FAILED',
        lastRestoredCheckpointId: null, // Never restored before
      };
      
      const checkpoint: Checkpoint = {
        id: 'chk_first',
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: {},
        createdAt: new Date(),
      };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('Run State Validation', () => {
    it('allows restoration from FAILED state', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
      
      expect(canRestoreCheckpoint(run, checkpoint).allowed).toBe(true);
    });

    it('allows restoration from CANCELLED state', () => {
      const run: Run = { id: 'run_1', state: 'CANCELLED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
      
      expect(canRestoreCheckpoint(run, checkpoint).allowed).toBe(true);
    });

    it('allows restoration from PAUSED state', () => {
      const run: Run = { id: 'run_1', state: 'PAUSED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
      
      expect(canRestoreCheckpoint(run, checkpoint).allowed).toBe(true);
    });

    it('blocks restoration from EXECUTING state', () => {
      const run: Run = { id: 'run_1', state: 'EXECUTING', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('EXECUTING');
    });

    it('blocks restoration from PLANNING state', () => {
      const run: Run = { id: 'run_1', state: 'PLANNING', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      expect(result.allowed).toBe(false);
    });

    it('blocks restoration from COMPLETED state', () => {
      const run: Run = { id: 'run_1', state: 'COMPLETED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Run-Checkpoint Ownership', () => {
    it('blocks restoration of checkpoint from different run', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_OTHER', // Different run!
        state: 'EXECUTING',
        taskStates: {},
        createdAt: new Date(),
      };
      
      const result = canRestoreCheckpoint(run, checkpoint);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('different run');
    });
  });
});

describe('Checkpoint Restoration', () => {
  describe('State Transformation', () => {
    it('converts EXECUTING to PAUSED on restore', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: { t1: 'SUCCEEDED', t2: 'RUNNING' },
        createdAt: new Date(),
      };
      
      const result = restoreCheckpoint(run, checkpoint);
      
      expect(result.success).toBe(true);
      expect(result.newRunState).toBe('PAUSED');
    });

    it('preserves non-EXECUTING states', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_1',
        state: 'WAITING_APPROVAL',
        taskStates: {},
        createdAt: new Date(),
      };
      
      const result = restoreCheckpoint(run, checkpoint);
      
      expect(result.success).toBe(true);
      expect(result.newRunState).toBe('WAITING_APPROVAL');
    });

    it('re-queues RUNNING tasks', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: { t1: 'RUNNING', t2: 'DISPATCHED' },
        createdAt: new Date(),
      };
      
      const result = restoreCheckpoint(run, checkpoint);
      
      expect(result.newTaskStates['t1']).toBe('QUEUED');
      expect(result.newTaskStates['t2']).toBe('QUEUED');
    });

    it('preserves terminal task states', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: { t1: 'SUCCEEDED', t2: 'FAILED', t3: 'SKIPPED' },
        createdAt: new Date(),
      };
      
      const result = restoreCheckpoint(run, checkpoint);
      
      expect(result.newTaskStates['t1']).toBe('SUCCEEDED');
      expect(result.newTaskStates['t2']).toBe('FAILED');
      expect(result.newTaskStates['t3']).toBe('SKIPPED');
    });

    it('preserves PENDING task states', () => {
      const run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: { t1: 'PENDING', t2: 'QUEUED' },
        createdAt: new Date(),
      };
      
      const result = restoreCheckpoint(run, checkpoint);
      
      expect(result.newTaskStates['t1']).toBe('PENDING');
      expect(result.newTaskStates['t2']).toBe('QUEUED');
    });
  });

  describe('Failed Restoration', () => {
    it('returns original state on failed restoration', () => {
      const run: Run = { id: 'run_1', state: 'EXECUTING', lastRestoredCheckpointId: null }; // Invalid state
      const checkpoint: Checkpoint = {
        id: 'chk_1',
        runId: 'run_1',
        state: 'EXECUTING',
        taskStates: {},
        createdAt: new Date(),
      };
      
      const result = restoreCheckpoint(run, checkpoint);
      
      expect(result.success).toBe(false);
      expect(result.newRunState).toBe('EXECUTING'); // Unchanged
      expect(result.reason).toBeDefined();
    });
  });
});

// ============================================================================
// CONCURRENT RESTORATION SIMULATION
// ============================================================================

describe('Concurrent Restoration Simulation', () => {
  it('only first concurrent restore succeeds (simulated SERIALIZABLE)', () => {
    // Simulate two concurrent restore attempts
    let run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
    const checkpoint: Checkpoint = {
      id: 'chk_concurrent',
      runId: 'run_1',
      state: 'EXECUTING',
      taskStates: {},
      createdAt: new Date(),
    };

    // First restore attempt (succeeds)
    const result1 = canRestoreCheckpoint(run, checkpoint);
    expect(result1.allowed).toBe(true);
    
    // Simulate database update after first restore
    run = { ...run, state: 'PAUSED', lastRestoredCheckpointId: 'chk_concurrent' };

    // Second restore attempt with same checkpoint (should fail due to idempotency)
    const result2 = canRestoreCheckpoint(run, checkpoint);
    expect(result2.allowed).toBe(false);
    expect(result2.reason).toContain('already restored');
  });

  it('handles multiple checkpoints for same run correctly', () => {
    let run: Run = { id: 'run_1', state: 'FAILED', lastRestoredCheckpointId: null };
    
    const checkpoint1: Checkpoint = { id: 'chk_1', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
    const checkpoint2: Checkpoint = { id: 'chk_2', runId: 'run_1', state: 'EXECUTING', taskStates: {}, createdAt: new Date() };
    
    // Restore checkpoint 1
    expect(canRestoreCheckpoint(run, checkpoint1).allowed).toBe(true);
    run = { ...run, state: 'PAUSED', lastRestoredCheckpointId: 'chk_1' };
    
    // Make run fail again
    run = { ...run, state: 'FAILED' };
    
    // Can restore checkpoint 2 (different checkpoint)
    expect(canRestoreCheckpoint(run, checkpoint2).allowed).toBe(true);
    
    // Cannot restore checkpoint 1 again
    expect(canRestoreCheckpoint(run, checkpoint1).allowed).toBe(false);
  });
});
