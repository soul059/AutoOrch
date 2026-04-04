// Dead Letter Queue Tests
// Tests for DLQ retry limits, capture, and management

import { describe, it, expect } from 'vitest';

// ============================================================================
// DEAD LETTER QUEUE LOGIC
// ============================================================================

const MAX_DLQ_RETRIES = 3;

interface DeadLetterEntry {
  id: string;
  taskId: string;
  runId: string;
  error: string;
  capturedAt: Date;
  dlqRetryCount: number;
  originalRetryCount: number;
  status: 'CAPTURED' | 'RETRIED' | 'EXHAUSTED';
}

// Simulates DLQ capture
function captureToDeadLetter(
  taskId: string,
  runId: string,
  error: string,
  originalRetryCount: number
): DeadLetterEntry {
  return {
    id: `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    taskId,
    runId,
    error,
    capturedAt: new Date(),
    dlqRetryCount: 0,
    originalRetryCount,
    status: 'CAPTURED',
  };
}

// Simulates DLQ retry attempt
function attemptDlqRetry(entry: DeadLetterEntry): { success: boolean; reason?: string; updatedEntry: DeadLetterEntry } {
  if (entry.status === 'EXHAUSTED') {
    return {
      success: false,
      reason: 'Entry already exhausted',
      updatedEntry: entry,
    };
  }

  if (entry.status === 'RETRIED') {
    return {
      success: false,
      reason: 'Entry already retried successfully',
      updatedEntry: entry,
    };
  }

  if (entry.dlqRetryCount >= MAX_DLQ_RETRIES) {
    return {
      success: false,
      reason: `DLQ retry limit exceeded (${MAX_DLQ_RETRIES} retries)`,
      updatedEntry: { ...entry, status: 'EXHAUSTED' },
    };
  }

  // Simulate retry success (in real implementation, this would re-queue the task)
  return {
    success: true,
    updatedEntry: {
      ...entry,
      dlqRetryCount: entry.dlqRetryCount + 1,
      status: 'RETRIED',
    },
  };
}

// Check if entry can be retried
function canRetry(entry: DeadLetterEntry): boolean {
  return entry.status === 'CAPTURED' && entry.dlqRetryCount < MAX_DLQ_RETRIES;
}

describe('Dead Letter Queue', () => {
  describe('Capture Behavior', () => {
    it('captures failed tasks with correct metadata', () => {
      const entry = captureToDeadLetter('task_123', 'run_456', 'Connection timeout', 3);
      
      expect(entry.taskId).toBe('task_123');
      expect(entry.runId).toBe('run_456');
      expect(entry.error).toBe('Connection timeout');
      expect(entry.originalRetryCount).toBe(3);
      expect(entry.dlqRetryCount).toBe(0);
      expect(entry.status).toBe('CAPTURED');
    });

    it('generates unique IDs for each entry', () => {
      const entry1 = captureToDeadLetter('task_1', 'run_1', 'error', 0);
      const entry2 = captureToDeadLetter('task_2', 'run_2', 'error', 0);
      
      expect(entry1.id).not.toBe(entry2.id);
    });

    it('sets capturedAt timestamp', () => {
      const before = new Date();
      const entry = captureToDeadLetter('task_1', 'run_1', 'error', 0);
      const after = new Date();
      
      expect(entry.capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry.capturedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('preserves original retry count', () => {
      const entry0 = captureToDeadLetter('task_1', 'run_1', 'error', 0);
      const entry3 = captureToDeadLetter('task_2', 'run_2', 'error', 3);
      
      expect(entry0.originalRetryCount).toBe(0);
      expect(entry3.originalRetryCount).toBe(3);
    });
  });

  describe('Retry Limits', () => {
    it('allows first retry', () => {
      const entry = captureToDeadLetter('task_1', 'run_1', 'error', 0);
      const result = attemptDlqRetry(entry);
      
      expect(result.success).toBe(true);
      expect(result.updatedEntry.dlqRetryCount).toBe(1);
      expect(result.updatedEntry.status).toBe('RETRIED');
    });

    it('blocks retry when limit exceeded', () => {
      const entry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: MAX_DLQ_RETRIES, // Already at limit
        originalRetryCount: 3,
        status: 'CAPTURED',
      };
      
      const result = attemptDlqRetry(entry);
      
      expect(result.success).toBe(false);
      expect(result.reason).toContain('retry limit exceeded');
      expect(result.updatedEntry.status).toBe('EXHAUSTED');
    });

    it('blocks retry when already exhausted', () => {
      const entry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: MAX_DLQ_RETRIES,
        originalRetryCount: 3,
        status: 'EXHAUSTED',
      };
      
      const result = attemptDlqRetry(entry);
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Entry already exhausted');
    });

    it('blocks retry when already successfully retried', () => {
      const entry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: 1,
        originalRetryCount: 3,
        status: 'RETRIED',
      };
      
      const result = attemptDlqRetry(entry);
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Entry already retried successfully');
    });

    it('MAX_DLQ_RETRIES is 3', () => {
      expect(MAX_DLQ_RETRIES).toBe(3);
    });
  });

  describe('Retry Eligibility', () => {
    it('allows retry for fresh captured entry', () => {
      const entry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: 0,
        originalRetryCount: 0,
        status: 'CAPTURED',
      };
      
      expect(canRetry(entry)).toBe(true);
    });

    it('allows retry for entry with retries remaining', () => {
      const entry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: MAX_DLQ_RETRIES - 1,
        originalRetryCount: 0,
        status: 'CAPTURED',
      };
      
      expect(canRetry(entry)).toBe(true);
    });

    it('denies retry for entry at limit', () => {
      const entry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: MAX_DLQ_RETRIES,
        originalRetryCount: 0,
        status: 'CAPTURED',
      };
      
      expect(canRetry(entry)).toBe(false);
    });

    it('denies retry for non-captured status', () => {
      const retriedEntry: DeadLetterEntry = {
        id: 'dlq_1',
        taskId: 'task_1',
        runId: 'run_1',
        error: 'error',
        capturedAt: new Date(),
        dlqRetryCount: 1,
        originalRetryCount: 0,
        status: 'RETRIED',
      };
      
      const exhaustedEntry: DeadLetterEntry = {
        ...retriedEntry,
        status: 'EXHAUSTED',
      };
      
      expect(canRetry(retriedEntry)).toBe(false);
      expect(canRetry(exhaustedEntry)).toBe(false);
    });
  });

  describe('Progressive Retry Tracking', () => {
    it('tracks progressive retries correctly', () => {
      let entry = captureToDeadLetter('task_1', 'run_1', 'error', 0);
      
      // First retry
      let result = attemptDlqRetry(entry);
      expect(result.success).toBe(true);
      entry = { ...result.updatedEntry, status: 'CAPTURED' }; // Reset for next attempt
      
      // Second retry
      result = attemptDlqRetry(entry);
      expect(result.success).toBe(true);
      expect(result.updatedEntry.dlqRetryCount).toBe(2);
      entry = { ...result.updatedEntry, status: 'CAPTURED' };
      
      // Third retry
      result = attemptDlqRetry(entry);
      expect(result.success).toBe(true);
      expect(result.updatedEntry.dlqRetryCount).toBe(3);
      entry = { ...result.updatedEntry, status: 'CAPTURED' };
      
      // Fourth retry should fail
      result = attemptDlqRetry(entry);
      expect(result.success).toBe(false);
      expect(result.updatedEntry.status).toBe('EXHAUSTED');
    });
  });
});

// ============================================================================
// DLQ QUEUE MANAGEMENT
// ============================================================================

interface DLQStats {
  total: number;
  captured: number;
  retried: number;
  exhausted: number;
  byRun: Record<string, number>;
}

function calculateDlqStats(entries: DeadLetterEntry[]): DLQStats {
  return entries.reduce(
    (stats, entry) => {
      stats.total++;
      if (entry.status === 'CAPTURED') stats.captured++;
      if (entry.status === 'RETRIED') stats.retried++;
      if (entry.status === 'EXHAUSTED') stats.exhausted++;
      stats.byRun[entry.runId] = (stats.byRun[entry.runId] || 0) + 1;
      return stats;
    },
    { total: 0, captured: 0, retried: 0, exhausted: 0, byRun: {} as Record<string, number> }
  );
}

describe('DLQ Statistics', () => {
  it('calculates correct totals', () => {
    const entries: DeadLetterEntry[] = [
      { id: '1', taskId: 't1', runId: 'r1', error: 'e', capturedAt: new Date(), dlqRetryCount: 0, originalRetryCount: 0, status: 'CAPTURED' },
      { id: '2', taskId: 't2', runId: 'r1', error: 'e', capturedAt: new Date(), dlqRetryCount: 1, originalRetryCount: 0, status: 'RETRIED' },
      { id: '3', taskId: 't3', runId: 'r2', error: 'e', capturedAt: new Date(), dlqRetryCount: 3, originalRetryCount: 0, status: 'EXHAUSTED' },
    ];
    
    const stats = calculateDlqStats(entries);
    
    expect(stats.total).toBe(3);
    expect(stats.captured).toBe(1);
    expect(stats.retried).toBe(1);
    expect(stats.exhausted).toBe(1);
  });

  it('groups by run ID', () => {
    const entries: DeadLetterEntry[] = [
      { id: '1', taskId: 't1', runId: 'run_A', error: 'e', capturedAt: new Date(), dlqRetryCount: 0, originalRetryCount: 0, status: 'CAPTURED' },
      { id: '2', taskId: 't2', runId: 'run_A', error: 'e', capturedAt: new Date(), dlqRetryCount: 0, originalRetryCount: 0, status: 'CAPTURED' },
      { id: '3', taskId: 't3', runId: 'run_B', error: 'e', capturedAt: new Date(), dlqRetryCount: 0, originalRetryCount: 0, status: 'CAPTURED' },
    ];
    
    const stats = calculateDlqStats(entries);
    
    expect(stats.byRun['run_A']).toBe(2);
    expect(stats.byRun['run_B']).toBe(1);
  });

  it('handles empty queue', () => {
    const stats = calculateDlqStats([]);
    
    expect(stats.total).toBe(0);
    expect(stats.captured).toBe(0);
    expect(stats.retried).toBe(0);
    expect(stats.exhausted).toBe(0);
    expect(Object.keys(stats.byRun).length).toBe(0);
  });
});
