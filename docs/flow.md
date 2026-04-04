# AutoOrch — End-to-End System Flow

This document explains how AutoOrch works from the moment a user opens the dashboard to the final completion of a run. It covers every step, every decision point, and every safety check in the system. No code is included — this is a plain-English walkthrough of the entire platform.

---

## The Big Picture

AutoOrch turns a single business prompt into a governed, multi-agent execution workflow. Think of it as a virtual company where each department (planning, research, engineering, review, operations) is handled by an AI agent, but a human control plane sits on top to enforce safety, budget, and approval rules.

The flow is:

```
User Prompt → Run Created → Task Plan Generated → Providers Selected
→ Tasks Executed (with safety checks) → Approvals Requested (if needed)
→ Results Collected → Run Completed
```

Every step is logged, every decision is auditable, and the system can recover from crashes at any point.

---

## Step-by-Step Flow

### 1. User Submits a Prompt

The user opens the React dashboard in their browser. On the left panel, they see a text area for entering a business prompt — something like "Build a landing page for our new product with SEO optimization."

When they click "Start Run," two things happen in sequence:
- The API creates a new **Run** record in the database with state `DRAFT`. The run gets a unique ID, a correlation ID for tracing, and default budget limits (100,000 tokens, $10 USD, 50 iterations).
- The API immediately transitions the run from `DRAFT` to `PLANNING`.

The user can optionally select which AI providers to use for this run (e.g., Ollama for local, Gemini or OpenAI for cloud, or any provider registered via the Universal AI Gateway) and adjust budget limits before starting.

### 2. Run Enters the Planning Phase

Once the run is in `PLANNING` state, the orchestration engine takes over. The planner agent receives the user's prompt and decomposes it into a **task graph** — a set of individual work items with dependencies between them.

For example, the prompt "Build a landing page" might become:
- Task 1 (Researcher): "Research current landing page best practices and SEO requirements"
- Task 2 (Builder): "Create the HTML/CSS for the landing page" — depends on Task 1
- Task 3 (Builder): "Write SEO-optimized copy" — depends on Task 1
- Task 4 (Reviewer): "Review the page against requirements" — depends on Tasks 2 and 3
- Task 5 (Operations): "Deploy the landing page" — depends on Task 4

Each task is assigned to an **agent role** (Planner, Researcher, Builder, Reviewer, or Operations). Tasks start in `PENDING` state.

### 3. Provider Routing

The run transitions to `ROUTING` state. For each agent role that has tasks in this run, the system needs to pick which AI model will handle the work.

The **Provider Router** follows this priority chain:

1. **User override**: If the user selected a specific provider when creating the run, that provider is used.
2. **Run-level override**: If a provider was configured for this specific run's agent roles, those are used.
3. **Role mapping priority**: The database stores a priority-ordered list of providers for each role. The router walks down the list, skipping any provider that is currently unhealthy.
4. **Capability check**: If a task requires strict JSON output (like routing or approval decisions), the router skips providers that don't support structured output. For example, Ollama might be skipped for a task that needs guaranteed JSON.
5. **Fallback**: If no mapped provider is available, the router tries any healthy provider that meets the capability requirements.

If no provider is available at all, the run transitions to `FAILED`.

### 4. Task Execution Begins

The run transitions to `EXECUTING`. Now the **Task Broker** starts processing the task graph.

The broker works in cycles:

**Queue ready tasks**: It scans all `PENDING` tasks and checks their dependencies. If all dependencies have `SUCCEEDED` or been `SKIPPED`, the task moves to `QUEUED`.

**Dispatch tasks**: Up to 5 tasks can run concurrently (configurable). The broker takes `QUEUED` tasks and sends them to the **Worker Runtime**. Each dispatched task moves to `DISPATCHED`, then to `RUNNING` once the worker picks it up.

**Wait for results**: As tasks complete, they either `SUCCEED` or `FAIL`. The broker checks for new tasks that can now be queued (because their dependencies just finished) and dispatches them.

This cycle continues until all tasks are done or the run fails.

### 5. Policy Evaluation (Before Every Action)

Before any task executes a tool action (writing a file, running a command, calling an API), the **Policy Engine** evaluates the action. This is the safety gate of the entire system.

The policy engine makes four checks:

**Is the action blocked?** Some actions are permanently blocked and can never execute: `rm_rf` (recursive delete), `format_disk`, `drop_database`, and `sudo` (privilege escalation). If the action matches any of these, it is immediately denied. No override, no approval — just blocked.

**Is the action high-risk?** These actions require human approval before they can proceed: `bash_exec` (running shell commands), `file_write` (writing files), `deploy` (deploying to production), `payment` (spending money), `external_api_call` (calling external services), `database_write` (modifying database records), `send_email` (sending communications). If the action is high-risk, the system creates an **Approval** record and pauses the task.

**Is the budget within limits?** The engine checks the run's current token usage and cost against the budget limits. If usage has exceeded the limit, the action is denied. If usage is above 80% of the limit, a warning is logged but the action is allowed.

**Is the loop count within limits?** If the number of completed tasks in the run exceeds the maximum iteration count, the action is denied. This prevents runaway agent loops.

### 6. Approval Gates

When a high-risk action is detected, the system enters a carefully controlled approval flow:

1. The run transitions to `WAITING_APPROVAL`.
2. An **Approval** record is created in the database with state `PENDING`. It includes the action name, risk level, a description of what the action will do, and a 30-minute timeout.
3. A WebSocket event is broadcast to the dashboard, and the **Approval Queue** component lights up.
4. The user sees the pending approval with all context: which task wants to do what, why it's classified as high-risk, and what the consequences might be.

The user has three options:

- **Approve**: The approval moves to `APPROVED` state. The task is re-queued for execution. The run transitions back to `EXECUTING`. The action proceeds.
- **Reject**: The approval moves to `REJECTED` state. The task is marked `FAILED` with reason `APPROVAL_REJECTED`. The run transitions to `PAUSED`, giving the user a chance to decide what to do next.
- **Do nothing (timeout)**: After 30 minutes, the approval expires. The system treats expiration as rejection (fail-closed). This ensures the system never executes a high-risk action without explicit human consent.

### 7. Tool Execution in the Sandbox

When a task's action is approved (or was low-risk enough to not need approval), the **Worker Runtime** executes it in a sandboxed environment.

The sandbox provides four tools:

- **file_read**: Reads a file from the workspace. Returns file contents.
- **file_write**: Writes content to a file in the workspace. The file is also stored as an **Artifact** in the database for traceability.
- **bash_exec**: Executes a shell command in a restricted environment. Dangerous commands are blocked even if the action passed policy evaluation.
- **web_search**: Performs a web search query and returns results.

Every tool invocation is logged as an audit event with the tool name, arguments, and result. This creates a complete record of everything the system did.

### 8. Provider Calls

When a task needs an AI model response (not just a tool action), the system calls the selected provider through the **Provider Adapter**.

All providers use the same interface regardless of whether they're local (Ollama), cloud (Gemini, OpenAI), or registered via the Universal AI Gateway. The adapter normalizes:

- **Request shape**: System prompt, user message, optional output schema, optional tool definitions, temperature, and max tokens.
- **Response shape**: Content text, parsed JSON (if schema was requested), token usage (prompt tokens, completion tokens, total tokens, cost in USD), model name, duration, and any tool calls the model wants to make.
- **Streaming**: For long-running responses, the adapter can stream chunks back for real-time display.

If a provider call fails:
- **Timeout or server error (500/502/503)**: The system retries with exponential backoff.
- **Rate limit (429)**: The system waits and retries. The provider is NOT marked unhealthy — rate limits are temporary.
- **Auth failure (401/403)**: The provider IS marked unhealthy. The system fails over to the next provider in the fallback chain.
- **Invalid JSON response**: If strict JSON was required (for routing or approval decisions), the response is rejected. For non-critical tasks, the system attempts to repair the JSON by extracting it from markdown code blocks, finding JSON within curly braces, or fixing trailing commas.

### 9. Task Completion and Retry

When a task finishes execution, its result is evaluated:

**Success**: The task transitions to `SUCCEEDED`. Its output and token usage are recorded. The task broker checks if any dependent tasks can now be queued.

**Failure**: The task transitions to `FAILED`. The failure is classified by type:
- **Retryable** (PROVIDER_ERROR, TIMEOUT, INVALID_OUTPUT): If the task has retries remaining (default: 2), it is automatically re-queued. The retry count is incremented, and the delay increases exponentially (1s → 2s → 4s).
- **Non-retryable** (BUDGET_EXCEEDED, POLICY_DENIED, APPROVAL_REJECTED, SANDBOX_ERROR, INTERNAL_ERROR): The task stays in `FAILED`. Downstream tasks that depend on it are `SKIPPED`.

If a critical task fails terminally (all retries exhausted), the entire run transitions to `FAILED`.

### 10. Run Completion

When the task broker detects that all tasks are either `SUCCEEDED`, `SKIPPED`, or `CANCELLED`, and no tasks are still active, the run transitions to `COMPLETED`.

At this point:
- All outputs are stored in the database.
- A final checkpoint is saved.
- A completion audit event is emitted.
- The dashboard updates in real time to show the completed status.

### 11. Crash Recovery and Resume

If the server crashes mid-run, everything needed to recover is in the database:

- **Checkpoints** are saved after every state transition. A checkpoint captures the run state, all task states, completed outputs, provider selections, and budget usage.
- On restart, the system loads the latest checkpoint.
- `EXECUTING` runs become `PAUSED`.
- `RUNNING` or `DISPATCHED` tasks (which were in-flight when the crash happened) are re-queued to `QUEUED` for re-dispatch.
- `SUCCEEDED` tasks are NOT re-executed — they are idempotent.
- `PENDING` tasks stay as-is, waiting for their dependencies.

The user can then click "Resume" in the dashboard to restart execution from where it left off. A new correlation ID is generated for the resumed segment so the audit trail clearly shows what happened before and after the crash.

---

## Data Flow Diagram

```
┌──────────┐     ┌──────────────┐     ┌────────────────────┐
│  User    │────►│  Dashboard   │────►│   API Gateway      │
│ (Browser)│◄────│  (React)     │◄────│   (Express.js)     │
└──────────┘     └──────────────┘     └────────┬───────────┘
                       ▲                        │
                       │ WebSocket              │ REST
                       │ (live events)          ▼
                 ┌─────┴───────────────────────────────────┐
                 │          Orchestration Engine            │
                 │  ┌──────────┐  ┌───────────┐            │
                 │  │  State   │  │   Task    │            │
                 │  │ Machine  │  │  Broker   │            │
                 │  └──────────┘  └───────────┘            │
                 │  ┌──────────┐  ┌───────────┐            │
                 │  │Checkpoint│  │   JSON    │            │
                 │  │ Manager  │  │ Validator │            │
                 │  └──────────┘  └───────────┘            │
                 └──────┬──────────────┬───────────────────┘
                        │              │
              ┌─────────▼───┐    ┌─────▼──────────┐
              │   Policy    │    │   Provider     │
              │   Engine    │    │   Router       │
              │             │    │                │
              │ Risk Check  │    │ Ollama Adapter │
              │ Budget Check│    │ Gemini Adapter │
              │ Loop Check  │    │ OpenAI Adapter │
              │ Whitelist   │    │ Universal      │
              │             │    │  AI Gateway    │
              └─────────────┘    └────────────────┘
                        │              │
                  ┌─────▼──────┐       │
                  │  Approval  │       │
                  │  Queue     │       ▼
                  └────────────┘  ┌──────────────┐
                                  │   Worker     │
                                  │   Runtime    │
                                  │              │
                                  │ file_read    │
                                  │ file_write   │
                                  │ bash_exec    │
                                  │ web_search   │
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │  PostgreSQL  │
                                  │              │
                                  │ runs, tasks  │
                                  │ approvals    │
                                  │ audit_events │
                                  │ checkpoints  │
                                  │ artifacts    │
                                  │ providers    │
                                  └──────────────┘
```

---

## Event Flow

Every action in the system produces an audit event. These events flow through the system as follows:

1. A service (Orchestrator, Policy Engine, Worker Runtime) creates an audit event and writes it to the `audit_events` table in PostgreSQL.
2. The API Gateway's `broadcastEvent` function picks up the event and sends it to all connected WebSocket clients.
3. WebSocket clients can subscribe to events for a specific run (by passing `?runId=xxx`) or to all events globally.
4. The dashboard's Live Logs component displays events in real time, color-coded by type.

### Event Types

| Event Type | Source | When It Fires |
|---|---|---|
| RUN_CREATED | API | A new run is created |
| RUN_STATE_CHANGED | Orchestrator | Run transitions between states |
| TASK_STATE_CHANGED | Orchestrator/Broker | Task transitions between states |
| TASK_DISPATCHED | Broker | A task is sent to a worker |
| TASK_COMPLETED | Broker | A task finishes (success or failure) |
| PROVIDER_CALL_STARTED | Provider Router | A model API call begins |
| PROVIDER_CALL_COMPLETED | Provider Router | A model API call succeeds |
| PROVIDER_CALL_FAILED | Provider Router | A model API call fails |
| POLICY_EVALUATED | Policy Engine | An action is evaluated for safety |
| APPROVAL_REQUESTED | Policy Engine | A high-risk action needs approval |
| APPROVAL_RESOLVED | API | A user approves or rejects |
| TOOL_REQUEST | Worker Runtime | A tool is about to execute |
| TOOL_RESULT | Worker Runtime | A tool execution finished |

---

## Budget Flow

Budget enforcement is continuous throughout a run's lifecycle:

1. **At run creation**: Default budget limits are set (100K tokens, $10 USD, 50 iterations). The user can override these.
2. **Before every action**: The Policy Engine queries the database for the run's total token usage and cost (summed across all tasks), compares against the limits.
3. **At 80% threshold**: A budget warning event is emitted. The dashboard's Budget Monitor turns yellow.
4. **At 100% threshold**: The action is denied. The task fails with `BUDGET_EXCEEDED`. The run may transition to `FAILED` if the task was critical.
5. **Mixed local/cloud tracking**: Local Ollama calls report zero cost but do count tokens. Cloud calls report actual cost based on provider pricing.

---

## Provider Health Flow

Providers are continuously monitored:

1. **Periodic health checks** run every 30 seconds. Each provider's adapter calls its health endpoint (Ollama: `/api/tags`, Gemini: models list, OpenAI: `/v1/models`, Gateway providers: their configured health path).
2. **On success**: Provider is marked healthy, consecutive failure count resets to zero.
3. **On failure**: Consecutive failure count increments (capped at 999,999). After multiple failures, the provider is marked unhealthy.
4. **Routing impact**: The Provider Router skips unhealthy providers when selecting a backend for a task.
5. **Recovery**: When a previously unhealthy provider passes a health check, it becomes available again automatically. No manual intervention needed.

---

## Secrets Flow

Secrets (API keys, database credentials) are resolved at startup:

1. **Docker secrets** (highest priority): In production, secrets are mounted as files at `/run/secrets/`. The Secrets Manager reads them directly.
2. **Environment variables**: In development, secrets come from `.env` files or shell environment.
3. **Defaults**: For local development, safe defaults exist (like the local PostgreSQL password).

The Secrets Manager never exposes secret values through the API. The `/api/observability/secrets-audit` endpoint only reports which keys are loaded and from which source.

---

## Dashboard Interaction Flow

The React dashboard provides real-time control over the entire system:

**Left Panel** (always visible):
- **Run Submission**: Enter prompt, click start. A new run appears immediately.
- **Run List**: Auto-refreshes every 5 seconds. Shows all runs with color-coded status badges.
- **Provider Selector**: Shows all enabled providers with health status dots and capability badges.

**Right Panel** (appears when a run is selected):
- **Action Buttons**: Resume (for paused/failed runs) and Cancel.
- **Task Graph**: Auto-refreshes every 3 seconds. Shows each task with agent role, state, retry count, and token usage.
- **Approval Queue**: Polls every 5 seconds. Shows pending approvals with Approve/Reject buttons. Only appears when approvals exist.
- **Live Logs**: WebSocket-connected event stream. Color-coded by event type. Shows the last 200 events. Auto-reconnects on disconnect.
- **Budget Monitor**: Three progress bars (tokens, cost, iterations) that change color as usage approaches limits.
- **Checkpoint History**: Lists all saved checkpoints with sequence number and timestamp.
