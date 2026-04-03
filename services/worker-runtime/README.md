# Worker Runtime Service

The Worker Runtime executes tools and actions in sandboxed environments, providing secure and isolated execution for AI-generated commands.

## Overview

The Worker Runtime provides:
- Docker-based sandboxed execution for shell commands
- MCP (Model Context Protocol) tool interface
- Built-in tools for file I/O, web search, and HTTP requests
- Rate limiting and resource controls
- Artifact generation and storage

## Components

### WorkerRuntime (`index.ts`)

Main orchestrator for tool execution.

```typescript
const runtime = new WorkerRuntime(pool, artifactStore, policyEngine);

// Execute a tool
const result = await runtime.executeTool({
  name: 'bash_exec',
  args: { command: 'ls -la' },
  runId: 'run-123',
  taskId: 'task-456'
});
```

### DockerSandbox (`docker-sandbox.ts`)

Executes commands in isolated Docker containers.

```typescript
const sandbox = new DockerSandbox();

const result = await sandbox.execute({
  command: 'npm install',
  timeout: 60000,
  limits: {
    memory: '512MB',
    cpus: '1',
    network: 'none'
  }
});
```

**Sandbox Limits:**
- Memory: 512MB default
- CPU: 1 core
- Timeout: 60 seconds
- Network: Isolated (none)
- Filesystem: Read-only root

### MCPServer (`mcp-server.ts`)

Wraps tools in Model Context Protocol format for AI system compatibility.

```typescript
const mcpServer = new MCPServer(runtime);

// Handle MCP tool call request
const response = await mcpServer.handleRequest({
  jsonrpc: '2.0',
  method: 'tools/call',
  params: {
    name: 'read_file',
    arguments: { path: './README.md' }
  },
  id: 1
});
```

## Built-in Tools

### `web_search`

DuckDuckGo search with rate limiting.

```typescript
const result = await runtime.executeTool({
  name: 'web_search',
  args: { query: 'TypeScript async patterns', maxResults: 5 }
});
```

**Rate Limit:** 1 request per second

### `read_file`

Read local files with path validation.

```typescript
const result = await runtime.executeTool({
  name: 'read_file',
  args: { path: './src/index.ts' }
});
```

**Security:** Paths outside workspace are blocked.

### `write_file`

Write files with path validation and policy check.

```typescript
const result = await runtime.executeTool({
  name: 'write_file',
  args: {
    path: './output/result.json',
    content: JSON.stringify(data)
  }
});
```

**Risk Level:** ELEVATED (logged, may require approval for sensitive paths)

### `bash_exec`

Execute shell commands in Docker sandbox.

```typescript
const result = await runtime.executeTool({
  name: 'bash_exec',
  args: { command: 'npm run build' }
});
```

**Risk Level:** HIGH_RISK (requires approval in production)

### `http_request`

Make HTTP requests with SSRF protection.

```typescript
const result = await runtime.executeTool({
  name: 'http_request',
  args: {
    url: 'https://api.example.com/data',
    method: 'GET',
    headers: { 'Authorization': 'Bearer token' }
  }
});
```

**Security:** Private IPs and metadata endpoints blocked.

## Execution Flow

```
1. Receive tool request
2. Validate tool exists and args are valid
3. Check policy engine for authorization
   - If BLOCKED: return error
   - If HIGH_RISK: check for approval
4. Execute in Docker sandbox (or local fallback)
5. Capture stdout/stderr
6. Store artifacts if generated
7. Emit TOOL_RESULT audit event
8. Return result with metadata
```

## API

### Tool Execution

```typescript
// Execute single tool
executeTool(request: ToolRequest, context?: ExecutionContext): Promise<ToolResult>

// List available tools
listAvailableTools(): Tool[]

// Get tool definition
getTool(name: string): Tool | undefined
```

### MCP Protocol

```typescript
// Handle MCP JSON-RPC request
handleMCPRequest(request: MCPRequest): Promise<MCPResponse>

// Get tool manifest for MCP
getToolManifest(): MCPToolManifest
```

### Docker Sandbox

```typescript
// Execute in sandbox
executeInSandbox(command: string, options?: SandboxOptions): Promise<ExecutionResult>

// Check if Docker is available
isDockerAvailable(): Promise<boolean>
```

## Tool Request/Result

```typescript
interface ToolRequest {
  name: string;
  args: Record<string, unknown>;
  runId: string;
  taskId: string;
}

interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  artifacts?: ArtifactMetadata[];
  durationMs: number;
  exitCode?: number;
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_AVAILABLE` | auto-detect | Whether Docker sandbox is available |
| `SANDBOX_TIMEOUT` | `60000` | Tool execution timeout (ms) |
| `SANDBOX_MEMORY` | `512MB` | Container memory limit |
| `SANDBOX_CPUS` | `1` | Container CPU limit |
| `WEB_SEARCH_RATE_LIMIT` | `1000` | Min ms between web searches |
| `MAX_OUTPUT_SIZE` | `1048576` | Max output size (1MB) |

## Security Features

### Path Traversal Protection

All file operations validate paths:
- Must be within workspace directory
- No `..` traversal allowed
- Symlinks resolved and validated

### SSRF Protection

HTTP requests are validated:
- Private IP ranges blocked
- AWS metadata endpoint blocked
- DNS resolution checked

### Command Injection Protection

Shell commands are sanitized:
- Special characters escaped
- Command length limited
- Dangerous commands blocked at policy level

## Usage Example

```typescript
import { WorkerRuntime } from '@autoorch/worker-runtime';
import { ArtifactStore } from '@autoorch/artifact-store';
import { PolicyEngine } from '@autoorch/policy-engine';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const artifactStore = new ArtifactStore(pool);
const policyEngine = new PolicyEngine(pool);
const runtime = new WorkerRuntime(pool, artifactStore, policyEngine);

// Execute web search
const searchResult = await runtime.executeTool({
  name: 'web_search',
  args: { query: 'Node.js best practices' },
  runId: 'run-123',
  taskId: 'task-456'
});

if (searchResult.success) {
  console.log('Search results:', searchResult.output);
}

// Execute build command
const buildResult = await runtime.executeTool({
  name: 'bash_exec',
  args: { command: 'npm run build' },
  runId: 'run-123',
  taskId: 'task-789'
});

if (buildResult.success) {
  console.log('Build output:', buildResult.output);
} else {
  console.error('Build failed:', buildResult.error);
}
```

## Testing

```bash
npx vitest run tests/unit/worker-runtime-tools.test.ts
npx vitest run tests/unit/mcp-docker-sandbox.test.ts
npx vitest run tests/verification/v7-sandbox-isolation.test.ts
```
