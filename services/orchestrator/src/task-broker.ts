import { Pool } from 'pg';
import { StateMachine } from './state-machine.js';

export class TaskBroker {
  private pool: Pool;
  private stateMachine: StateMachine;
  private maxConcurrent: number;

  constructor(pool: Pool, stateMachine: StateMachine, maxConcurrent = 5) {
    this.pool = pool;
    this.stateMachine = stateMachine;
    this.maxConcurrent = maxConcurrent;
  }

  // Recover orphaned tasks on startup with advisory lock to prevent races in multi-instance deployments.
  // Only recovers tasks that have been stalled for at least 2 minutes (grace period).
  async recoverOrphanedTasks(): Promise<number> {
    const client = await this.pool.connect();
    try {
      // Advisory lock: only one instance can run recovery at a time (lock id = 42001)
      const lockResult = await client.query('SELECT pg_try_advisory_lock(42001) AS acquired');
      if (!lockResult.rows[0].acquired) {
        console.log('[TaskBroker] Recovery already running on another instance, skipping');
        return 0;
      }

      try {
        const result = await client.query(
          `UPDATE tasks SET state = 'QUEUED', updated_at = NOW()
           WHERE state IN ('DISPATCHED', 'RUNNING')
           AND updated_at < NOW() - INTERVAL '2 minutes'
           RETURNING id, run_id`
        );

        if (result.rows.length > 0) {
          console.log(`[TaskBroker] Recovered ${result.rows.length} orphaned tasks (stalled > 2min)`);
          for (const row of result.rows) {
            await client.query(
              `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
               SELECT $1, $2, r.correlation_id, 'TASK_STATE_CHANGED', $3
               FROM runs r WHERE r.id = $1`,
              [row.run_id, row.id, JSON.stringify({
                previousState: 'ORPHANED', newState: 'QUEUED', reason: 'Startup recovery (stalled > 2min)'
              })]
            );
          }
        }

        return result.rows.length;
      } finally {
        await client.query('SELECT pg_advisory_unlock(42001)');
      }
    } finally {
      client.release();
    }
  }

  // Create tasks from a planned task graph (transactional — all or nothing)
  // dependsOn can be either task UUIDs (strings) or task indices (numbers)
  // When indices are used, they refer to the position in the tasks array
  async createTasksFromPlan(runId: string, tasks: Array<{
    agentRole: string;
    input: Record<string, unknown>;
    dependsOn?: (string | number)[];
    maxRetries?: number;
  }>): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const taskIds: string[] = [];

      console.log(`[TaskBroker] Creating ${tasks.length} tasks for run ${runId}`);
      tasks.forEach((t, i) => {
        console.log(`  Task ${i}: ${t.agentRole}, dependsOn: ${JSON.stringify(t.dependsOn)}`);
      });

      // First pass: Create all tasks without dependencies
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const result = await client.query(
          `INSERT INTO tasks (run_id, agent_role_name, state, depends_on, input, max_retries, sequence_index)
           VALUES ($1, $2, 'PENDING', '{}', $3, $4, $5)
           RETURNING id`,
          [
            runId,
            task.agentRole,
            JSON.stringify(task.input),
            task.maxRetries || 3,
            i, // Store sequence index for later reference
          ]
        );
        taskIds.push(result.rows[0].id);
        console.log(`  Created task ${i} (${task.agentRole}): id=${result.rows[0].id}`);
      }

      // Second pass: Update dependencies (convert indices to UUIDs)
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (task.dependsOn && task.dependsOn.length > 0) {
          // Convert index-based dependencies to UUID-based
          const resolvedDeps: string[] = task.dependsOn.map(dep => {
            if (typeof dep === 'number') {
              // It's an index, resolve to the actual task ID
              if (dep >= 0 && dep < taskIds.length) {
                return taskIds[dep];
              }
              throw new Error(`Invalid dependency index: ${dep}`);
            }
            // It's already a UUID string
            return dep;
          });

          console.log(`  Updating task ${i} (${task.agentRole}) depends_on to: [${resolvedDeps.map(d => d.slice(0,8)).join(', ')}]`);

          // PostgreSQL requires explicit array casting for UUID[] columns
          await client.query(
            `UPDATE tasks SET depends_on = $1::uuid[] WHERE id = $2`,
            [resolvedDeps, taskIds[i]]
          );
        }
      }

      await client.query('COMMIT');
      console.log(`[TaskBroker] Successfully created ${taskIds.length} tasks`);
      return taskIds;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[TaskBroker] Failed to create tasks:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  // Queue all pending tasks whose dependencies are met
  async queueReadyTasks(runId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const run = await client.query('SELECT correlation_id FROM runs WHERE id = $1', [runId]);
      const correlationId = run.rows[0]?.correlation_id;

      // Debug: Log pending tasks and their dependencies
      const pendingTasks = await client.query(
        `SELECT id, COALESCE(agent_role_name, agent_role::text) as agent_role, depends_on, state FROM tasks WHERE run_id = $1 AND state = 'PENDING'`,
        [runId]
      );
      console.log(`[TaskBroker] queueReadyTasks for run ${runId}: ${pendingTasks.rows.length} pending tasks`);
      for (const t of pendingTasks.rows) {
        console.log(`  - Task ${t.id.slice(0,8)} (${t.agent_role}): depends_on = ${JSON.stringify(t.depends_on)}`);
      }
      
      // Debug: Log all tasks with their states
      const allTasks = await client.query(
        `SELECT id, COALESCE(agent_role_name, agent_role::text) as agent_role, state, depends_on FROM tasks WHERE run_id = $1 ORDER BY sequence_index`,
        [runId]
      );
      console.log(`[TaskBroker] All tasks for run ${runId}:`);
      for (const t of allTasks.rows) {
        console.log(`  - ${t.agent_role} (${t.state}): id=${t.id.slice(0,8)}, depends_on=${JSON.stringify(t.depends_on)}`);
      }

      const result = await client.query(
        `UPDATE tasks SET state = 'QUEUED', updated_at = NOW()
         WHERE run_id = $1 AND state = 'PENDING'
         AND NOT EXISTS (
           SELECT 1 FROM tasks dep
           WHERE dep.id = ANY(tasks.depends_on)
           AND dep.state NOT IN ('SUCCEEDED', 'SKIPPED')
         )
         RETURNING id, COALESCE(agent_role_name, agent_role::text) as agent_role`,
        [runId]
      );

      console.log(`[TaskBroker] Queued ${result.rows.length} tasks: ${result.rows.map((r: any) => r.agent_role).join(', ')}`);

      for (const row of result.rows) {
        await client.query(
          `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
           VALUES ($1, $2, $3, 'TASK_STATE_CHANGED', $4)`,
          [runId, row.id, correlationId, JSON.stringify({
            previousState: 'PENDING', newState: 'QUEUED'
          })]
        );
      }

      await client.query('COMMIT');
      return result.rows.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Dispatch queued tasks up to concurrency limit (single transaction for atomicity)
  async dispatchTasks(runId: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Count active tasks atomically within the same transaction
      const activeResult = await client.query(
        `SELECT COUNT(*) as count FROM tasks WHERE run_id = $1 AND state IN ('DISPATCHED', 'RUNNING')`,
        [runId]
      );
      const activeCount = parseInt(activeResult.rows[0].count, 10);
      const available = this.maxConcurrent - activeCount;

      if (available <= 0) {
        await client.query('COMMIT');
        return [];
      }

      // Select and lock ready tasks within the same transaction
      const readyResult = await client.query(
        `SELECT t.* FROM tasks t
         WHERE t.run_id = $1 AND t.state = 'QUEUED'
         AND NOT EXISTS (
           SELECT 1 FROM tasks dep
           WHERE dep.id = ANY(t.depends_on)
           AND dep.state NOT IN ('SUCCEEDED', 'SKIPPED')
         )
         ORDER BY t.created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [runId, available]
      );

      const dispatched: string[] = [];
      for (const task of readyResult.rows) {
        await client.query(
          `UPDATE tasks SET state = 'DISPATCHED', updated_at = NOW() WHERE id = $1`,
          [task.id]
        );
        await client.query(
          `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
           SELECT $1, $2, r.correlation_id, 'TASK_STATE_CHANGED', $3
           FROM runs r WHERE r.id = $1`,
          [runId, task.id, JSON.stringify({
            previousState: 'QUEUED', newState: 'DISPATCHED'
          })]
        );
        dispatched.push(task.id);
      }

      await client.query('COMMIT');
      return dispatched;
    } catch (err) {
      await client.query('ROLLBACK');
      // Serialization failure is expected under concurrency — retry handled by caller
      if ((err as { code?: string }).code === '40001') return [];
      throw err;
    } finally {
      client.release();
    }
  }

  // Handle task completion
  async completeTask(taskId: string, output: Record<string, unknown>, tokenUsage?: Record<string, unknown>): Promise<void> {
    await this.stateMachine.transitionTaskState(taskId, 'SUCCEEDED', { output, tokenUsage });
  }

  // Handle task failure with retry logic
  // Includes cooldown period to let resources (GPU VRAM) recover
  async failTask(taskId: string, failureType: string, failureMessage: string): Promise<boolean> {
    const task = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (task.rows.length === 0) return false;

    const t = task.rows[0];
    const retryable = ['PROVIDER_ERROR', 'TIMEOUT', 'INVALID_OUTPUT'].includes(failureType);

    if (retryable && t.retry_count < t.max_retries) {
      // Mark as failed then re-queue for retry
      await this.stateMachine.transitionTaskState(taskId, 'FAILED', { failureType, failureMessage });
      
      // Add cooldown before re-queuing to let GPU VRAM recover
      // Exponential backoff: 30s, 60s, 120s based on retry count
      const cooldownMs = 30000 * Math.pow(2, t.retry_count);
      console.log(`[TaskBroker] Task ${taskId} failed (${failureType}), waiting ${cooldownMs/1000}s before retry ${t.retry_count + 1}/${t.max_retries}`);
      await new Promise(r => setTimeout(r, cooldownMs));
      
      await this.stateMachine.transitionTaskState(taskId, 'QUEUED');
      return true; // will retry
    } else {
      await this.stateMachine.transitionTaskState(taskId, 'FAILED', { failureType, failureMessage });
      return false; // terminal failure
    }
  }

  // Check if a run has completed all tasks
  async checkRunCompletion(runId: string): Promise<{ completed: boolean; failed: boolean }> {
    const result = await this.pool.query(
      `SELECT state, COUNT(*) as count FROM tasks WHERE run_id = $1 GROUP BY state`,
      [runId]
    );

    const stateCounts: Record<string, number> = {};
    for (const row of result.rows) {
      stateCounts[row.state] = parseInt(row.count, 10);
    }

    const total = Object.values(stateCounts).reduce((a, b) => a + b, 0);
    const succeeded = (stateCounts['SUCCEEDED'] || 0) + (stateCounts['SKIPPED'] || 0);
    const failed = stateCounts['FAILED'] || 0;
    const cancelled = stateCounts['CANCELLED'] || 0;
    const active = total - succeeded - failed - cancelled;

    // Run completed if no active tasks and at least one succeeded (or all cancelled)
    if (active === 0 && failed > 0) {
      return { completed: false, failed: true };
    }
    // Consider completed if no active tasks and (some succeeded OR all cancelled)
    if (active === 0 && (succeeded > 0 || (cancelled === total && total > 0))) {
      return { completed: true, failed: false };
    }
    return { completed: false, failed: false };
  }
}

export function createTaskBroker(pool: Pool, stateMachine: StateMachine, maxConcurrent = 5): TaskBroker {
  return new TaskBroker(pool, stateMachine, maxConcurrent);
}
