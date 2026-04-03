import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database.js';
import { stateMachine, taskBroker, checkpointManager } from '../services.js';

const router = Router();

// Create a new run
router.post('/', async (req: Request, res: Response) => {
  try {
    const { prompt, providerOverrides, budgetLimit, workflow_template_id, custom_agent_sequence } = req.body;
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required and must be a string' });
      return;
    }

    const defaultBudget = { maxTokens: 100000, maxCostUsd: 10.0, maxLoopIterations: 50 };
    const budget = budgetLimit ? { ...defaultBudget, ...budgetLimit } : defaultBudget;

    const result = await pool.query(
      `INSERT INTO runs (prompt, state, correlation_id, provider_overrides, budget_limit, workflow_template_id, custom_agent_sequence)
       VALUES ($1, 'DRAFT', $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        prompt,
        correlationId,
        JSON.stringify(providerOverrides || {}),
        JSON.stringify(budget),
        workflow_template_id || null,
        custom_agent_sequence ? JSON.stringify(custom_agent_sequence) : null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[runs.create]', err);
    res.status(500).json({ error: 'Failed to create run' });
  }
});

// Get a run by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM runs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[runs.get]', err);
    res.status(500).json({ error: 'Failed to get run' });
  }
});

// List all runs
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM runs ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    console.error('[runs.list]', err);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// Start a run (transition DRAFT → PLANNING) — delegates to StateMachine
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    await stateMachine.transitionRunState(req.params.id as string, 'PLANNING', 'User started run');

    const result = await pool.query('SELECT * FROM runs WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not found') || message.includes('Illegal')) {
      res.status(400).json({ error: message });
      return;
    }
    console.error('[runs.start]', err);
    res.status(500).json({ error: 'Failed to start run' });
  }
});

// Cancel a run — delegates to StateMachine
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Read current state BEFORE updating
    const current = await client.query(
      'SELECT state, correlation_id FROM runs WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (current.rows.length === 0 || ['COMPLETED', 'CANCELLED'].includes(current.rows[0].state)) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Run not found or already terminal' });
      return;
    }

    const previousState = current.rows[0].state;
    const correlationId = current.rows[0].correlation_id;

    const result = await client.query(
      `UPDATE runs SET state = 'CANCELLED', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    // Cancel all non-terminal tasks (including RUNNING)
    await client.query(
      `UPDATE tasks SET state = 'CANCELLED', updated_at = NOW()
       WHERE run_id = $1 AND state IN ('PENDING', 'QUEUED', 'DISPATCHED', 'RUNNING')`,
      [req.params.id]
    );

    await client.query(
      `INSERT INTO audit_events (run_id, correlation_id, event_type, payload)
       VALUES ($1, $2, 'RUN_STATE_CHANGED', $3)`,
      [req.params.id, correlationId, JSON.stringify({
        previousState, newState: 'CANCELLED'
      })]
    );

    // Create a checkpoint to record final state
    await client.query('COMMIT');

    try {
      await checkpointManager.createCheckpoint(req.params.id as string);
    } catch { /* checkpoint is best-effort on cancel */ }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[runs.cancel]', err);
    res.status(500).json({ error: 'Failed to cancel run' });
  } finally {
    client.release();
  }
});

// Resume a paused/failed run from checkpoint — delegates to CheckpointManager
router.post('/:id/resume', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const run = await client.query(
      'SELECT * FROM runs WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (run.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const currentState = run.rows[0].state;
    if (!['PAUSED', 'FAILED'].includes(currentState)) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Cannot resume from state ${currentState}` });
      return;
    }

    // Load latest checkpoint
    const checkpoint = await client.query(
      `SELECT * FROM checkpoints WHERE run_id = $1 ORDER BY sequence_number DESC LIMIT 1`,
      [req.params.id]
    );

    const newCorrelationId = uuidv4();
    const targetState = currentState === 'FAILED' ? 'PLANNING' : 'EXECUTING';

    const result = await client.query(
      `UPDATE runs SET state = $1, correlation_id = $2, checkpoint_id = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [targetState, newCorrelationId, checkpoint.rows[0]?.id || null, req.params.id]
    );

    // Re-queue failed/pending tasks
    await client.query(
      `UPDATE tasks SET state = 'QUEUED', retry_count = 0, updated_at = NOW()
       WHERE run_id = $1 AND state IN ('FAILED', 'PENDING')`,
      [req.params.id]
    );

    await client.query(
      `INSERT INTO audit_events (run_id, correlation_id, event_type, payload)
       VALUES ($1, $2, 'RUN_STATE_CHANGED', $3)`,
      [req.params.id, newCorrelationId, JSON.stringify({
        previousState: currentState, newState: targetState, reason: 'User resumed'
      })]
    );

    await client.query('COMMIT');

    // Queue any ready tasks via TaskBroker (checkpoint already applied in transaction)
    try {
      await taskBroker.queueReadyTasks(req.params.id as string);
    } catch { /* best-effort queue */ }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[runs.resume]', err);
    res.status(500).json({ error: 'Failed to resume run' });
  } finally {
    client.release();
  }
});

// Create tasks for a run (plan a task graph) — delegates to TaskBroker
router.post('/:id/plan', async (req: Request, res: Response) => {
  try {
    const { tasks } = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      res.status(400).json({ error: 'tasks array is required and must not be empty' });
      return;
    }

    // Validate run exists and is in PLANNING state
    const run = await pool.query('SELECT state FROM runs WHERE id = $1', [req.params.id]);
    if (run.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (run.rows[0].state !== 'PLANNING') {
      res.status(400).json({ error: `Run must be in PLANNING state (currently ${run.rows[0].state})` });
      return;
    }

    const taskIds = await taskBroker.createTasksFromPlan(req.params.id as string, tasks);

    // Transition to ROUTING after planning
    await stateMachine.transitionRunState(req.params.id as string, 'ROUTING', 'Task graph planned');

    res.status(201).json({ taskIds, count: taskIds.length });
  } catch (err) {
    console.error('[runs.plan]', err);
    res.status(500).json({ error: 'Failed to create task plan' });
  }
});

// Dispatch tasks for execution — delegates to TaskBroker
router.post('/:id/dispatch', async (req: Request, res: Response) => {
  try {
    // Ensure run is in EXECUTING state
    const run = await pool.query('SELECT state FROM runs WHERE id = $1', [req.params.id]);
    if (run.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (!['ROUTING', 'EXECUTING'].includes(run.rows[0].state)) {
      res.status(400).json({ error: `Run must be in ROUTING or EXECUTING state (currently ${run.rows[0].state})` });
      return;
    }

    // Transition to EXECUTING if in ROUTING
    if (run.rows[0].state === 'ROUTING') {
      await stateMachine.transitionRunState(req.params.id as string, 'EXECUTING', 'Dispatching tasks');
    }

    // Queue ready tasks then dispatch
    await taskBroker.queueReadyTasks(req.params.id as string);
    const dispatched = await taskBroker.dispatchTasks(req.params.id as string);

    res.json({ dispatched, count: dispatched.length });
  } catch (err) {
    console.error('[runs.dispatch]', err);
    res.status(500).json({ error: 'Failed to dispatch tasks' });
  }
});

export default router;
