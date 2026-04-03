# Orchestrator Service

The Orchestrator is the brain of AutoOrch, managing run and task lifecycle through a state machine with SERIALIZABLE transaction isolation.

## Overview

The Orchestrator coordinates workflow execution by:
- Managing run states (DRAFT → PLANNING → ROUTING → EXECUTING → COMPLETED)
- Managing task states (PENDING → QUEUED → DISPATCHED → RUNNING → SUCCEEDED)
- Enforcing DAG-based dependency ordering
- Creating checkpoints for crash recovery
- Handling failed tasks via dead letter queue

## Components

### State Machine (`state-machine.ts`)

Validates and executes state transitions with PostgreSQL SERIALIZABLE isolation.

```typescript
const stateMachine = new StateMachine(pool);

// Transition run state
await stateMachine.transitionRunState(runId, 'EXECUTING');

// Check if transition is legal
const canTransition = stateMachine.canTransition('DRAFT', 'PLANNING'); // true
```

**Legal Run Transitions:**
```
DRAFT → PLANNING, CANCELLED
PLANNING → ROUTING, FAILED, CANCELLED
ROUTING → EXECUTING, FAILED, CANCELLED
EXECUTING → WAITING_APPROVAL, RETRYING, PAUSED, FAILED, COMPLETED, CANCELLED
WAITING_APPROVAL → EXECUTING, PAUSED, CANCELLED
RETRYING → EXECUTING, FAILED, CANCELLED
PAUSED → EXECUTING, CANCELLED
FAILED → PLANNING (resume from checkpoint)
```

### Task Broker (`task-broker.ts`)

Dispatches queued tasks while respecting dependencies and concurrency limits.

```typescript
const broker = new TaskBroker(pool);

// Create task graph from template
const tasks = await broker.createTaskGraph(runId, taskTemplates);

// Dispatch ready tasks (max 5 concurrent)
const dispatched = await broker.dispatchQueuedTasks(runId, 5);

// Recover tasks orphaned by crashes
const recovered = await broker.recoverOrphanedTasks();
```

**Features:**
- Advisory locks prevent duplicate dispatch
- 2-minute grace period for orphan detection
- Topological ordering respects dependencies

### Checkpoint Manager (`checkpoint-manager.ts`)

Captures full run snapshots for crash recovery.

```typescript
const checkpointMgr = new CheckpointManager(pool);

// Create checkpoint (called after every state transition)
const checkpoint = await checkpointMgr.createCheckpoint(runId);

// Restore from checkpoint (after failure)
await checkpointMgr.restoreFromCheckpoint(runId, checkpointId);

// Prune old checkpoints (keep last 10)
await checkpointMgr.pruneOldCheckpoints(runId, 10);
```

**Checkpoint Contents:**
- Run state
- All task states
- Completed task outputs
- Provider selections
- Budget usage

### Dead Letter Handler (`dead-letter.ts`)

Queues permanently failed tasks for manual investigation.

```typescript
const dlh = new DeadLetterHandler(pool);

// Queue a failed task
await dlh.queueFailedTask(task, 'Max retries exceeded');

// Retry from DLQ (max 3 DLQ retries)
const retriedTask = await dlh.retryFromDeadLetter(dlqEntryId);

// List DLQ entries
const entries = await dlh.getDeadLetterEntries(runId);
```

### JSON Validator (`json-validator.ts`)

Validates agent outputs against JSON schemas.

```typescript
const validator = new JsonValidator();

// Strict validation (throws on invalid)
const result = validator.validateStrict(output, schema);

// Lenient validation with repair attempts
const result = validator.validateLenient(output, schema);
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_TASKS` | `10` | Maximum concurrent tasks per run |
| `ORPHAN_GRACE_PERIOD_MS` | `120000` | Grace period before recovering orphaned tasks |
| `MAX_CHECKPOINTS_PER_RUN` | `10` | Checkpoints retained per run |
| `MAX_DLQ_RETRIES` | `3` | Maximum retries from dead letter queue |

## Database Tables

- `runs` - Run records with state, budget, correlation ID
- `tasks` - Task records with dependencies, outputs, retry count
- `checkpoints` - Run snapshots for recovery
- `dead_letter_queue` - Failed tasks for investigation
- `audit_events` - All state changes logged

## Usage Example

```typescript
import { StateMachine, TaskBroker, CheckpointManager } from '@autoorch/orchestrator';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stateMachine = new StateMachine(pool);
const taskBroker = new TaskBroker(pool);
const checkpointMgr = new CheckpointManager(pool);

// Start a run
await stateMachine.transitionRunState(runId, 'PLANNING');

// Create tasks from template
await taskBroker.createTaskGraph(runId, [
  { role: 'PLANNER', action: 'decompose', dependencies: [] },
  { role: 'RESEARCHER', action: 'gather', dependencies: ['task-1'] },
  { role: 'BUILDER', action: 'implement', dependencies: ['task-2'] }
]);

// Execute
await stateMachine.transitionRunState(runId, 'ROUTING');
await stateMachine.transitionRunState(runId, 'EXECUTING');

// Dispatch tasks
while (hasQueuedTasks) {
  const dispatched = await taskBroker.dispatchQueuedTasks(runId);
  // Execute dispatched tasks...
}

// Complete
await stateMachine.transitionRunState(runId, 'COMPLETED');
```

## Testing

```bash
npx vitest run tests/unit/state-machine.test.ts
npx vitest run tests/unit/state-machine-extended.test.ts
npx vitest run tests/unit/checkpoint-recovery.test.ts
npx vitest run tests/unit/checkpoint-concurrency.test.ts
npx vitest run tests/unit/dead-letter-queue.test.ts
```
