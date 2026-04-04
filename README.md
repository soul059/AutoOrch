# AutoOrch

**Prompt-to-Company Orchestration Control Plane**

AutoOrch is a production-oriented multi-agent orchestration platform that converts a single business prompt into a governed, observable, and auditable multi-agent workflow. It separates orchestration, provider selection, policy enforcement, and tool execution so that model and vendor support can expand without redesigning the system.

---

## Key Features

- **Multi-Agent Orchestration** — Break complex goals into tasks assigned to specialized agent roles (Planner, Researcher, Builder, Reviewer, Operations)
- **Universal AI Gateway** — Integrate ANY AI provider (OpenAI, Anthropic, Ollama, Gemini, Groq, Mistral, DeepSeek, LMStudio, or custom) through config-driven presets — no code changes needed
- **Human-in-the-Loop Approvals** — High-risk actions require explicit human approval before execution; the system never acts without consent
- **Budget Governance** — Token limits, cost caps, and loop caps prevent runaway execution and spending
- **Sandboxed Tool Execution** — MCP tools run in a controlled worker runtime with tool whitelisting and policy enforcement
- **Checkpoint & Resume** — Runs survive crashes; completed work is preserved and execution resumes from the last safe point
- **Full Audit Trail** — Every state transition, provider call, approval decision, and tool execution is logged with correlation IDs
- **Real-Time Dashboard** — React-based UI with live logs, task graph, approval queue, budget monitor, and provider health

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      React Dashboard (:3000)                   │
│   Run Submission │ Task Graph │ Approvals │ Logs │ Budget      │
└──────────────────────────┬─────────────────────────────────────┘
                           │ HTTP + WebSocket
┌──────────────────────────▼─────────────────────────────────────┐
│                     API Gateway (:3001)                         │
│   Routes │ Middleware │ CORS │ Correlation IDs                  │
├────────────┬───────────┬───────────┬──────────────────────────-─┤
│ Orchestrator│ Provider  │  Policy   │    Worker Runtime          │
│ State Machine│ Registry │  Engine   │    (MCP Sandbox)           │
│ Task Broker │ Adapters  │ Approvals │    Tool Whitelisting       │
│ Checkpoints │ Routing   │ Budget    │    Action Isolation        │
├─────────────┴───────────┴───────────┴──────────────────────────-┤
│                PostgreSQL (:5432)                                │
│   Runs │ Tasks │ Approvals │ Audit Events │ Checkpoints         │
└─────────────────────────────────────────────────────────────────┘
```

For detailed architecture documentation, see [docs/architecture-split.md](docs/architecture-split.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express |
| Frontend | React, Vite |
| Database | PostgreSQL 16 |
| Real-time | WebSocket (ws) |
| Local AI | Ollama |
| Cloud AI | Gemini API, OpenAI-compatible APIs |
| Testing | Vitest |
| Container | Docker, Docker Compose |
| Monorepo | npm Workspaces |

---

## Project Structure

```
autoorch/
├── apps/
│   ├── api/                    # Express API server
│   │   └── src/
│   │       ├── server.ts       # Entry point
│   │       ├── routes/         # REST endpoints
│   │       ├── config/         # Database, secrets, observability
│   │       └── middleware/     # CORS, correlation IDs
│   └── web/                    # React dashboard
│       └── src/
│           ├── App.tsx         # Main app
│           ├── components/     # UI components
│           ├── hooks/          # WebSocket hook
│           └── services/       # API client
├── services/
│   ├── orchestrator/           # State machine, task broker, checkpoints
│   ├── provider-registry/      # Adapters (Ollama, Gemini, OpenAI, Universal Gateway)
│   ├── policy-engine/          # Risk classification, budget enforcement
│   ├── worker-runtime/         # Sandboxed MCP tool execution
│   └── artifact-store/         # Artifact storage with path traversal protection
├── packages/
│   └── shared-schemas/         # TypeScript types, enums, event contracts
├── infrastructure/
│   ├── db/migrations/          # PostgreSQL schema + seed data (10 migration files)
│   ├── docker/                 # Dockerfiles
│   └── secrets/                # Secret files (not committed)
├── tests/
│   ├── unit/                   # Unit test suites
│   └── integration/            # Chaos/integration tests
├── docs/                       # Architecture, flow, features, usage guide
├── docker-compose.yml          # Full stack deployment
├── package.json                # Root workspace config
└── tsconfig.base.json          # Shared TypeScript config
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Option 1: Docker (Recommended)

```bash
# Start all services
docker compose up -d

# Pull a local AI model (optional)
docker exec autoorch-ollama ollama pull llama3.2

# Open dashboard
open http://localhost:3000
```

### Option 2: Local Development

```bash
# Start PostgreSQL
docker run -d --name autoorch-postgres \
  -e POSTGRES_DB=autoorch \
  -e POSTGRES_USER=autoorch \
  -e POSTGRES_PASSWORD=autoorch_dev_password \
  -p 5432:5432 \
  -v ./infrastructure/db/migrations:/docker-entrypoint-initdb.d \
  postgres:16-alpine

# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Build TypeScript
npx tsc -b packages/shared-schemas/tsconfig.json \
  services/orchestrator/tsconfig.json \
  services/provider-registry/tsconfig.json \
  services/policy-engine/tsconfig.json \
  services/worker-runtime/tsconfig.json \
  apps/api/tsconfig.json

# Start API server (terminal 1)
npm run dev:api

# Start dashboard (terminal 2)
npm run dev:web
```

See the full [Usage Guide](docs/usage-guide.md) for detailed setup and configuration instructions.

---

## API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/runs` | POST | Create a new run |
| `/api/runs` | GET | List all runs |
| `/api/runs/:id` | GET | Get run details |
| `/api/runs/:id/start` | POST | Start a run |
| `/api/runs/:id/cancel` | POST | Cancel a run |
| `/api/runs/:id/resume` | POST | Resume from checkpoint |
| `/api/approvals/pending` | GET | List pending approvals |
| `/api/approvals/:id/approve` | POST | Approve an action |
| `/api/approvals/:id/reject` | POST | Reject an action |
| `/api/tasks/run/:runId` | GET | List tasks for a run |
| `/api/providers` | GET | List providers |
| `/api/providers` | POST | Register a provider |
| `/api/audit/run/:runId` | GET | View audit trail |
| `/api/health` | GET | Health check |
| `/api/observability/metrics` | GET | Prometheus metrics |

See the [Usage Guide](docs/usage-guide.md) for full API examples with curl.

---

## Documentation

| Document | Description |
|---|---|
| [Usage Guide](docs/usage-guide.md) | How to set up, run, and use AutoOrch |
| [How to Run](docs/how-to-run.md) | Quick start and running locally |
| [Architecture](docs/architecture-split.md) | 8-layer architectural decomposition |
| [Services Overview](docs/services-overview.md) | Comprehensive service documentation |
| [System Flow](docs/flow.md) | End-to-end request flow with diagrams |
| [Features](docs/features.md) | Detailed feature explanations |
| [Orchestration Contract](docs/orchestration-contract.md) | State machines, transitions, retry/checkpoint |
| [Provider System](docs/provider-system.md) | Universal AI Gateway and provider adapters |
| [Configuration](docs/configuration.md) | Environment variables and settings |
| [API Reference](docs/api-reference.md) | REST API documentation |
| [Testing Guide](docs/testing-guide.md) | Testing strategies and examples |
| [Deployment Guide](docs/deployment-guide.md) | Production deployment instructions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Development Guide](docs/development-guide.md) | Contributing and extending AutoOrch |
| [Architecture Decisions](docs/architecture-decisions.md) | ADRs documenting design rationale |
| [Release Boundary](docs/release-boundary.md) | MVP scope and success criteria |

---

## Testing

AutoOrch includes 513 automated tests across 23 suites:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

**Unit Tests (16 suites):**

| Suite | Tests | Coverage |
|---|---|---|
| State Machine | 11 | State transitions, reachability, locking |
| State Machine Extended | 52 | Advanced transitions, concurrency |
| JSON Validator | 11 | Strict/lenient parsing, repair, edge cases |
| Provider Failover | 12 | Health filtering, capabilities, fallback chains |
| Provider Adapter Extended | 36 | Adapter implementations, response parsing |
| Approval Gates | 15 | Risk classification, lifecycle, budget enforcement |
| Checkpoint Recovery | 7 | Save/restore, task re-queuing, pruning |
| Checkpoint Concurrency | 18 | Concurrent checkpoint operations |
| Universal Gateway | 49 | Presets, request/response mapping, auth, streaming |
| Security | 55 | SSRF, path traversal, timing-safe comparison |
| Dead Letter Queue | 17 | Retry limits, DLQ operations |
| Budget Race | 18 | Concurrent budget checks |
| Audit Pagination | 18 | Cursor-based pagination |
| Worker Runtime Tools | 9 | Tool execution, sandboxing |
| MCP Docker Sandbox | 25 | Container isolation, resource limits |

**Integration Tests (1 suite):**

| Suite | Tests | Coverage |
|---|---|---|
| Chaos Tests | 13 | Provider failure, crashes, sandbox denial, concurrency |

**Verification Tests (7 suites):**

| Suite | Tests | Coverage |
|---|---|---|
| V1: E2E Scenarios | 13 | Ollama-only, cloud-only, mixed provider override |
| V2: State Completeness | 31 | Crash recovery from every state, transition coverage |
| V3: Routing Determinism | 17 | Strict JSON validation, fail-closed, determinism |
| V4: Approval Coverage | 26 | All high-risk + blocked actions, destructive args |
| V5: Provider Failover | 20 | Timeout, 429, auth-failure, audit trail |
| V6: Budget Enforcement | 17 | Run-level, role-level, mixed local/cloud costs |
| V7: Sandbox Isolation | 33 | Tool whitelists, blocked commands, blocked writes |

---

## Run States

```
DRAFT → PLANNING → ROUTING → EXECUTING ──→ COMPLETED
                                 ↓   ↑
                          WAITING_APPROVAL
                                 ↓
                             RETRYING ──→ FAILED
                                          ↓
                                        PAUSED ──→ (Resume)
                   CANCELLED ←── (any non-terminal state)
```

---

## Provider Support — Universal AI Gateway

AutoOrch includes a **Universal AI Gateway** that lets you integrate any AI provider through configuration alone. No code changes needed.

### Built-in Presets

| Provider | Auth Type | Default Model | Structured Output | Streaming | Cost |
|---|---|---|---|---|---|
| OpenAI | Bearer token | gpt-4 | ✅ High (0.95) | SSE | Per-token |
| Anthropic | Custom header (x-api-key) | claude-sonnet-4-20250514 | ✅ High (0.9) | SSE | Per-token |
| Ollama | None (local) | llama3.2 | ⚠️ Low (0.3) | NDJSON | Free |
| Gemini | API key in query | gemini-pro | ✅ Good (0.85) | ✅ | Per-token |
| Groq | Bearer token | llama-3.3-70b-versatile | ✅ Good (0.8) | ✅ | Per-token |
| Mistral | Bearer token | mistral-large-latest | ✅ Good (0.85) | ✅ | Per-token |
| Together AI | Bearer token | Llama-3-70b-chat-hf | ⚠️ Fair (0.7) | ✅ | Per-token |
| DeepSeek | Bearer token | deepseek-chat | ✅ Good (0.85) | ✅ | Per-token |
| LMStudio | None (local) | default | ⚠️ Medium (0.6) | ✅ | Free |
| OpenAI-compatible | Bearer token | default | ✅ | ✅ | Configurable |

### Custom Providers

Any HTTP-based AI API can be added by describing its request/response format:

```
POST /api/gateway/register
{
  "name": "my-custom-ai",
  "preset": "openai",              // Start from a preset (optional)
  "apiKey": "sk-...",              // API key
  "modelOverride": "gpt-4-turbo", // Override model
  "endpointOverride": "https://my-proxy.com"  // Override endpoint
}
```

Or provide a fully custom configuration with connection, auth, request mapping, response mapping, and streaming settings.

### Gateway API

| Endpoint | Description |
|---|---|
| `GET /api/gateway/presets` | List all built-in presets |
| `GET /api/gateway/presets/:name` | Get preset details |
| `POST /api/gateway/register` | Register a new provider |
| `POST /api/gateway/test` | Test connection to a provider |
| `PUT /api/gateway/:id/config` | Update provider configuration |

---

## Safety & Governance

- **Blocked Actions**: `rm -rf`, `format_disk`, `drop_database`, `sudo` — permanently denied
- **Approval-Required**: `bash_exec`, `file_write`, `deploy`, `payment`, `external_api_call`, `database_write`, `send_email`
- **Budget Caps**: Token, cost, and loop limits per run with 80% warnings
- **Approval Timeout**: 30-minute window; expired = rejected (fail-closed)
- **Tool Sandbox**: All MCP tools run in isolated worker with whitelisted actions only
- **Audit Trail**: Every action logged with timestamps, correlation IDs, and actor identity

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

---

## License

This project was built for the CHARUSAT Hackathon. See submission materials for license terms.
