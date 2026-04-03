import { Router, Request, Response } from 'express';
import pool from '../config/database.js';

const router = Router();

// List all workflow templates
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description, agent_sequence, dependencies, is_default, created_at, updated_at
      FROM workflow_templates
      ORDER BY is_default DESC, name ASC
    `);
    res.json(result.rows);
  } catch (err: any) {
    // Table might not exist yet
    if (err.message?.includes('does not exist')) {
      return res.json([]);
    }
    console.error('[Workflows] Failed to list templates:', err.message);
    res.status(500).json({ error: 'Failed to list workflow templates' });
  }
});

// Get a single workflow template
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM workflow_templates WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow template not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[Workflows] Failed to get template:', err.message);
    res.status(500).json({ error: 'Failed to get workflow template' });
  }
});

// Create a new workflow template
router.post('/', async (req: Request, res: Response) => {
  const { name, description, agent_sequence, dependencies } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!agent_sequence || !Array.isArray(agent_sequence) || agent_sequence.length === 0) {
    return res.status(400).json({ error: 'agent_sequence must be a non-empty array of agent role names' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO workflow_templates (name, description, agent_sequence, dependencies)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [
      name,
      description || '',
      JSON.stringify(agent_sequence),
      JSON.stringify(dependencies || {})
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[Workflows] Failed to create template:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A workflow template with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create workflow template' });
  }
});

// Update a workflow template
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, agent_sequence, dependencies, is_default } = req.body;

  try {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (agent_sequence !== undefined) {
      updates.push(`agent_sequence = $${paramIndex++}`);
      values.push(JSON.stringify(agent_sequence));
    }
    if (dependencies !== undefined) {
      updates.push(`dependencies = $${paramIndex++}`);
      values.push(JSON.stringify(dependencies));
    }
    if (is_default !== undefined) {
      // If setting as default, unset other defaults first
      if (is_default) {
        await pool.query('UPDATE workflow_templates SET is_default = false');
      }
      updates.push(`is_default = $${paramIndex++}`);
      values.push(is_default);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE workflow_templates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow template not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[Workflows] Failed to update template:', err.message);
    res.status(500).json({ error: 'Failed to update workflow template' });
  }
});

// Delete a workflow template
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM workflow_templates WHERE id = $1 AND is_default = false RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Template not found or cannot delete the default template' });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Workflows] Failed to delete template:', err.message);
    res.status(500).json({ error: 'Failed to delete workflow template' });
  }
});

// Get available agent roles for workflow building
router.get('/available-agents', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        COALESCE(role_name, role::text) as name,
        display_name,
        system_prompt
      FROM agent_role_definitions
      ORDER BY created_at ASC
    `);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[Workflows] Failed to list available agents:', err.message);
    res.status(500).json({ error: 'Failed to list available agents' });
  }
});

export default router;
