import { Router, Request, Response } from 'express';
import pool from '../config/database.js';
import { providerRouter } from '../services.js';

const router = Router();

// List all providers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM provider_definitions WHERE is_enabled = true ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[providers.list]', err);
    res.status(500).json({ error: 'Failed to list providers' });
  }
});

// Get provider mappings for a role
router.get('/mappings/:role', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, pd.name as provider_name, pd.type as provider_type, pd.model_name, pd.capabilities
       FROM provider_mappings pm
       JOIN provider_definitions pd ON pm.provider_id = pd.id
       WHERE pm.agent_role = $1
       ORDER BY pm.priority ASC`,
      [req.params.role]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[providers.mappings]', err);
    res.status(500).json({ error: 'Failed to get provider mappings' });
  }
});

// Register a new provider
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type, endpoint, modelName, capabilities, credentialsRef, costMetadata, rateLimits } = req.body;

    if (!name || !type || !endpoint || !modelName) {
      res.status(400).json({ error: 'name, type, endpoint, and modelName are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO provider_definitions (name, type, endpoint, model_name, capabilities, credentials_ref, cost_metadata, rate_limits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name, type, endpoint, modelName,
        JSON.stringify(capabilities || {}),
        credentialsRef || null,
        JSON.stringify(costMetadata || { costPerInputToken: 0, costPerOutputToken: 0, currency: 'USD' }),
        JSON.stringify(rateLimits || { requestsPerMinute: 60, tokensPerMinute: 100000 }),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[providers.create]', err);
    res.status(500).json({ error: 'Failed to create provider' });
  }
});

// Update provider health
router.put('/:id/health', async (req: Request, res: Response) => {
  try {
    const { isHealthy, errorMessage } = req.body;

    const result = await pool.query(
      `UPDATE provider_definitions
       SET health_status = jsonb_build_object(
         'isHealthy', $1::boolean,
         'lastCheckedAt', NOW()::text,
         'lastErrorMessage', $2::text,
         'consecutiveFailures', CASE WHEN $1::boolean THEN 0
           ELSE LEAST(COALESCE((health_status->>'consecutiveFailures')::int, 0) + 1, 999999) END
       ), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [isHealthy, errorMessage || null, req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[providers.health]', err);
    res.status(500).json({ error: 'Failed to update provider health' });
  }
});

// Run health checks on all providers via ProviderRouter
router.post('/health-check-all', async (_req: Request, res: Response) => {
  try {
    await providerRouter.runHealthChecks();
    const result = await pool.query(
      'SELECT id, name, type, health_status FROM provider_definitions WHERE is_enabled = true ORDER BY name'
    );
    res.json({ checked: result.rows.length, providers: result.rows });
  } catch (err) {
    console.error('[providers.healthCheckAll]', err);
    res.status(500).json({ error: 'Failed to run health checks' });
  }
});

// Reload provider adapters from database
router.post('/reload', async (_req: Request, res: Response) => {
  try {
    await providerRouter.loadAdapters();
    res.json({ message: 'Provider adapters reloaded' });
  } catch (err) {
    console.error('[providers.reload]', err);
    res.status(500).json({ error: 'Failed to reload providers' });
  }
});

// Delete a provider
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // First remove any mappings
    await pool.query('DELETE FROM provider_mappings WHERE provider_id = $1', [id]);
    
    // Then delete the provider
    const result = await pool.query(
      'DELETE FROM provider_definitions WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    // Reload adapters to reflect the deletion
    await providerRouter.loadAdapters();

    res.json({ deleted: result.rows[0], message: 'Provider deleted successfully' });
  } catch (err) {
    console.error('[providers.delete]', err);
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

export default router;
