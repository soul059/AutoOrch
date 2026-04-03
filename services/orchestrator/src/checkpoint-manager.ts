import { Pool } from 'pg';

export class CheckpointManager {
  private pool: Pool;
  private maxCheckpoints: number;

  constructor(pool: Pool, maxCheckpoints = 10) {
    this.pool = pool;
    this.maxCheckpoints = maxCheckpoints;
  }

  // Create a checkpoint capturing the full run state
  async createCheckpoint(runId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const run = await client.query('SELECT * FROM runs WHERE id = $1', [runId]);
      if (run.rows.length === 0) throw new Error(`Run ${runId} not found`);

      const tasks = await client.query(
        'SELECT id, state, output, provider_id, token_usage FROM tasks WHERE run_id = $1',
        [runId]
      );

      const taskStates: Record<string, string> = {};
      const completedOutputs: Record<string, Record<string, unknown>> = {};
      const providerSelections: Record<string, string> = {};
      let totalTokens = 0;
      let totalCost = 0;

      for (const t of tasks.rows) {
        taskStates[t.id] = t.state;
        if (t.output) completedOutputs[t.id] = t.output;
        if (t.provider_id) providerSelections[t.id] = t.provider_id;
        if (t.token_usage) {
          totalTokens += t.token_usage.totalTokens || 0;
          totalCost += t.token_usage.costUsd || 0;
        }
      }

      const seqResult = await client.query(
        'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq FROM checkpoints WHERE run_id = $1',
        [runId]
      );

      const result = await client.query(
        `INSERT INTO checkpoints (run_id, sequence_number, run_state, task_states, completed_outputs, provider_selections, budget_usage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          runId,
          seqResult.rows[0].next_seq,
          run.rows[0].state,
          JSON.stringify(taskStates),
          JSON.stringify(completedOutputs),
          JSON.stringify(providerSelections),
          JSON.stringify({ totalTokens, totalCostUsd: totalCost, loopIterations: 0 }),
        ]
      );

      // Prune old checkpoints
      await client.query(
        `DELETE FROM checkpoints WHERE run_id = $1 AND id NOT IN (
           SELECT id FROM checkpoints WHERE run_id = $1 ORDER BY sequence_number DESC LIMIT $2
         )`,
        [runId, this.maxCheckpoints]
      );

      // Update run with latest checkpoint reference
      await client.query(
        'UPDATE runs SET checkpoint_id = $1 WHERE id = $2',
        [result.rows[0].id, runId]
      );

      await client.query('COMMIT');
      return result.rows[0].id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Load the latest checkpoint for a run
  async loadLatestCheckpoint(runId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      'SELECT * FROM checkpoints WHERE run_id = $1 ORDER BY sequence_number DESC LIMIT 1',
      [runId]
    );
    return result.rows[0] || null;
  }

  // Resume from a specific checkpoint (guarded against double-restore with checkpoint ID tracking)
  async resumeFromCheckpoint(runId: string, checkpointId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Lock the run to prevent concurrent restorations
      const run = await client.query(
        'SELECT checkpoint_id, last_restored_checkpoint_id, state FROM runs WHERE id = $1 FOR UPDATE',
        [runId]
      );

      if (run.rows.length === 0) {
        throw new Error(`Run ${runId} not found`);
      }

      // Guard: prevent restoring the same checkpoint twice using persistent tracking
      if (run.rows[0]?.last_restored_checkpoint_id === checkpointId) {
        await client.query('COMMIT');
        throw new Error(`Checkpoint ${checkpointId} was already restored for run ${runId}. Create a new checkpoint first.`);
      }

      // Validate run state allows restoration
      const state = run.rows[0].state;
      if (!['FAILED', 'CANCELLED', 'PAUSED'].includes(state)) {
        await client.query('COMMIT');
        throw new Error(`Cannot restore checkpoint while run is in ${state} state. Run must be FAILED, CANCELLED, or PAUSED.`);
      }

      const checkpoint = await client.query(
        'SELECT * FROM checkpoints WHERE id = $1 AND run_id = $2',
        [checkpointId, runId]
      );

      if (checkpoint.rows.length === 0) {
        await client.query('COMMIT');
        throw new Error(`Checkpoint ${checkpointId} not found for run ${runId}`);
      }

      const cp = checkpoint.rows[0];
      const taskStates = cp.task_states as Record<string, string>;

      // Re-queue failed and pending tasks, leave succeeded tasks alone
      for (const [taskId, state] of Object.entries(taskStates)) {
        if (state === 'FAILED' || state === 'PENDING') {
          await client.query(
            "UPDATE tasks SET state = 'PENDING', retry_count = 0, failure_type = NULL, failure_message = NULL, updated_at = NOW() WHERE id = $1",
            [taskId]
          );
        }
      }

      // Update run with the restored checkpoint ID to prevent duplicate restoration
      await client.query(
        "UPDATE runs SET last_restored_checkpoint_id = $1, state = 'PLANNING', updated_at = NOW() WHERE id = $2",
        [checkpointId, runId]
      );

      // Record the restoration event
      await client.query(
        `INSERT INTO audit_events (run_id, correlation_id, event_type, payload)
         SELECT $1, r.correlation_id, 'CHECKPOINT_RESTORED', $2
         FROM runs r WHERE r.id = $1`,
        [runId, JSON.stringify({ checkpointId, previousState: state, restoredAt: new Date().toISOString() })]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export function createCheckpointManager(pool: Pool, maxCheckpoints = 10): CheckpointManager {
  return new CheckpointManager(pool, maxCheckpoints);
}
