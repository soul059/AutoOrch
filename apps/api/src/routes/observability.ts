import { Router, Request, Response } from 'express';
import pool from '../config/database.js';
import { createObservabilityManager } from '../config/observability.js';
import { getSecretsManager } from '../config/secrets.js';

const router = Router();
const observability = createObservabilityManager(pool);

// Start metrics collection
observability.start(30000);

// Full health report
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const report = await observability.getHealthReport();
    const statusCode = report.status === 'healthy' ? 200 : report.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(report);
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: (err as Error).message });
  }
});

// Prometheus-style metrics endpoint
router.get('/metrics', (_req: Request, res: Response) => {
  res.type('text/plain').send(observability.getMetricsText());
});

// Detailed system status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const [runs, tasks, approvals, providers, events] = await Promise.all([
      pool.query('SELECT state, COUNT(*) as count FROM runs GROUP BY state'),
      pool.query('SELECT state, COUNT(*) as count FROM tasks GROUP BY state'),
      pool.query("SELECT state, COUNT(*) as count FROM approvals GROUP BY state"),
      pool.query('SELECT name, type, model_name, is_enabled, health_status FROM provider_definitions'),
      pool.query("SELECT COUNT(*) as count FROM audit_events WHERE timestamp > NOW() - INTERVAL '1 hour'"),
    ]);

    res.json({
      runs: Object.fromEntries(runs.rows.map(r => [r.state, parseInt(r.count, 10)])),
      tasks: Object.fromEntries(tasks.rows.map(r => [r.state, parseInt(r.count, 10)])),
      approvals: Object.fromEntries(approvals.rows.map(r => [r.state, parseInt(r.count, 10)])),
      providers: providers.rows.map(p => ({
        name: p.name,
        type: p.type,
        model: p.model_name,
        enabled: p.is_enabled,
        healthy: p.health_status?.isHealthy,
      })),
      auditEventsLastHour: parseInt(events.rows[0].count, 10),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Secrets audit (which keys are loaded, sources — no values exposed)
router.get('/secrets-audit', (_req: Request, res: Response) => {
  try {
    const manager = getSecretsManager();
    res.json({
      loadedKeys: manager.listLoadedKeys(),
      audit: manager.getAuditSummary(),
    });
  } catch (err) {
    res.json({ loadedKeys: [], error: (err as Error).message });
  }
});

// Budget report across all active runs
router.get('/budget-report', async (_req: Request, res: Response) => {
  try {
    // Get all recent runs with their token usage (including completed)
    const result = await pool.query(
      `SELECT
         r.id as run_id,
         r.prompt,
         r.state,
         r.budget_limit,
         r.created_at,
         COALESCE(SUM((t.token_usage->>'totalTokens')::int), 0) as tokens_used,
         COALESCE(SUM((t.token_usage->>'costUsd')::float), 0) as cost_used,
         COUNT(t.id) FILTER (WHERE t.state IN ('SUCCEEDED', 'FAILED')) as iterations
       FROM runs r
       LEFT JOIN tasks t ON t.run_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at DESC
       LIMIT 20`
    );

    res.json(result.rows.map(r => ({
      runId: r.run_id,
      prompt: r.prompt?.slice(0, 80),
      state: r.state,
      budget: r.budget_limit,
      usage: {
        tokens: parseInt(r.tokens_used, 10),
        costUsd: parseFloat(r.cost_used),
        iterations: parseInt(r.iterations, 10),
      },
      tokenUtilization: r.budget_limit?.maxTokens
        ? `${((parseInt(r.tokens_used, 10) / r.budget_limit.maxTokens) * 100).toFixed(1)}%`
        : 'N/A',
      costUtilization: r.budget_limit?.maxCostUsd
        ? `${((parseFloat(r.cost_used) / r.budget_limit.maxCostUsd) * 100).toFixed(1)}%`
        : 'N/A',
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Provider call metrics
router.get('/provider-metrics', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         pd.name as provider_name,
         pd.type as provider_type,
         pd.model_name,
         pd.health_status,
         COUNT(ae.id) FILTER (WHERE ae.event_type = 'PROVIDER_CALL_COMPLETED') as successful_calls,
         COUNT(ae.id) FILTER (WHERE ae.event_type = 'PROVIDER_CALL_FAILED') as failed_calls,
         AVG((ae.payload->>'durationMs')::float) FILTER (WHERE ae.event_type = 'PROVIDER_CALL_COMPLETED') as avg_latency_ms
       FROM provider_definitions pd
       LEFT JOIN audit_events ae ON ae.payload->>'providerId' = pd.id::text
       GROUP BY pd.id`
    );

    res.json(result.rows.map(r => ({
      provider: r.provider_name,
      type: r.provider_type,
      model: r.model_name,
      healthy: r.health_status?.isHealthy,
      lastChecked: r.health_status?.lastCheckedAt,
      successfulCalls: parseInt(r.successful_calls || '0', 10),
      failedCalls: parseInt(r.failed_calls || '0', 10),
      avgLatencyMs: r.avg_latency_ms ? parseFloat(r.avg_latency_ms).toFixed(1) : null,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Failure dashboard
router.get('/failures', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string || '50', 10);

    const result = await pool.query(
      `SELECT
         t.id as task_id,
         t.run_id,
         t.agent_role,
         t.failure_type,
         t.failure_message,
         t.retry_count,
         t.max_retries,
         t.completed_at
       FROM tasks t
       WHERE t.state = 'FAILED'
       ORDER BY t.completed_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
export { observability };
