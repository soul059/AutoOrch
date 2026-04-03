import { Router, Request, Response } from 'express';
import pool from '../config/database.js';

const router = Router();

// List all agent role definitions
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Get roles with their default provider from provider_mappings
    const result = await pool.query(`
      SELECT 
        ard.id,
        COALESCE(ard.role_name, ard.role::text) as name,
        ard.display_name,
        ard.system_prompt,
        ard.tool_whitelist,
        ard.output_schema,
        ard.budget_policy,
        ard.routing_preferences,
        ard.retry_policy,
        ard.created_at,
        ard.updated_at,
        pm.provider_id as default_provider_id
      FROM agent_role_definitions ard
      LEFT JOIN provider_mappings pm ON (
        pm.agent_role_name = COALESCE(ard.role_name, ard.role::text)
        AND pm.is_default = true
      )
      ORDER BY ard.created_at ASC
    `);
    res.json(result.rows.map(row => ({
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      description: row.display_name,  // For UI compatibility
      system_prompt: row.system_prompt,
      tool_whitelist: row.tool_whitelist || [],
      output_schema: row.output_schema,
      budget_policy: row.budget_policy,
      budget_limit: row.budget_policy?.maxCostPerTask || null,
      max_tokens_per_request: row.budget_policy?.maxTokensPerTask || null,
      routing_preferences: row.routing_preferences,
      retry_policy: row.retry_policy,
      default_provider_id: row.default_provider_id || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })));
  } catch (err: any) {
    console.error('[Roles] Failed to list roles:', err.message);
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

// Get a single role definition
router.get('/:roleId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        ard.*,
        COALESCE(ard.role_name, ard.role::text) as name,
        pm.provider_id as default_provider_id
      FROM agent_role_definitions ard
      LEFT JOIN provider_mappings pm ON (
        pm.agent_role_name = COALESCE(ard.role_name, ard.role::text)
        AND pm.is_default = true
      )
      WHERE ard.id = $1
    `, [req.params.roleId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      description: row.display_name,
      system_prompt: row.system_prompt,
      tool_whitelist: row.tool_whitelist || [],
      output_schema: row.output_schema,
      budget_policy: row.budget_policy,
      budget_limit: row.budget_policy?.maxCostPerTask || null,
      max_tokens_per_request: row.budget_policy?.maxTokensPerTask || null,
      routing_preferences: row.routing_preferences,
      retry_policy: row.retry_policy,
      default_provider_id: row.default_provider_id || null,
    });
  } catch (err: any) {
    console.error('[Roles] Failed to get role:', err.message);
    res.status(500).json({ error: 'Failed to get role' });
  }
});

// Update a role definition
router.patch('/:roleId', async (req: Request, res: Response) => {
  const { roleId } = req.params;
  const updates = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Build update query dynamically
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Handle description → display_name mapping (frontend sends description)
    if (updates.description !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(updates.description);
    } else if (updates.display_name !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(updates.display_name);
    }
    if (updates.system_prompt !== undefined) {
      // Append strict JSON instruction if not already present
      const basePrompt = updates.system_prompt;
      const finalSystemPrompt = basePrompt.includes('strict JSON') || basePrompt.includes('valid JSON only')
        ? basePrompt
        : basePrompt + STRICT_JSON_INSTRUCTION;
      setClauses.push(`system_prompt = $${paramIndex++}`);
      values.push(finalSystemPrompt);
    }
    if (updates.tool_whitelist !== undefined) {
      // Use explicit array casting for PostgreSQL text[] column
      setClauses.push(`tool_whitelist = $${paramIndex++}::text[]`);
      values.push(updates.tool_whitelist);
    }
    if (updates.output_schema !== undefined) {
      setClauses.push(`output_schema = $${paramIndex++}`);
      values.push(JSON.stringify(updates.output_schema));
    }
    if (updates.budget_limit !== undefined || updates.max_tokens_per_request !== undefined) {
      // Merge with existing budget_policy
      const existing = await client.query(
        'SELECT budget_policy FROM agent_role_definitions WHERE id = $1',
        [roleId]
      );
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Role not found' });
      }
      const policy = { ...(existing.rows[0].budget_policy || {}) };
      if (updates.budget_limit !== undefined) {
        policy.maxCostPerTask = updates.budget_limit;
      }
      if (updates.max_tokens_per_request !== undefined) {
        policy.maxTokensPerTask = updates.max_tokens_per_request;
      }
      setClauses.push(`budget_policy = $${paramIndex++}`);
      values.push(JSON.stringify(policy));
    }
    if (updates.routing_preferences !== undefined) {
      setClauses.push(`routing_preferences = $${paramIndex++}`);
      values.push(JSON.stringify(updates.routing_preferences));
    }

    // Update role definition if there are changes
    let result;
    if (setClauses.length > 0) {
      values.push(roleId);
      result = await client.query(
        `UPDATE agent_role_definitions SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Role not found' });
      }
    } else {
      result = await client.query('SELECT * FROM agent_role_definitions WHERE id = $1', [roleId]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Role not found' });
      }
    }

    // Handle default_provider_id update - update provider mapping
    if (updates.default_provider_id !== undefined) {
      const roleName = result.rows[0].role_name || result.rows[0].role;
      
      if (updates.default_provider_id) {
        // Check if provider exists
        const providerCheck = await client.query(
          'SELECT id FROM provider_definitions WHERE id = $1',
          [updates.default_provider_id]
        );
        
        if (providerCheck.rows.length > 0) {
          // Check if mapping exists
          const existingMapping = await client.query(
            'SELECT id FROM provider_mappings WHERE agent_role_name = $1 AND provider_id = $2',
            [roleName, updates.default_provider_id]
          );
          
          if (existingMapping.rows.length > 0) {
            // Update existing mapping
            await client.query(
              'UPDATE provider_mappings SET priority = 1, is_default = true WHERE agent_role_name = $1 AND provider_id = $2',
              [roleName, updates.default_provider_id]
            );
          } else {
            // Remove old default and insert new mapping
            await client.query(
              'UPDATE provider_mappings SET is_default = false WHERE agent_role_name = $1',
              [roleName]
            );
            await client.query(
              'INSERT INTO provider_mappings (agent_role_name, provider_id, priority, is_default) VALUES ($1, $2, 1, true)',
              [roleName, updates.default_provider_id]
            );
          }
          console.log(`[Roles] Updated provider mapping: ${roleName} → ${updates.default_provider_id}`);
        } else {
          console.warn(`[Roles] Provider ${updates.default_provider_id} not found, skipping mapping update`);
        }
      } else {
        // Clear default provider - remove all default flags
        await client.query(
          'UPDATE provider_mappings SET is_default = false WHERE agent_role_name = $1',
          [roleName]
        );
        console.log(`[Roles] Cleared default provider for ${roleName}`);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, role: result.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[Roles] Failed to update role:', err.message);
    res.status(500).json({ error: 'Failed to update role' });
  } finally {
    client.release();
  }
});

// Update provider mapping for a role
router.put('/:roleId/provider', async (req: Request, res: Response) => {
  const { roleId } = req.params;
  const { provider_id, priority = 1 } = req.body;

  try {
    // Get the role name (support both old and new schema)
    const roleResult = await pool.query(
      'SELECT COALESCE(role_name, role::text) as role_name FROM agent_role_definitions WHERE id = $1',
      [roleId]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const roleName = roleResult.rows[0].role_name;

    if (provider_id) {
      // Check if mapping already exists
      const existing = await pool.query(
        'SELECT id FROM provider_mappings WHERE agent_role_name = $1 AND provider_id = $2',
        [roleName, provider_id]
      );
      
      if (existing.rows.length > 0) {
        // Update existing mapping
        await pool.query(
          'UPDATE provider_mappings SET priority = $1 WHERE agent_role_name = $2 AND provider_id = $3',
          [priority, roleName, provider_id]
        );
      } else {
        // Insert new mapping
        await pool.query(
          'INSERT INTO provider_mappings (agent_role_name, provider_id, priority) VALUES ($1, $2, $3)',
          [roleName, provider_id, priority]
        );
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Roles] Failed to update provider mapping:', err.message);
    res.status(500).json({ error: 'Failed to update provider mapping' });
  }
});

// Get provider mappings for a role
router.get('/:roleId/providers', async (req: Request, res: Response) => {
  const { roleId } = req.params;

  try {
    const roleResult = await pool.query(
      'SELECT COALESCE(role_name, role::text) as role_name FROM agent_role_definitions WHERE id = $1',
      [roleId]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const roleName = roleResult.rows[0].role_name;

    const result = await pool.query(`
      SELECT 
        pm.id,
        pm.provider_id,
        pd.name as provider_name,
        pd.type as provider_type,
        pd.model_name,
        pm.priority
      FROM provider_mappings pm
      JOIN provider_definitions pd ON pm.provider_id = pd.id
      WHERE pm.agent_role_name = $1
      ORDER BY pm.priority ASC
    `, [roleName]);

    res.json(result.rows);
  } catch (err: any) {
    console.error('[Roles] Failed to get provider mappings:', err.message);
    res.status(500).json({ error: 'Failed to get provider mappings' });
  }
});

// Strict JSON instruction to append to all system prompts
const STRICT_JSON_INSTRUCTION = `

IMPORTANT: You MUST respond with valid, strict JSON only. Do not include any text before or after the JSON. Do not use markdown code blocks. Your entire response must be parseable JSON.`;

// Create a new agent role
router.post('/', async (req: Request, res: Response) => {
  const { name, description, system_prompt, default_provider_id, max_tokens_per_request, budget_limit, tool_whitelist } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create role identifier from name (uppercase, underscore-separated)
    const roleIdentifier = name.toUpperCase().replace(/\s+/g, '_');
    
    const budgetPolicy = {
      maxCostPerTask: budget_limit || null,
      maxTokensPerTask: max_tokens_per_request || null,
    };
    
    // Parse tool_whitelist - accept array or default to empty
    const tools: string[] = Array.isArray(tool_whitelist) ? tool_whitelist : [];

    // Append strict JSON instruction to system prompt
    const basePrompt = system_prompt || 'You are a helpful AI assistant.';
    const finalSystemPrompt = basePrompt.includes('strict JSON') || basePrompt.includes('valid JSON only')
      ? basePrompt  // Already has JSON instruction
      : basePrompt + STRICT_JSON_INSTRUCTION;

    console.log(`[Roles] Creating role: ${roleIdentifier}, tools: [${tools.join(', ')}], budget: ${JSON.stringify(budgetPolicy)}, provider: ${default_provider_id || 'none'}`);

    // New schema with role_name column (migration 008+010)
    const result = await client.query(`
      INSERT INTO agent_role_definitions (
        role_name, display_name, system_prompt, budget_policy, tool_whitelist, routing_preferences
      ) VALUES ($1, $2, $3, $4, $5::text[], $6)
      RETURNING *
    `, [
      roleIdentifier,
      description || name,
      finalSystemPrompt,
      JSON.stringify(budgetPolicy),
      tools,
      JSON.stringify({ strategy: 'default' })
    ]);

    const row = result.rows[0];
    
    // If default_provider_id is specified, create the provider mapping
    if (default_provider_id) {
      // Verify provider exists
      const providerCheck = await client.query(
        'SELECT id FROM provider_definitions WHERE id = $1',
        [default_provider_id]
      );
      if (providerCheck.rows.length > 0) {
        await client.query(
          'INSERT INTO provider_mappings (agent_role_name, provider_id, priority, is_default) VALUES ($1, $2, 1, true)',
          [roleIdentifier, default_provider_id]
        );
        console.log(`[Roles] Created provider mapping: ${roleIdentifier} → ${default_provider_id}`);
      } else {
        console.warn(`[Roles] Provider ${default_provider_id} not found, skipping mapping`);
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`[Roles] Created role successfully: id=${row.id}`);
    res.status(201).json({
      id: row.id,
      name: row.role_name || row.role,
      display_name: row.display_name,
      description: row.display_name,
      system_prompt: row.system_prompt,
      tool_whitelist: row.tool_whitelist || [],
      budget_limit: budgetPolicy.maxCostPerTask,
      max_tokens_per_request: budgetPolicy.maxTokensPerTask,
      default_provider_id: default_provider_id || null,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[Roles] Failed to create role:', err.message, err.code);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create role: ' + err.message });
  } finally {
    client.release();
  }
});

// Delete an agent role
router.delete('/:roleId', async (req: Request, res: Response) => {
  const { roleId } = req.params;

  try {
    // First delete related provider mappings
    const roleResult = await pool.query(
      'SELECT COALESCE(role_name, role::text) as role_name FROM agent_role_definitions WHERE id = $1',
      [roleId]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const roleName = roleResult.rows[0].role_name;

    await pool.query('DELETE FROM provider_mappings WHERE agent_role_name = $1', [roleName]);
    await pool.query('DELETE FROM agent_role_definitions WHERE id = $1', [roleId]);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Roles] Failed to delete role:', err.message);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;
