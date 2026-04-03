import { Pool } from 'pg';

export interface DeadLetterEntry {
  id: string;
  runId: string;
  taskId: string;
  failureType: string;
  failureMessage: string;
  retryCount: number;
  maxRetries: number;
  dlqRetryCount: number;  // Track how many times this has been retried from DLQ
  taskInput: Record<string, unknown>;
  createdAt: Date;
  retriedAt: Date | null;
}

// Maximum times a task can be retried from the dead-letter queue
const MAX_DLQ_RETRIES = 3;

export class DeadLetterHandler {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Move a permanently failed task to the dead-letter queue
  async enqueue(taskId: string): Promise<string> {
    const task = await this.pool.query(
      `SELECT t.*, r.correlation_id FROM tasks t
       JOIN runs r ON t.run_id = r.id
       WHERE t.id = $1 AND t.state = 'FAILED'`,
      [taskId]
    );

    if (task.rows.length === 0) {
      throw new Error(`Task ${taskId} not found or not in FAILED state`);
    }

    const t = task.rows[0];

    const result = await this.pool.query(
      `INSERT INTO dead_letter_queue (task_id, run_id, failure_type, failure_message, retry_count, max_retries, task_input, agent_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [taskId, t.run_id, t.failure_type, t.failure_message, t.retry_count, t.max_retries, JSON.stringify(t.input), t.agent_role]
    );

    // Audit the dead-letter
    await this.pool.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       VALUES ($1, $2, $3, 'DEAD_LETTER', $4)`,
      [t.run_id, taskId, t.correlation_id, JSON.stringify({
        deadLetterId: result.rows[0].id,
        failureType: t.failure_type,
        failureMessage: t.failure_message,
        retryCount: t.retry_count,
        maxRetries: t.max_retries,
      })]
    );

    return result.rows[0].id;
  }

  // List all entries in the dead-letter queue
  async list(limit = 50): Promise<DeadLetterEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM dead_letter_queue ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  // List dead-letter entries for a specific run
  async listByRun(runId: string): Promise<DeadLetterEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM dead_letter_queue WHERE run_id = $1 ORDER BY created_at DESC`,
      [runId]
    );
    return result.rows;
  }

  // Retry a dead-letter entry (re-queue the task) with retry limit
  async retry(deadLetterId: string): Promise<{ success: boolean; reason?: string }> {
    const entry = await this.pool.query(
      'SELECT * FROM dead_letter_queue WHERE id = $1',
      [deadLetterId]
    );

    if (entry.rows.length === 0) {
      return { success: false, reason: 'Dead-letter entry not found' };
    }

    const dlEntry = entry.rows[0];
    const dlqRetryCount = dlEntry.dlq_retry_count || 0;

    // Check if already retried maximum times
    if (dlqRetryCount >= MAX_DLQ_RETRIES) {
      return { 
        success: false, 
        reason: `Maximum DLQ retries (${MAX_DLQ_RETRIES}) exceeded. Task has been retried ${dlqRetryCount} times from dead-letter queue.` 
      };
    }

    // Check if task is no longer in FAILED state (already retried successfully or manually)
    const taskCheck = await this.pool.query(
      'SELECT state FROM tasks WHERE id = $1',
      [dlEntry.task_id]
    );
    if (taskCheck.rows.length > 0 && taskCheck.rows[0].state !== 'FAILED') {
      return { 
        success: false, 
        reason: `Task is no longer in FAILED state (current state: ${taskCheck.rows[0].state}). Cannot retry.` 
      };
    }

    // Re-queue the task with reset retry count (normal retries reset, but track DLQ retries)
    await this.pool.query(
      `UPDATE tasks SET state = 'QUEUED', retry_count = 0, failure_type = NULL, failure_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [dlEntry.task_id]
    );

    // Mark dead-letter as retried and increment DLQ retry counter
    await this.pool.query(
      `UPDATE dead_letter_queue SET retried_at = NOW(), dlq_retry_count = $1 WHERE id = $2`,
      [dlqRetryCount + 1, deadLetterId]
    );

    // Audit the retry
    await this.pool.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       SELECT $1, $2, r.correlation_id, 'DEAD_LETTER_RETRY', $3
       FROM runs r WHERE r.id = $1`,
      [dlEntry.run_id, dlEntry.task_id, JSON.stringify({ 
        deadLetterId, 
        dlqRetryCount: dlqRetryCount + 1,
        maxDlqRetries: MAX_DLQ_RETRIES 
      })]
    );

    return { success: true };
  }

  // Purge old dead-letter entries (older than given days)
  async purge(olderThanDays = 30): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM dead_letter_queue WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [olderThanDays]
    );
    return result.rowCount || 0;
  }

  // Discard/delete a single dead-letter entry
  async discard(deadLetterId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM dead_letter_queue WHERE id = $1',
      [deadLetterId]
    );
    return (result.rowCount || 0) > 0;
  }

  // Count entries in the dead-letter queue
  async count(): Promise<number> {
    const result = await this.pool.query(
      'SELECT COUNT(*) as count FROM dead_letter_queue WHERE retried_at IS NULL'
    );
    return parseInt(result.rows[0].count, 10);
  }
}

export function createDeadLetterHandler(pool: Pool): DeadLetterHandler {
  return new DeadLetterHandler(pool);
}
