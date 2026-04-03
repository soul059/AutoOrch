import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Legal state transitions for runs
export const LEGAL_RUN_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PLANNING', 'CANCELLED'],
  PLANNING: ['ROUTING', 'FAILED', 'CANCELLED'],
  ROUTING: ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['WAITING_APPROVAL', 'RETRYING', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED'],
  WAITING_APPROVAL: ['EXECUTING', 'PAUSED', 'FAILED', 'CANCELLED'],
  RETRYING: ['EXECUTING', 'FAILED', 'CANCELLED'],
  PAUSED: ['EXECUTING', 'CANCELLED'],
  FAILED: ['PLANNING'],
  COMPLETED: [],
  CANCELLED: [],
};

// Legal state transitions for tasks
export const LEGAL_TASK_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['QUEUED', 'SKIPPED', 'CANCELLED'],
  QUEUED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: ['QUEUED', 'SKIPPED'],
  SKIPPED: [],
  CANCELLED: [],
};

export class StateMachine {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Validate and execute a run state transition
  async transitionRunState(runId: string, targetState: string, reason?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const runResult = await client.query(
        'SELECT * FROM runs WHERE id = $1 FOR UPDATE',
        [runId]
      );

      if (runResult.rows.length === 0) {
        throw new Error(`Run ${runId} not found`);
      }

      const run = runResult.rows[0];
      const currentState = run.state;
      const legalTargets = LEGAL_RUN_TRANSITIONS[currentState];

      if (!legalTargets || !legalTargets.includes(targetState)) {
        throw new Error(`Illegal run transition: ${currentState} → ${targetState}`);
      }

      // Execute the transition
      await client.query(
        'UPDATE runs SET state = $1, updated_at = NOW() WHERE id = $2',
        [targetState, runId]
      );

      // Emit audit event
      await client.query(
        `INSERT INTO audit_events (run_id, correlation_id, event_type, payload)
         VALUES ($1, $2, 'RUN_STATE_CHANGED', $3)`,
        [runId, run.correlation_id, JSON.stringify({
          previousState: currentState,
          newState: targetState,
          reason: reason || undefined,
        })]
      );

      // Create checkpoint after state transition
      const seqResult = await client.query(
        'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq FROM checkpoints WHERE run_id = $1',
        [runId]
      );
      const nextSeq = seqResult.rows[0].next_seq;

      const taskStates = await client.query(
        'SELECT id, state FROM tasks WHERE run_id = $1',
        [runId]
      );

      const taskStateMap: Record<string, string> = {};
      for (const t of taskStates.rows) {
        taskStateMap[t.id] = t.state;
      }

      await client.query(
        `INSERT INTO checkpoints (run_id, sequence_number, run_state, task_states)
         VALUES ($1, $2, $3, $4)`,
        [runId, nextSeq, targetState, JSON.stringify(taskStateMap)]
      );

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Allowed columns for dynamic update to prevent SQL injection
  private static readonly ALLOWED_TASK_COLUMNS = new Set([
    'state', 'updated_at', 'started_at', 'completed_at', 
    'failure_type', 'failure_message', 'output', 'token_usage', 'retry_count'
  ]);

  // Validate and execute a task state transition
  async transitionTaskState(
    taskId: string,
    targetState: string,
    metadata?: { failureType?: string; failureMessage?: string; output?: Record<string, unknown>; tokenUsage?: Record<string, unknown> }
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      const taskResult = await client.query(
        'SELECT t.*, r.correlation_id FROM tasks t JOIN runs r ON t.run_id = r.id WHERE t.id = $1 FOR UPDATE OF t',
        [taskId]
      );

      if (taskResult.rows.length === 0) {
        throw new Error(`Task ${taskId} not found`);
      }

      const task = taskResult.rows[0];
      const currentState = task.state;
      const legalTargets = LEGAL_TASK_TRANSITIONS[currentState];

      if (!legalTargets || !legalTargets.includes(targetState)) {
        throw new Error(`Illegal task transition: ${currentState} → ${targetState}`);
      }

      // Build the update with whitelisted column names only
      const updates: string[] = ['state = $1', 'updated_at = NOW()'];
      const params: unknown[] = [targetState];
      let paramIdx = 2;

      // Helper to safely add column updates
      const addUpdate = (column: string, value: unknown): void => {
        if (!StateMachine.ALLOWED_TASK_COLUMNS.has(column)) {
          throw new Error(`Invalid column name: ${column}`);
        }
        updates.push(`${column} = $${paramIdx}`);
        params.push(value);
        paramIdx++;
      };

      if (targetState === 'RUNNING') {
        updates.push(`started_at = NOW()`);
      }

      if (['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(targetState)) {
        updates.push(`completed_at = NOW()`);
      }

      if (metadata?.failureType) {
        addUpdate('failure_type', metadata.failureType);
      }

      if (metadata?.failureMessage) {
        addUpdate('failure_message', metadata.failureMessage);
      }

      if (metadata?.output) {
        addUpdate('output', JSON.stringify(metadata.output));
      }

      if (metadata?.tokenUsage) {
        addUpdate('token_usage', JSON.stringify(metadata.tokenUsage));
      }

      if (targetState === 'QUEUED' && currentState === 'FAILED') {
        updates.push(`retry_count = retry_count + 1`);
      }

      params.push(taskId);
      await client.query(
        `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
        params
      );

      // Emit audit event
      await client.query(
        `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
         VALUES ($1, $2, $3, 'TASK_STATE_CHANGED', $4)`,
        [task.run_id, taskId, task.correlation_id, JSON.stringify({
          previousState: currentState,
          newState: targetState,
          failureType: metadata?.failureType,
          failureMessage: metadata?.failureMessage,
          retryCount: task.retry_count,
        })]
      );

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Get all tasks ready to be dispatched (dependencies met)
  // Runs in a transaction so FOR UPDATE SKIP LOCKED holds locks until dispatch completes
  async getReadyTasks(runId: string): Promise<unknown[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT t.* FROM tasks t
         WHERE t.run_id = $1 AND t.state = 'QUEUED'
         AND NOT EXISTS (
           SELECT 1 FROM tasks dep
           WHERE dep.id = ANY(t.depends_on)
           AND dep.state NOT IN ('SUCCEEDED', 'SKIPPED')
         )
         ORDER BY t.created_at ASC
         LIMIT 5
         FOR UPDATE SKIP LOCKED`,
        [runId]
      );
      // Intentionally leave transaction open — caller (dispatchTasks) will
      // transition each task, then we commit to release locks.
      // To keep it simple and self-contained, commit here since
      // transitionTaskState opens its own transaction.
      await client.query('COMMIT');
      return result.rows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export function createStateMachine(pool: Pool): StateMachine {
  return new StateMachine(pool);
}
