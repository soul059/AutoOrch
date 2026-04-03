# Policy Engine Service

The Policy Engine enforces safety policies, budget constraints, and human-in-the-loop approval workflows.

## Overview

The Policy Engine is the last line of defense, ensuring:
- Dangerous actions are blocked or require approval
- Budget limits are not exceeded
- Loop iterations stay within bounds
- Tools are only used by authorized roles

## Risk Classification

| Risk Level | Behavior | Examples |
|------------|----------|----------|
| **SAFE** | Auto-approve, execute immediately | `read_file`, `web_search` |
| **ELEVATED** | Log warning, execute | `file_write` (non-sensitive paths) |
| **HIGH_RISK** | Require human approval | `bash_exec`, `deploy`, `payment` |
| **BLOCKED** | Permanently deny, no override | `rm_rf`, `drop_database`, `sudo` |

## Decision Flow

```
1. Check BLOCKED_ACTIONS list → DENY if match
2. Check budget limits (tokens + cost) → DENY if exceeded
3. Check loop iteration limits → DENY if exceeded
4. Check tool whitelist per agent role → DENY if not allowed
5. In SANDBOX_MODE: auto-approve remaining
6. Production: classify risk and gate HIGH_RISK
```

## API

### Policy Evaluation

```typescript
const policy = new PolicyEngine(pool);

// Evaluate an action
const decision = await policy.evaluateAction({
  type: 'bash_exec',
  args: { command: 'ls -la' },
  role: 'BUILDER',
  runId: 'run-123'
});

// decision = { allowed: false, requiresApproval: true, riskLevel: 'HIGH_RISK' }
```

### Risk Classification

```typescript
// Classify risk level for an action
const risk = policy.classifyRisk('file_write', { path: '/etc/passwd' });
// risk = 'BLOCKED' (sensitive path detected)

const risk = policy.classifyRisk('web_search', { query: 'weather' });
// risk = 'SAFE'
```

### Budget Enforcement

```typescript
// Check if budget allows operation
const check = await policy.checkBudget(runId, {
  estimatedTokens: 5000,
  estimatedCost: 0.05
});
// check = { allowed: true, remaining: { tokens: 95000, cost: 9.95 }, warning: false }

// Record actual cost
await policy.recordCost(runId, {
  tokens: 4800,
  cost: 0.048
});

// Check loop limit
const canContinue = await policy.checkLoopLimit(runId, currentIteration);
```

### Tool Whitelist

```typescript
// Check if role can use tool
const allowed = policy.checkToolWhitelist('RESEARCHER', 'bash_exec');
// allowed = false (RESEARCHER cannot execute shell commands)

// Get allowed tools for role
const tools = policy.getToolsForRole('BUILDER');
// tools = ['read_file', 'write_file', 'bash_exec', 'web_search']
```

### Approval Management

```typescript
// Create approval request
const approval = await policy.createApproval({
  runId: 'run-123',
  taskId: 'task-456',
  action: 'bash_exec',
  args: { command: 'npm install' },
  riskLevel: 'HIGH_RISK',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
});

// Resolve approval
await policy.resolveApproval(approval.id, 'APPROVED', 'Looks safe');
// or
await policy.resolveApproval(approval.id, 'REJECTED', 'Too risky');

// Expire overdue approvals (fail-closed)
const expired = await policy.expireOverdueApprovals();
```

## Blocked Actions

These actions are permanently blocked and cannot be overridden:

- `rm_rf` - Recursive file deletion
- `format_disk` - Disk formatting
- `drop_database` - Database deletion
- `sudo` - Privilege escalation
- `chmod_777` - Insecure permissions
- `delete_root` - Root filesystem deletion

## High-Risk Actions

These require human approval in production:

- `bash_exec` - Shell command execution
- `file_write` - File system modifications
- `deploy` - Deployment operations
- `payment` - Financial transactions
- `external_api_call` - Third-party API calls
- `database_write` - Database modifications
- `send_email` - Email communications

## Role Tool Whitelists

| Role | Allowed Tools |
|------|---------------|
| PLANNER | `web_search`, `read_file` |
| RESEARCHER | `web_search`, `read_file`, `http_request` |
| BUILDER | `read_file`, `write_file`, `bash_exec`, `web_search` |
| REVIEWER | `read_file`, `web_search` |
| OPERATIONS | `read_file`, `deploy`, `bash_exec` (all require approval) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SANDBOX_MODE` | `true` | Auto-approve HIGH_RISK in sandbox |
| `MAX_TOKENS_PER_RUN` | `100000` | Maximum tokens per run |
| `MAX_COST_PER_RUN` | `10.00` | Maximum cost in USD |
| `MAX_ITERATIONS` | `50` | Maximum loop iterations |
| `BUDGET_WARNING_THRESHOLD` | `0.8` | Warning at 80% budget |
| `APPROVAL_TIMEOUT_MS` | `1800000` | 30 minute approval timeout |

## Database Tables

- `approvals` - Pending and resolved approval requests
- `budget_ledger` - Cost and token tracking per run
- `audit_events` - Policy decisions logged

## Usage Example

```typescript
import { PolicyEngine } from '@autoorch/policy-engine';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const policy = new PolicyEngine(pool);

// Before executing a tool
const decision = await policy.evaluateAction({
  type: 'bash_exec',
  args: { command: 'npm run build' },
  role: 'BUILDER',
  runId: 'run-123'
});

if (!decision.allowed) {
  if (decision.requiresApproval) {
    // Create approval request and wait
    const approval = await policy.createApproval({
      runId: 'run-123',
      taskId: 'task-456',
      action: 'bash_exec',
      args: { command: 'npm run build' },
      riskLevel: decision.riskLevel
    });
    // Run transitions to WAITING_APPROVAL...
  } else {
    // Action is blocked
    throw new Error(`Action denied: ${decision.reason}`);
  }
}

// Check budget before provider call
const budgetCheck = await policy.checkBudget(runId, { estimatedTokens: 5000 });
if (!budgetCheck.allowed) {
  throw new Error('Budget exceeded');
}
if (budgetCheck.warning) {
  console.warn('Budget warning: 80% consumed');
}
```

## Testing

```bash
npx vitest run tests/unit/approval-gates.test.ts
npx vitest run tests/unit/budget-race.test.ts
npx vitest run tests/verification/v4-approval-coverage.test.ts
npx vitest run tests/verification/v6-budget-enforcement.test.ts
```
