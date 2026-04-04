# State Machine and Task Lifecycle Documentation

This document provides complete reference for the AutoOrch state machine, task lifecycle, state transitions, dependency resolution, retry logic, and checkpoint/resume behavior.

---

## Run State Machine

### State Diagram

```
DRAFT
  ↓ (user clicks start)
PLANNING (analyzing prompt, generating task graph)
  ↓ (task plan ready)
ROUTING (selecting providers for each agent role)
  ↓ (providers assigned)
EXECUTING (running tasks)
  ↓ (all tasks complete)
COMPLETED ✓

EXECUTING can also transition to:
  → WAITING_APPROVAL (high-risk action requires approval)
  → PAUSED (approval rejected or manual pause)
  → FAILED (unrecoverable error)
  → RETRYING (retrying failed tasks)
  
From FAILED:
  → PLANNING (resume from checkpoint)
  
From PAUSED:
  → PLANNING (resume)
  → CANCELLED (user cancels)
```

### State Definitions

#### DRAFT
**Description:** Initial state after run creation. No work has started.

**Entry Conditions:**
- Run created via POST /api/runs

**Actions:**
- Wait for user to click "Start"

**Exit Transitions:**
- → PLANNING (user starts run)

**Terminal:** No

---

#### PLANNING
**Description:** Analyzing user prompt and generating task execution plan.

**Entry Conditions:**
- User starts run from DRAFT
- Run resumed from FAILED or PAUSED

**Actions:**
- Send prompt to planner agent
- Generate task graph with dependencies
- Validate task structure (no cycles, valid dependencies)
- Create task records in database

**Exit Transitions:**
- → ROUTING (task plan ready)
- → FAILED (planner error, invalid plan)

**Terminal:** No

**Duration:** Typically 5-30 seconds depending on prompt complexity

---

#### ROUTING
**Description:** Selecting AI providers for each agent role in the task graph.

**Entry Conditions:**
- Task graph created successfully

**Actions:**
- For each unique agent role in tasks:
  - Call ProviderRouter.selectProvider(agentRole, userOverride, runOverride)
  - Record selected provider
  - Check provider health
- Assign providers to tasks

**Exit Transitions:**
- → EXECUTING (all providers assigned)
- → FAILED (no healthy provider for required role)

**Terminal:** No

**Duration:** <1 second (database lookups + health checks)

---

#### EXECUTING
**Description:** Actively running tasks. This is the primary work state.

**Entry Conditions:**
- Providers assigned to all roles
- At least one task in QUEUED or DISPATCHED state

**Actions:**
- Queue tasks with satisfied dependencies
- Dispatch tasks to workers (up to concurrency limit)
- Execute tools via WorkerRuntime
- Call AI providers via adapters
- Update task states as they complete/fail
- Check run completion after each task

**Exit Transitions:**
- → WAITING_APPROVAL (HIGH_RISK action requires approval)
- → COMPLETED (all tasks succeeded)
- → FAILED (too many task failures or unrecoverable error)
- → PAUSED (user manually pauses)
- → RETRYING (retrying failed tasks)
- → CANCELLED (user cancels)

**Terminal:** No

**Duration:** Varies widely (seconds to hours depending on task complexity)

---

#### WAITING_APPROVAL
**Description:** Blocked waiting for human approval of high-risk action.

**Entry Conditions:**
- Task evaluated as HIGH_RISK by PolicyEngine
- Approval request created

**Actions:**
- Pause task execution
- Broadcast APPROVAL_REQUIRED event to dashboard
- Wait for approval/rejection via API

**Exit Transitions:**
- → EXECUTING (approval granted, task resumes)
- → PAUSED (approval rejected)
- → FAILED (approval expires without resolution)

**Terminal:** No

**Timeout:** 24 hours (configurable via approval expiry)

---

#### RETRYING
**Description:** Retrying failed tasks with exponential backoff.

**Entry Conditions:**
- One or more tasks failed but have retry attempts remaining
- TaskBroker transitioned failed tasks back to QUEUED

**Actions:**
- Wait for retry delay (1s, 2s, 4s based on retry count)
- Re-queue failed tasks
- Re-dispatch tasks

**Exit Transitions:**
- → EXECUTING (tasks re-queued and dispatching)
- → FAILED (all retries exhausted)

**Terminal:** No

---

#### PAUSED
**Description:** Manually paused by user or by approval rejection.

**Entry Conditions:**
- User clicks "Pause"
- Approval rejected by operator

**Actions:**
- Stop dispatching new tasks
- Allow running tasks to complete
- Preserve state

**Exit Transitions:**
- → PLANNING (user resumes via POST /api/runs/:id/resume)
- → CANCELLED (user cancels)

**Terminal:** No

---

#### COMPLETED
**Description:** All tasks succeeded. Terminal success state.

**Entry Conditions:**
- All tasks in terminal states
- No tasks in FAILED state
- At least one task in SUCCEEDED state

**Actions:**
- Record completion timestamp
- Calculate final cost
- Broadcast completion event

**Exit Transitions:**
- None (terminal)

**Terminal:** Yes

---

#### FAILED
**Description:** Run failed due to unrecoverable errors. Terminal but resumable.

**Entry Conditions:**
- All tasks terminal with at least one FAILED
- Critical error during planning/routing
- Too many consecutive failures

**Actions:**
- Record failure timestamp
- Create final checkpoint
- Move permanently failed tasks to dead-letter queue

**Exit Transitions:**
- → PLANNING (user resumes from checkpoint)

**Terminal:** Yes (but resumable)

---

#### CANCELLED
**Description:** User manually cancelled the run. Terminal.

**Entry Conditions:**
- User clicks "Cancel" via POST /api/runs/:id/cancel

**Actions:**
- Transition all non-terminal tasks to CANCELLED
- Create checkpoint before cancelling
- Record cancellation timestamp

**Exit Transitions:**
- None (terminal, but can resume from checkpoint)

**Terminal:** Yes

---

### State Transition Rules

```typescript
const LEGAL_RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  DRAFT: ['PLANNING'],
  PLANNING: ['ROUTING', 'FAILED'],
  ROUTING: ['EXECUTING', 'FAILED'],
  EXECUTING: ['WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'PAUSED', 'RETRYING', 'CANCELLED'],
  WAITING_APPROVAL: ['EXECUTING', 'PAUSED', 'FAILED'],
  RETRYING: ['EXECUTING', 'FAILED'],
  PAUSED: ['PLANNING', 'CANCELLED'],
  FAILED: ['PLANNING'],  // Resume
  COMPLETED: [],  // Terminal
  CANCELLED: []   // Terminal
};
```

**Validation:** StateMachine.canTransitionRun() enforces these rules before every state change.

---

## Task State Machine

### State Diagram

```
PENDING (waiting for dependencies)
  ↓ (dependencies satisfied)
QUEUED (ready to execute)
  ↓ (worker available)
DISPATCHED (assigned to worker)
  ↓ (worker starts execution)
RUNNING (actively executing)
  ↓ (execution complete)
SUCCEEDED ✓

RUNNING can also transition to:
  → FAILED (exhausted retries)
  → QUEUED (retry attempt)

PENDING can transition to:
  → SKIPPED (dependency failed)
  → CANCELLED (run cancelled)
```

### State Definitions

#### PENDING
**Description:** Task created but waiting for dependencies to complete.

**Entry Conditions:**
- Task created from plan with dependencies array

**Actions:**
- Monitor dependency task states
- Transition to QUEUED when all dependencies terminal

**Exit Transitions:**
- → QUEUED (all dependencies succeeded)
- → SKIPPED (one or more dependencies failed)
- → CANCELLED (run cancelled)

**Terminal:** No

---

#### QUEUED
**Description:** Ready to execute. Waiting for worker availability.

**Entry Conditions:**
- All dependencies satisfied (or no dependencies)
- Task retried after failure

**Actions:**
- Wait for TaskBroker.dispatchTasks() to select this task
- Check concurrency limits

**Exit Transitions:**
- → DISPATCHED (selected by dispatcher)
- → CANCELLED (run cancelled)

**Terminal:** No

---

#### DISPATCHED
**Description:** Assigned to worker but not yet running.

**Entry Conditions:**
- Selected by dispatcher
- Concurrency slot available

**Actions:**
- Wait for worker to start execution
- Worker calls POST /api/tasks/:id/execute

**Exit Transitions:**
- → RUNNING (worker starts execution)
- → QUEUED (worker crashed, orphan recovery re-queues)
- → CANCELLED (run cancelled)

**Terminal:** No

---

#### RUNNING
**Description:** Actively executing tool or AI inference.

**Entry Conditions:**
- Worker started execution via execute endpoint

**Actions:**
- Evaluate action with PolicyEngine
- If approved/allowed:
  - Call provider (if AI inference needed)
  - Execute tool via WorkerRuntime
  - Wait for completion
- If denied:
  - Fail task immediately
- If approval required:
  - Create approval, pause task

**Exit Transitions:**
- → SUCCEEDED (execution completed successfully)
- → QUEUED (transient error, retry attempt available)
- → FAILED (execution failed, no retries remaining)
- → CANCELLED (run cancelled)

**Terminal:** No

**Duration:** Varies (1 second to several minutes)

---

#### SUCCEEDED
**Description:** Task completed successfully. Terminal.

**Entry Conditions:**
- Tool execution returned success
- Output stored

**Actions:**
- Record completion timestamp
- Store task output
- Update run token usage and cost
- Trigger dependent tasks (transition PENDING → QUEUED)
- Check run completion

**Exit Transitions:**
- None (terminal)

**Terminal:** Yes

---

#### FAILED
**Description:** Task permanently failed after exhausting retries. Terminal.

**Entry Conditions:**
- Execution failed
- retry_count >= MAX_RETRIES (default 3)

**Actions:**
- Record error message
- Move to dead-letter queue
- Propagate failure to dependent tasks (→ SKIPPED)
- Check run completion

**Exit Transitions:**
- → QUEUED (manual retry via dead-letter API)

**Terminal:** Yes (but retriable)

---

#### SKIPPED
**Description:** Skipped because dependency failed. Terminal.

**Entry Conditions:**
- One or more dependencies in FAILED or SKIPPED state

**Actions:**
- Record reason: "Dependency failed"
- Propagate skip to dependent tasks

**Exit Transitions:**
- None (terminal)

**Terminal:** Yes

---

#### CANCELLED
**Description:** Cancelled by user. Terminal.

**Entry Conditions:**
- Run cancelled while task was non-terminal

**Actions:**
- Record cancellation timestamp
- Do not execute

**Exit Transitions:**
- None (terminal)

**Terminal:** Yes

---

### State Transition Rules

```typescript
const LEGAL_TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  PENDING: ['QUEUED', 'SKIPPED', 'CANCELLED'],
  QUEUED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['RUNNING', 'QUEUED', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'QUEUED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: ['QUEUED'],  // Manual retry
  SKIPPED: [],
  CANCELLED: []
};
```

---

## Task Dependency Resolution

### Dependency Graph

Tasks specify dependencies as an array of task names:

```json
{
  "name": "Write code",
  "dependencies": ["Research API", "Design architecture"],
  "action": "file_write",
  "args": {...}
}
```

### Dependency Validation

During task graph creation, TaskBroker validates:

1. **All dependencies exist:** Every name in dependencies array matches a task name in the same run
2. **No circular dependencies:** Detects cycles using depth-first search
3. **Acyclic graph:** Ensures task graph is a Directed Acyclic Graph (DAG)

**Algorithm:**
```typescript
function detectCycle(tasks: Task[]): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function dfs(taskName: string): boolean {
    if (recursionStack.has(taskName)) {
      return true;  // Cycle detected
    }
    if (visited.has(taskName)) {
      return false;
    }
    
    visited.add(taskName);
    recursionStack.add(taskName);
    
    const task = tasks.find(t => t.name === taskName);
    for (const dep of task.dependencies) {
      if (dfs(dep)) {
        return true;
      }
    }
    
    recursionStack.delete(taskName);
    return false;
  }
  
  for (const task of tasks) {
    if (dfs(task.name)) {
      return true;
    }
  }
  return false;
}
```

### Dependency Satisfaction

A task transitions from PENDING → QUEUED when:

```sql
-- All dependencies are in terminal states
SELECT COUNT(*) FROM tasks
WHERE id = ANY(dependency_ids)
  AND state NOT IN ('SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED')
  
-- If count = 0, all dependencies are terminal
```

**Checking logic:**
```typescript
function areDependenciesSatisfied(task: Task): boolean {
  if (task.dependencies.length === 0) {
    return true;  // No dependencies
  }
  
  for (const depId of task.dependencies) {
    const depTask = getTaskById(depId);
    if (!isTerminal(depTask.state)) {
      return false;  // Dependency not complete
    }
    if (depTask.state === 'FAILED' || depTask.state === 'SKIPPED') {
      // Mark this task as SKIPPED
      transitionTaskState(task.id, 'SKIPPED');
      return false;
    }
  }
  
  return true;  // All dependencies succeeded
}
```

### Parallelism

Tasks with no shared dependencies can run in parallel:

```json
[
  {"name": "Task A", "dependencies": []},
  {"name": "Task B", "dependencies": []},
  {"name": "Task C", "dependencies": ["Task A", "Task B"]}
]
```

- Task A and Task B run concurrently
- Task C waits for both to complete

---

## Retry Logic

### Retry Conditions

A task is retried when:
1. Tool execution fails (TOOL_ERROR)
2. Provider call times out (TIMEOUT)
3. Provider returns transient error (429, 503)
4. Network error (ECONNREFUSED, ETIMEDOUT)

A task is NOT retried when:
1. Policy denies action (POLICY_DENIED)
2. Task output explicitly fails validation
3. retry_count >= MAX_RETRIES

### Retry Parameters

```typescript
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];  // milliseconds
```

### Retry Algorithm

```typescript
async function failTask(
  taskId: string,
  errorType: string,
  errorMessage: string
): Promise<boolean> {
  const task = await getTaskById(taskId);
  
  if (task.retry_count < MAX_RETRIES) {
    // Retry
    await db.query(`
      UPDATE tasks
      SET 
        retry_count = retry_count + 1,
        state = 'QUEUED'
      WHERE id = $1
    `, [taskId]);
    
    const delay = RETRY_DELAYS[task.retry_count] || 4000;
    await sleep(delay);
    
    return true;  // Retried
  } else {
    // Permanent failure
    await transitionTaskState(taskId, 'FAILED');
    await deadLetterHandler.enqueue(taskId, errorType, errorMessage);
    await checkRunCompletion(task.run_id);
    
    return false;  // Not retried
  }
}
```

### Exponential Backoff

Retry delays increase exponentially to handle transient issues:

| Retry | Delay |
|-------|-------|
| 0 (first attempt) | 0s |
| 1 (first retry) | 1s |
| 2 (second retry) | 2s |
| 3 (third retry) | 4s |
| 4+ | 4s (capped) |

---

## Checkpoint and Resume

### Checkpoint Creation

Checkpoints are created:
1. **Automatically:** Before run cancellation
2. **Manually:** Via POST /api/runs/:id/checkpoint
3. **Periodically:** Every N minutes during long runs (future feature)

**Checkpoint Contents:**
```json
{
  "id": "checkpoint-uuid",
  "run_id": "run-uuid",
  "run_state": "EXECUTING",
  "task_snapshot": [
    {
      "id": "task-1",
      "state": "SUCCEEDED",
      "output": {...},
      "cost": 0.002
    },
    {
      "id": "task-2",
      "state": "RUNNING",
      "output": null,
      "cost": 0
    },
    {
      "id": "task-3",
      "state": "PENDING",
      "output": null,
      "cost": 0
    }
  ],
  "created_at": "2026-03-21T10:03:00Z"
}
```

### Checkpoint Restore

Resume process:
1. User calls POST /api/runs/:id/resume
2. Fetch latest checkpoint
3. **Transaction:**
   - Lock checkpoint (SELECT FOR UPDATE)
   - Check restored_at IS NULL (idempotency guard)
   - Restore run state
   - Restore task states from snapshot
   - Re-queue all non-terminal tasks
   - Mark checkpoint as restored
   - Commit
4. Call TaskBroker.queueReadyTasks()
5. Call TaskBroker.dispatchTasks()

**State Restoration:**
- SUCCEEDED tasks: Keep as SUCCEEDED
- FAILED tasks: Keep as FAILED
- PENDING, QUEUED, DISPATCHED, RUNNING: Reset to QUEUED
- SKIPPED, CANCELLED: Keep as-is

**Idempotency:** The `restored_at` timestamp prevents double-restore. Once a checkpoint is restored, it cannot be restored again.

### Resume from FAILED

When resuming a FAILED run:
1. Run transitions: FAILED → PLANNING
2. Planner agent analyzes failures
3. Generates new or modified task plan
4. Old failed tasks remain in history
5. New tasks created for retry attempt

---

## Concurrency Control

### Global Concurrency Limit

```typescript
const MAX_CONCURRENT_TASKS = 10;
```

Limits total number of tasks in DISPATCHED or RUNNING state across all runs.

### Concurrency Enforcement

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Count active tasks
SELECT COUNT(*) FROM tasks
WHERE state IN ('DISPATCHED', 'RUNNING');

-- Calculate available slots
SET available = maxConcurrent - activeCount;

-- Select tasks to dispatch
SELECT * FROM tasks
WHERE run_id = $1
  AND state = 'QUEUED'
ORDER BY created_at ASC
LIMIT available
FOR UPDATE SKIP LOCKED;

-- Update selected to DISPATCHED
UPDATE tasks
SET state = 'DISPATCHED'
WHERE id = ANY(selected_ids);

COMMIT;
```

**Key Techniques:**
- SERIALIZABLE isolation prevents TOCTOU races
- FOR UPDATE SKIP LOCKED prevents double-dispatch
- Atomic count+select+dispatch

### Per-Run Concurrency

Future enhancement: Add per-run concurrency limits to prevent one run from hogging all slots.

---

## Orphan Recovery

### Orphan Definition

A task is orphaned when:
- State is DISPATCHED or RUNNING
- Last updated > 5 minutes ago
- Worker process crashed or killed

### Recovery Process

Triggered on service startup:

1. **Acquire advisory lock** (PostgreSQL pg_advisory_lock)
2. **Wait grace period** (2 minutes) - allows orderly shutdown
3. **Find orphans:**
```sql
SELECT id FROM tasks
WHERE state IN ('DISPATCHED', 'RUNNING')
  AND updated_at < NOW() - INTERVAL '5 minutes';
```
4. **Re-queue:**
```sql
UPDATE tasks
SET state = 'QUEUED'
WHERE id = ANY(orphan_ids);
```
5. **Release lock**

**Concurrency Safety:** Advisory lock ensures only one instance recovers orphans in multi-instance deployments.

---

## Run Completion Logic

After every task completion or failure, check if run should complete:

```typescript
async function checkRunCompletion(runId: string): Promise<void> {
  const tasks = await db.query(`
    SELECT state, COUNT(*) as count
    FROM tasks
    WHERE run_id = $1
    GROUP BY state
  `, [runId]);
  
  const total = tasks.reduce((sum, row) => sum + row.count, 0);
  const terminal = tasks.filter(row =>
    ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(row.state)
  ).reduce((sum, row) => sum + row.count, 0);
  
  if (terminal === total) {
    // All tasks terminal
    const hasFailed = tasks.some(row =>
      ['FAILED', 'SKIPPED'].includes(row.state) && row.count > 0
    );
    
    if (hasFailed) {
      await stateMachine.transitionRunState(runId, 'FAILED');
    } else {
      await stateMachine.transitionRunState(runId, 'COMPLETED');
    }
  }
}
```

**Rules:**
- If any task FAILED or SKIPPED → Run FAILED
- If all tasks SUCCEEDED or CANCELLED → Run COMPLETED
- Otherwise → Run continues

---

## State Machine Guarantees

### Atomicity

Every state transition is wrapped in a database transaction. Either the state changes and audit event is created, or neither happens.

### Consistency

Legal transition validation ensures the state machine never enters an invalid state. Illegal transitions throw errors and roll back.

### Isolation

SERIALIZABLE transactions prevent race conditions:
- Two workers cannot dispatch the same task
- Two state transitions cannot conflict
- Orphan recovery doesn't race with active workers

### Durability

All state changes are persisted to PostgreSQL before returning. Crash recovery restores exact state.

### Observability

Every state transition creates an audit event with:
- Previous state
- New state
- Timestamp
- Reason (if provided)
- Correlation ID

---

This completes the state machine and task lifecycle documentation with full details on states, transitions, dependencies, retries, checkpoints, concurrency, and orphan recovery.
