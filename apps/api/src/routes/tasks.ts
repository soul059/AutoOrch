import { Router, Request, Response } from 'express';
import pool from '../config/database.js';
import { stateMachine, taskBroker, policyEngine, providerRouter, workerRuntime } from '../services.js';

const router = Router();

// List tasks for a run
router.get('/run/:runId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE run_id = $1 ORDER BY created_at ASC',
      [req.params.runId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[tasks.list]', err);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// Get a single task
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[tasks.get]', err);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

// Execute a task — evaluates policy, selects provider, runs tool, completes task
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const task = await pool.query(
      'SELECT t.*, r.state as run_state FROM tasks t JOIN runs r ON t.run_id = r.id WHERE t.id = $1',
      [req.params.id]
    );
    if (task.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const t = task.rows[0];
    if (t.state !== 'DISPATCHED') {
      res.status(400).json({ error: `Task must be in DISPATCHED state (currently ${t.state})` });
      return;
    }

    // Transition to RUNNING
    await stateMachine.transitionTaskState(req.params.id as string, 'RUNNING');

    // Determine the tool/action from task input
    const action = (t.input?.action as string) || 'file_read';
    const args = (t.input?.args as Record<string, unknown>) || {};

    // Policy evaluation before execution
    const policyResult = await policyEngine.evaluateAction(t.run_id, req.params.id as string, action, args);

    if (policyResult.decision === 'DENY') {
      await taskBroker.failTask(req.params.id as string, 'POLICY_DENIED', policyResult.reason);
      res.json({ status: 'denied', reason: policyResult.reason });
      return;
    }

    if (policyResult.decision === 'REQUIRE_APPROVAL') {
      const approvalId = await policyEngine.createApproval(
        t.run_id, req.params.id as string, action, policyResult.riskLevel
      );
      // Transition run to WAITING_APPROVAL
      try {
        await stateMachine.transitionRunState(t.run_id, 'WAITING_APPROVAL', `Approval required for ${action}`);
      } catch { /* may already be in WAITING_APPROVAL */ }
      res.json({ status: 'approval_required', approvalId, reason: policyResult.reason });
      return;
    }

    // Select provider for AI inference (if task needs it)
    let providerResult = null;
    if (t.input?.needsInference) {
      const selected = await providerRouter.selectProvider({
        agentRole: t.agent_role,
        runId: t.run_id,
      });
      if (selected) {
        providerResult = await selected.adapter.complete({
          systemPrompt: (t.input?.systemPrompt as string) || 'You are a helpful assistant.',
          userMessage: (t.input?.userMessage as string) || '',
          maxTokens: (t.input?.maxTokens as number) || 2000,
          temperature: 0.7,
        });
      }
    }

    // Execute tool in worker runtime
    const toolResult = await workerRuntime.executeTool({
      taskId: req.params.id as string,
      runId: t.run_id,
      toolName: action,
      toolArgs: args,
    });

    if (toolResult.success) {
      await taskBroker.completeTask(req.params.id as string, {
        toolResult: toolResult.result,
        providerResponse: providerResult?.content,
      }, providerResult?.tokenUsage);

      // Check if all tasks are done
      const completion = await taskBroker.checkRunCompletion(t.run_id);
      if (completion.completed) {
        await stateMachine.transitionRunState(t.run_id, 'COMPLETED', 'All tasks completed');
      } else if (completion.failed) {
        await stateMachine.transitionRunState(t.run_id, 'FAILED', 'One or more tasks failed');
      }

      res.json({ status: 'completed', result: toolResult.result });
    } else {
      const retried = await taskBroker.failTask(req.params.id as string, 'TOOL_ERROR', toolResult.error || 'Unknown error');
      res.json({ status: retried ? 'retrying' : 'failed', error: toolResult.error });
    }
  } catch (err) {
    console.error('[tasks.execute]', err);
    // Try to fail the task gracefully
    try {
      await taskBroker.failTask(req.params.id as string, 'INTERNAL_ERROR', (err as Error).message);
    } catch { /* ignore cleanup error */ }
    res.status(500).json({ error: 'Failed to execute task' });
  }
});

// Complete a task manually (for external/webhook completions)
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { output, tokenUsage } = req.body;
    await taskBroker.completeTask(req.params.id as string, output || {}, tokenUsage);

    const task = await pool.query('SELECT run_id FROM tasks WHERE id = $1', [req.params.id]);
    if (task.rows[0]) {
      const completion = await taskBroker.checkRunCompletion(task.rows[0].run_id);
      if (completion.completed) {
        await stateMachine.transitionRunState(task.rows[0].run_id, 'COMPLETED', 'All tasks completed');
      }
    }

    res.json({ status: 'completed' });
  } catch (err) {
    console.error('[tasks.complete]', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// Fail a task manually
router.post('/:id/fail', async (req: Request, res: Response) => {
  try {
    const { failureType, failureMessage } = req.body;
    const retried = await taskBroker.failTask(
      req.params.id as string,
      failureType || 'MANUAL',
      failureMessage || 'Manually failed'
    );
    res.json({ status: retried ? 'retrying' : 'failed' });
  } catch (err) {
    console.error('[tasks.fail]', err);
    res.status(500).json({ error: 'Failed to fail task' });
  }
});

// Retry a failed task (re-queue it)
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const task = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (task.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    
    const t = task.rows[0];
    if (t.state !== 'FAILED') {
      res.status(400).json({ error: `Cannot retry task in ${t.state} state` });
      return;
    }
    
    // Reset the task to QUEUED state
    await pool.query(
      `UPDATE tasks SET state = 'QUEUED', failure_type = NULL, failure_message = NULL, 
       retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    
    // Also ensure the run is in EXECUTING state
    await pool.query(
      `UPDATE runs SET state = 'EXECUTING', updated_at = NOW() WHERE id = $1 AND state IN ('FAILED', 'PAUSED')`,
      [t.run_id]
    );
    
    res.json({ status: 'queued', message: 'Task re-queued for execution' });
  } catch (err) {
    console.error('[tasks.retry]', err);
    res.status(500).json({ error: 'Failed to retry task' });
  }
});

export default router;
