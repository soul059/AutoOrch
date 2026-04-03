import { Pool } from 'pg';

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
export type RiskLevel = 'SAFE' | 'ELEVATED' | 'HIGH_RISK' | 'BLOCKED';

export interface PolicyEvaluation {
  decision: PolicyDecision;
  riskLevel: RiskLevel;
  reason: string;
}

// Actions classified as high-risk by default
// In sandbox mode, these are auto-approved instead of requiring human approval
const HIGH_RISK_ACTIONS = new Set([
  'bash_exec',
  'file_write',
  'deploy',
  'payment',
  'external_api_call',
  'database_write',
  'send_email',
]);

const BLOCKED_ACTIONS = new Set([
  'rm_rf',
  'format_disk',
  'drop_database',
  'sudo',
]);

// Sandbox mode: auto-approve all actions since we're in a controlled environment
const SANDBOX_MODE = process.env.SANDBOX_MODE !== 'false'; // Default to true

export class PolicyEngine {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Evaluate whether an action should be allowed, require approval, or be denied
  async evaluateAction(
    runId: string,
    taskId: string,
    action: string,
    args: Record<string, unknown>
  ): Promise<PolicyEvaluation> {
    // 1. Check blocked actions (always blocked even in sandbox)
    if (BLOCKED_ACTIONS.has(action)) {
      await this.emitPolicyEvent(runId, taskId, action, 'BLOCKED', 'DENY', 'Action is permanently blocked');
      return { decision: 'DENY', riskLevel: 'BLOCKED', reason: `Action "${action}" is blocked by policy` };
    }

    // 2. Check budget limits
    const budgetCheck = await this.checkBudget(runId, taskId);
    if (budgetCheck) return budgetCheck;

    // 3. Check loop limits
    const loopCheck = await this.checkLoopLimit(runId, taskId);
    if (loopCheck) return loopCheck;

    // 4. Check tool whitelist for the agent role
    const whitelistCheck = await this.checkToolWhitelist(taskId, action);
    if (whitelistCheck) return whitelistCheck;

    // 5. In sandbox mode, auto-approve all remaining actions
    if (SANDBOX_MODE) {
      const riskLevel = HIGH_RISK_ACTIONS.has(action) ? 'ELEVATED' : 'SAFE';
      await this.emitPolicyEvent(runId, taskId, action, riskLevel, 'ALLOW', 'Auto-approved in sandbox mode');
      return { decision: 'ALLOW', riskLevel: riskLevel as RiskLevel, reason: 'Auto-approved in sandbox mode' };
    }

    // 6. Production mode: classify risk level and require approval for high-risk
    if (HIGH_RISK_ACTIONS.has(action)) {
      const isDestructive = this.isDestructiveAction(action, args);

      if (isDestructive) {
        await this.emitPolicyEvent(runId, taskId, action, 'HIGH_RISK', 'REQUIRE_APPROVAL', 'Destructive action requires approval');
        return {
          decision: 'REQUIRE_APPROVAL',
          riskLevel: 'HIGH_RISK',
          reason: `Destructive action "${action}" requires human approval`,
        };
      }

      await this.emitPolicyEvent(runId, taskId, action, 'ELEVATED', 'REQUIRE_APPROVAL', 'Elevated-risk action requires approval');
      return {
        decision: 'REQUIRE_APPROVAL',
        riskLevel: 'ELEVATED',
        reason: `Action "${action}" is elevated-risk and requires approval`,
      };
    }

    await this.emitPolicyEvent(runId, taskId, action, 'SAFE', 'ALLOW', 'Action is safe');
    return { decision: 'ALLOW', riskLevel: 'SAFE', reason: 'Action is safe' };
  }

  // Check if the run has exceeded its budget
  // Uses SERIALIZABLE isolation and includes pending estimated costs to prevent race conditions
  private async checkBudget(runId: string, taskId: string): Promise<PolicyEvaluation | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Lock the run row to prevent concurrent budget checks
      const run = await client.query('SELECT budget_limit FROM runs WHERE id = $1 FOR UPDATE', [runId]);
      if (run.rows.length === 0) { await client.query('COMMIT'); return null; }

      const limit = run.rows[0].budget_limit;
      if (!limit) { await client.query('COMMIT'); return null; }
      
      // Parse limits as numbers (JSONB values might be strings)
      const maxTokens = Number(limit.maxTokens) || 100000;
      const maxCostUsd = Number(limit.maxCostUsd) || 10.0;

      // Calculate actual spent cost from completed tasks
      const completedUsage = await client.query(
        `SELECT
           COALESCE(SUM((token_usage->>'totalTokens')::int), 0) as total_tokens,
           COALESCE(SUM((token_usage->>'costUsd')::float), 0) as total_cost
         FROM tasks WHERE run_id = $1 AND state = 'SUCCEEDED' AND token_usage IS NOT NULL`,
        [runId]
      );

      // Count in-progress tasks to estimate pending cost
      // Each running/dispatched task is assumed to use average cost as reservation
      const pendingTasks = await client.query(
        `SELECT COUNT(*) as count FROM tasks 
         WHERE run_id = $1 AND state IN ('DISPATCHED', 'RUNNING')`,
        [runId]
      );
      
      // Parse values as numbers (PostgreSQL returns strings for bigint/numeric)
      const total_tokens = Number(completedUsage.rows[0].total_tokens) || 0;
      const total_cost = Number(completedUsage.rows[0].total_cost) || 0;
      const pendingCount = parseInt(pendingTasks.rows[0].count, 10) || 0;
      
      // Reserve estimated cost for pending tasks (average 1000 tokens, $0.01 per task)
      const estimatedPendingTokens = pendingCount * 1000;
      const estimatedPendingCost = pendingCount * 0.01;
      
      const projectedTokens = total_tokens + estimatedPendingTokens;
      const projectedCost = total_cost + estimatedPendingCost;

      if (projectedTokens >= maxTokens) {
        await client.query('COMMIT');
        return { decision: 'DENY', riskLevel: 'BLOCKED', reason: `Token budget would be exceeded: ${total_tokens} used + ${estimatedPendingTokens} pending ≥ ${maxTokens} limit` };
      }

      if (projectedCost >= maxCostUsd) {
        await client.query('COMMIT');
        return { decision: 'DENY', riskLevel: 'BLOCKED', reason: `Cost budget would be exceeded: $${total_cost.toFixed(2)} used + $${estimatedPendingCost.toFixed(2)} pending ≥ $${maxCostUsd} limit` };
      }

      // Warn at 80%
      if (projectedTokens >= maxTokens * 0.8 || projectedCost >= maxCostUsd * 0.8) {
        await client.query(
          `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
           SELECT $1, $2, r.correlation_id, 'BUDGET_WARNING', $3
           FROM runs r WHERE r.id = $1`,
          [runId, taskId, JSON.stringify({
            usedTokens: total_tokens, usedCost: total_cost,
            pendingTasks: pendingCount, projectedTokens, projectedCost,
            limitTokens: maxTokens, limitCost: maxCostUsd, thresholdPercent: 80
          })]
        );
      }

      await client.query('COMMIT');
      return null;
    } catch (err) {
      await client.query('ROLLBACK');
      // On serialization failure, retry is safe - just bubble up
      throw err;
    } finally {
      client.release();
    }
  }

  // Check loop iteration limit
  private async checkLoopLimit(runId: string, taskId: string): Promise<PolicyEvaluation | null> {
    const run = await this.pool.query('SELECT budget_limit FROM runs WHERE id = $1', [runId]);
    if (run.rows.length === 0) return null;

    const limit = run.rows[0].budget_limit;
    if (!limit) return null;
    
    // Parse limit as number (JSONB values might be strings)
    const maxLoopIterations = Number(limit.maxLoopIterations) || 50;
    
    const taskCount = await this.pool.query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE run_id = $1 AND (state = 'SUCCEEDED' OR state = 'FAILED')`,
      [runId]
    );
    
    const count = parseInt(taskCount.rows[0].count, 10) || 0;

    if (count >= maxLoopIterations) {
      return { decision: 'DENY', riskLevel: 'BLOCKED', reason: `Loop limit exceeded: ${count}/${maxLoopIterations}` };
    }

    return null;
  }

  // Check tool whitelist for the agent role
  private async checkToolWhitelist(taskId: string, action: string): Promise<PolicyEvaluation | null> {
    const task = await this.pool.query(
      `SELECT COALESCE(t.agent_role_name, t.agent_role::text) as agent_role, ard.tool_whitelist
       FROM tasks t
       LEFT JOIN agent_role_definitions ard ON COALESCE(t.agent_role_name, t.agent_role::text) = COALESCE(ard.role_name, ard.role::text)
       WHERE t.id = $1`,
      [taskId]
    );

    if (task.rows.length === 0) return null;

    const whitelist = task.rows[0].tool_whitelist as string[] | null;
    
    // If no role definition found or whitelist is null/empty, allow all actions
    if (!whitelist || whitelist.length === 0) {
      return null; // Allow action
    }
    
    // Check if action is in whitelist (or if '*' wildcard is present)
    if (!whitelist.includes(action) && !whitelist.includes('*')) {
      return {
        decision: 'DENY',
        riskLevel: 'BLOCKED',
        reason: `Action "${action}" is not in the tool whitelist for role ${task.rows[0].agent_role}`,
      };
    }

    return null;
  }

  // Check if an action with given args is destructive
  private isDestructiveAction(action: string, args: Record<string, unknown>): boolean {
    if (action === 'bash_exec') {
      const cmd = (args.command as string || '').toLowerCase();
      return cmd.includes('rm ') || cmd.includes('delete') || cmd.includes('drop') || cmd.includes('format');
    }
    if (action === 'file_write') {
      const path = (args.path as string || '').toLowerCase();
      return path.includes('/etc/') || path.includes('system32') || path.includes('.env');
    }
    return ['deploy', 'payment', 'database_write'].includes(action);
  }

  // Create an approval request
  async createApproval(
    runId: string,
    taskId: string,
    action: string,
    riskLevel: RiskLevel,
    timeoutMinutes = 30
  ): Promise<string> {
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

    const result = await this.pool.query(
      `INSERT INTO approvals (run_id, task_id, action, risk_level, state, expires_at)
       VALUES ($1, $2, $3, $4, 'PENDING', $5)
       RETURNING id`,
      [runId, taskId, action, riskLevel, expiresAt]
    );

    // Emit approval requested event
    const run = await this.pool.query('SELECT correlation_id FROM runs WHERE id = $1', [runId]);
    await this.pool.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       VALUES ($1, $2, $3, 'APPROVAL_REQUESTED', $4)`,
      [runId, taskId, run.rows[0].correlation_id, JSON.stringify({
        approvalId: result.rows[0].id, action, riskLevel, expiresAt
      })]
    );

    return result.rows[0].id;
  }

  private async emitPolicyEvent(
    runId: string, taskId: string, action: string, riskLevel: string, decision: string, reason: string
  ): Promise<void> {
    const run = await this.pool.query('SELECT correlation_id FROM runs WHERE id = $1', [runId]);
    if (run.rows.length === 0) return;

    await this.pool.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       VALUES ($1, $2, $3, 'POLICY_EVALUATED', $4)`,
      [runId, taskId, run.rows[0].correlation_id, JSON.stringify({ action, riskLevel, decision, reason })]
    );
  }

  // Sweep and expire pending approvals that have passed their deadline (fail-closed)
  async expireOverdueApprovals(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE approvals SET state = 'EXPIRED', resolved_at = NOW()
       WHERE state = 'PENDING' AND expires_at < NOW()
       RETURNING id, run_id, task_id`
    );

    // Emit audit events for each expired approval
    for (const row of result.rows) {
      await this.pool.query(
        `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
         SELECT $1, $2, r.correlation_id, 'APPROVAL_RESOLVED', $3
         FROM runs r WHERE r.id = $1`,
        [row.run_id, row.task_id, JSON.stringify({
          approvalId: row.id, resolution: 'EXPIRED', reason: 'Approval timeout exceeded (fail-closed)'
        })]
      );
    }

    if (result.rows.length > 0) {
      console.log(`[PolicyEngine] Expired ${result.rows.length} overdue approvals`);
    }

    return result.rows.length;
  }
}

export function createPolicyEngine(pool: Pool): PolicyEngine {
  return new PolicyEngine(pool);
}
