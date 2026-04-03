import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Observability module: metrics collection, correlation tracking, and health reporting

export interface Metric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: string;
}

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  checks: Record<string, { status: string; latencyMs: number; error?: string }>;
  metrics: Record<string, number>;
}

export class ObservabilityManager {
  private pool: Pool;
  private startTime: number;
  private metrics: Map<string, number> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
    this.startTime = Date.now();
  }

  // Start periodic health checks and metrics collection
  start(intervalMs = 30000): void {
    this.healthCheckInterval = setInterval(() => {
      this.collectMetrics().catch(err => {
        console.error('[Observability] Metrics collection failed:', err.message);
      });
    }, intervalMs);
    console.log(`[Observability] Started with ${intervalMs}ms collection interval`);
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // Increment a counter metric
  increment(name: string, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels);
    this.metrics.set(key, (this.metrics.get(key) || 0) + 1);
  }

  // Record a gauge metric
  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels);
    this.metrics.set(key, value);
  }

  // Record a timing metric
  timing(name: string, durationMs: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels);
    this.metrics.set(key, durationMs);
    // Also track count
    const countKey = this.metricKey(`${name}_count`, labels);
    this.metrics.set(countKey, (this.metrics.get(countKey) || 0) + 1);
  }

  private metricKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).map(([k, v]) => `${k}=${v}`).sort().join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  // Collect system-wide metrics from the database
  async collectMetrics(): Promise<void> {
    try {
      // Run counts by state
      const runCounts = await this.pool.query(
        'SELECT state, COUNT(*) as count FROM runs GROUP BY state'
      );
      for (const row of runCounts.rows) {
        this.gauge('autoorch_runs_total', parseInt(row.count, 10), { state: row.state });
      }

      // Task counts by state
      const taskCounts = await this.pool.query(
        'SELECT state, COUNT(*) as count FROM tasks GROUP BY state'
      );
      for (const row of taskCounts.rows) {
        this.gauge('autoorch_tasks_total', parseInt(row.count, 10), { state: row.state });
      }

      // Pending approvals
      const pendingApprovals = await this.pool.query(
        "SELECT COUNT(*) as count FROM approvals WHERE state = 'PENDING'"
      );
      this.gauge('autoorch_approvals_pending', parseInt(pendingApprovals.rows[0].count, 10));

      // Provider health
      const providers = await this.pool.query(
        "SELECT name, type, (health_status->>'isHealthy')::boolean as healthy FROM provider_definitions WHERE is_enabled = true"
      );
      let healthyCount = 0;
      let unhealthyCount = 0;
      for (const row of providers.rows) {
        if (row.healthy) healthyCount++;
        else unhealthyCount++;
      }
      this.gauge('autoorch_providers_healthy', healthyCount);
      this.gauge('autoorch_providers_unhealthy', unhealthyCount);

      // Budget usage across active runs
      const budgetUsage = await this.pool.query(
        `SELECT
           COALESCE(SUM((token_usage->>'totalTokens')::int), 0) as total_tokens,
           COALESCE(SUM((token_usage->>'costUsd')::float), 0) as total_cost
         FROM tasks WHERE token_usage IS NOT NULL`
      );
      this.gauge('autoorch_total_tokens_used', parseInt(budgetUsage.rows[0].total_tokens, 10));
      this.gauge('autoorch_total_cost_usd', parseFloat(budgetUsage.rows[0].total_cost));

      // Audit event count (last hour)
      const recentEvents = await this.pool.query(
        "SELECT COUNT(*) as count FROM audit_events WHERE timestamp > NOW() - INTERVAL '1 hour'"
      );
      this.gauge('autoorch_audit_events_last_hour', parseInt(recentEvents.rows[0].count, 10));

    } catch (err) {
      console.error('[Observability] Failed to collect metrics:', (err as Error).message);
    }
  }

  // Generate a full health report
  async getHealthReport(): Promise<HealthReport> {
    const checks: Record<string, { status: string; latencyMs: number; error?: string }> = {};

    // Database health
    const dbStart = Date.now();
    try {
      await this.pool.query('SELECT 1');
      checks.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.database = { status: 'unhealthy', latencyMs: Date.now() - dbStart, error: (err as Error).message };
    }

    // Provider health
    try {
      const providers = await this.pool.query(
        "SELECT name, (health_status->>'isHealthy')::boolean as healthy, (health_status->>'lastCheckedAt') as last_checked FROM provider_definitions WHERE is_enabled = true"
      );
      for (const p of providers.rows) {
        checks[`provider_${p.name}`] = {
          status: p.healthy ? 'healthy' : 'unhealthy',
          latencyMs: 0,
        };
      }
    } catch {
      checks.providers = { status: 'unknown', latencyMs: 0, error: 'Could not query providers' };
    }

    // Determine overall status
    const allHealthy = Object.values(checks).every(c => c.status === 'healthy');
    const anyUnhealthy = Object.values(checks).some(c => c.status === 'unhealthy');

    const metricsSnapshot: Record<string, number> = {};
    for (const [key, value] of this.metrics) {
      metricsSnapshot[key] = value;
    }

    return {
      status: allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
      uptime: Date.now() - this.startTime,
      checks,
      metrics: metricsSnapshot,
    };
  }

  // Get all current metrics in Prometheus-like text format
  getMetricsText(): string {
    const lines: string[] = [];
    for (const [key, value] of this.metrics) {
      lines.push(`${key} ${value}`);
    }
    return lines.join('\n');
  }
}

export function createObservabilityManager(pool: Pool): ObservabilityManager {
  return new ObservabilityManager(pool);
}
