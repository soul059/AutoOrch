import { Router, Request, Response } from 'express';
import pool from '../config/database.js';
import { stateMachine, policyEngine } from '../services.js';

const router = Router();

// List pending approvals
router.get('/pending', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT a.*, COALESCE(t.agent_role_name, t.agent_role::text) as agent_role, r.prompt
       FROM approvals a
       JOIN tasks t ON a.task_id = t.id
       JOIN runs r ON a.run_id = r.id
       WHERE a.state = 'PENDING'
       ORDER BY a.requested_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[approvals.pending]', err);
    res.status(500).json({ error: 'Failed to list approvals' });
  }
});

// Approve an action
router.post('/:id/approve', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { reason } = req.body;
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE approvals SET state = 'APPROVED', resolved_at = NOW(), resolved_by = 'operator', reason = $1
       WHERE id = $2 AND state = 'PENDING'
       RETURNING *`,
      [reason || 'Approved by operator', req.params.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Approval not found or already resolved' });
      return;
    }

    const approval = result.rows[0];

    // Transition run back to EXECUTING if it was waiting
    await client.query(
      `UPDATE runs SET state = 'EXECUTING', updated_at = NOW()
       WHERE id = $1 AND state = 'WAITING_APPROVAL'`,
      [approval.run_id]
    );

    // Re-queue the task (fix: task is in RUNNING state when waiting for approval, not PENDING/DISPATCHED)
    await client.query(
      `UPDATE tasks SET state = 'QUEUED', updated_at = NOW()
       WHERE id = $1 AND state = 'RUNNING'`,
      [approval.task_id]
    );

    // Audit event
    const run = await client.query('SELECT correlation_id FROM runs WHERE id = $1', [approval.run_id]);
    await client.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       VALUES ($1, $2, $3, 'APPROVAL_RESOLVED', $4)`,
      [approval.run_id, approval.task_id, run.rows[0].correlation_id, JSON.stringify({
        approvalId: approval.id, state: 'APPROVED', resolvedBy: 'operator', reason: reason || 'Approved'
      })]
    );

    await client.query('COMMIT');
    res.json(approval);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[approvals.approve]', err);
    res.status(500).json({ error: 'Failed to approve' });
  } finally {
    client.release();
  }
});

// Reject an action
router.post('/:id/reject', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { reason } = req.body;
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE approvals SET state = 'REJECTED', resolved_at = NOW(), resolved_by = 'operator', reason = $1
       WHERE id = $2 AND state = 'PENDING'
       RETURNING *`,
      [reason || 'Rejected by operator', req.params.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Approval not found or already resolved' });
      return;
    }

    const approval = result.rows[0];

    // Mark the task as failed
    await client.query(
      `UPDATE tasks SET state = 'FAILED', failure_type = 'APPROVAL_REJECTED', failure_message = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason || 'Rejected by operator', approval.task_id]
    );

    // Transition run to PAUSED
    await client.query(
      `UPDATE runs SET state = 'PAUSED', updated_at = NOW()
       WHERE id = $1 AND state = 'WAITING_APPROVAL'`,
      [approval.run_id]
    );

    // Audit event
    const run = await client.query('SELECT correlation_id FROM runs WHERE id = $1', [approval.run_id]);
    await client.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       VALUES ($1, $2, $3, 'APPROVAL_RESOLVED', $4)`,
      [approval.run_id, approval.task_id, run.rows[0].correlation_id, JSON.stringify({
        approvalId: approval.id, state: 'REJECTED', resolvedBy: 'operator', reason: reason || 'Rejected'
      })]
    );

    await client.query('COMMIT');
    res.json(approval);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[approvals.reject]', err);
    res.status(500).json({ error: 'Failed to reject' });
  } finally {
    client.release();
  }
});

export default router;
