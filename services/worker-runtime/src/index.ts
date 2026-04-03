import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';

const execAsync = promisify(exec);

// Simple HTTP GET helper for web search
function httpGet(url: string, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        httpGet(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// Parse DuckDuckGo HTML results
function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  
  // DuckDuckGo HTML lite page pattern
  // Results are in <a class="result-link">...</a> with <a class="result-snippet">...</a>
  const linkPattern = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="result-snippet"[^>]*>([^<]*)<\/a>/gi;
  
  // Alternative pattern for regular DuckDuckGo results
  const resultPattern = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  
  let match;
  while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
    results.push({
      url: match[1],
      title: match[2].trim(),
      snippet: '',
    });
  }
  
  // If no results found with first pattern, try alternative
  if (results.length === 0) {
    while ((match = resultPattern.exec(html)) !== null && results.length < 10) {
      const url = match[1];
      // Skip internal DDG links
      if (!url.includes('duckduckgo.com') && url.startsWith('http')) {
        results.push({
          url: url,
          title: match[2].trim(),
          snippet: '',
        });
      }
    }
  }
  
  // Extract snippets
  let snippetIndex = 0;
  while ((match = snippetPattern.exec(html)) !== null && snippetIndex < results.length) {
    results[snippetIndex].snippet = match[1].trim();
    snippetIndex++;
  }
  
  return results;
}

// Web search rate limiting with proper mutex
class SearchRateLimiter {
  private lastSearchTime = 0;
  private readonly rateLimitMs = 1000; // 1 request per second
  private queue: Array<() => void> = [];
  private isProcessing = false;

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    const now = Date.now();
    const timeSinceLastSearch = now - this.lastSearchTime;
    
    if (timeSinceLastSearch < this.rateLimitMs) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitMs - timeSinceLastSearch));
    }
    
    this.lastSearchTime = Date.now();
    const resolve = this.queue.shift();
    this.isProcessing = false;
    
    if (resolve) resolve();
    
    // Process next in queue
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }
}

const searchRateLimiter = new SearchRateLimiter();

export interface ToolExecutionRequest {
  taskId: string;
  runId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  artifacts?: Array<{ name: string; mimeType: string; path: string; sizeBytes: number }>;
}

export interface ArtifactStoreInterface {
  store(upload: {
    runId: string;
    taskId: string;
    name: string;
    mimeType: string;
    content: Buffer | string;
  }): Promise<{ id: string; storagePath: string }>;
}

// Import Docker sandbox and MCP server
import { getDockerSandbox, DockerSandbox } from './docker-sandbox.js';
import { MCPServer, createMCPServer } from './mcp-server.js';

// Configuration for sandbox
const SANDBOX_CONFIG = {
  basePath: process.env.SANDBOX_PATH || './sandbox',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB per file
  maxTotalSizeBytes: 100 * 1024 * 1024, // 100MB per run
  bashTimeoutMs: 30000, // 30s timeout for bash commands
  // Use Docker sandbox when available
  useDockerSandbox: process.env.USE_DOCKER_SANDBOX !== 'false',
  // Whitelisted commands for bash execution (safe commands only)
  allowedCommands: [
    'node', 'npm', 'npx',
    'python', 'python3', 'pip', 'pip3',
    'cat', 'ls', 'echo', 'pwd', 'head', 'tail', 'wc',
    'grep', 'find', 'sort', 'uniq',
    'mkdir', 'touch', 'cp', 'mv',
    'go', 'cargo', 'rustc',
    'java', 'javac',
  ],
};

// Get MIME type from file extension
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.py': 'text/x-python',
    '.java': 'text/x-java',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.h': 'text/x-c',
    '.hpp': 'text/x-c++',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.sh': 'application/x-sh',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.sql': 'application/sql',
    '.csv': 'text/csv',
  };
  return mimeTypes[ext] || 'text/plain';
}

// Validate and sanitize path to prevent traversal attacks
function validateAndResolvePath(basePath: string, relativePath: string): string {
  // Remove any path traversal attempts
  const sanitized = relativePath
    .replace(/\.\./g, '')
    .replace(/^[\/\\]+/, '')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_');
  
  const resolved = path.resolve(basePath, sanitized);
  const resolvedBase = path.resolve(basePath);
  
  if (!resolved.startsWith(resolvedBase)) {
    throw new Error('Path traversal detected');
  }
  
  return resolved;
}

// Check if a bash command is allowed
function isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();
  
  // Extract the base command (first word)
  const baseCommand = trimmed.split(/\s+/)[0].split(/[\/\\]/).pop() || '';
  
  // Check for dangerous patterns
  const dangerousPatterns = [
    /rm\s+(-rf?|--recursive)/i,
    />\s*\/dev\//,
    /sudo/i,
    /chmod\s+777/,
    /eval\s*\(/,
    /\$\(/,          // Command substitution
    /`[^`]+`/,       // Backtick substitution
    /;\s*(rm|sudo|chmod)/i,
    /\|\s*(rm|sudo|bash|sh)/i,
    /&&\s*(rm|sudo)/i,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Dangerous pattern detected: ${pattern}` };
    }
  }
  
  // Check if base command is whitelisted
  if (!SANDBOX_CONFIG.allowedCommands.includes(baseCommand)) {
    return { 
      allowed: false, 
      reason: `Command '${baseCommand}' not in whitelist. Allowed: ${SANDBOX_CONFIG.allowedCommands.join(', ')}` 
    };
  }
  
  return { allowed: true };
}

export class WorkerRuntime {
  private pool: Pool;
  private artifactStore: ArtifactStoreInterface | null = null;
  private sandboxBasePath: string;
  private dockerSandbox: DockerSandbox;
  private mcpServer: MCPServer | null = null;

  constructor(pool: Pool, artifactStore?: ArtifactStoreInterface) {
    this.pool = pool;
    this.artifactStore = artifactStore || null;
    this.sandboxBasePath = SANDBOX_CONFIG.basePath;
    this.dockerSandbox = getDockerSandbox();
    
    // Ensure sandbox directory exists
    if (!fs.existsSync(this.sandboxBasePath)) {
      fs.mkdirSync(this.sandboxBasePath, { recursive: true });
    }
  }

  // Initialize MCP server (lazy initialization)
  getMCPServer(): MCPServer {
    if (!this.mcpServer) {
      this.mcpServer = createMCPServer(this);
    }
    return this.mcpServer;
  }

  // Set artifact store (for dependency injection)
  setArtifactStore(store: ArtifactStoreInterface): void {
    this.artifactStore = store;
  }

  // Get the sandbox workspace path for a run/task
  private getSandboxPath(runId: string, taskId: string): string {
    const sandboxPath = path.join(this.sandboxBasePath, runId, taskId, 'workspace');
    if (!fs.existsSync(sandboxPath)) {
      fs.mkdirSync(sandboxPath, { recursive: true });
    }
    return sandboxPath;
  }

  // Clean up sandbox directory for a task (best-effort, swallows errors)
  private cleanupTaskSandbox(runId: string, taskId: string): void {
    const taskPath = path.join(this.sandboxBasePath, runId, taskId);
    try {
      if (fs.existsSync(taskPath)) {
        fs.rmSync(taskPath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[WorkerRuntime] Failed to cleanup sandbox for task ${taskId}: ${(err as Error).message}`);
    }
  }

  // Tool implementations
  private async toolFileWrite(args: Record<string, unknown>, runId: string, taskId: string): Promise<ToolExecutionResult> {
    const filePath = args.path as string;
    const content = args.content as string;

    if (!filePath || content === undefined) {
      return { success: false, error: 'file_write requires "path" and "content" arguments' };
    }

    // Validate content size
    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (contentBytes > SANDBOX_CONFIG.maxFileSizeBytes) {
      return { 
        success: false, 
        error: `File too large: ${contentBytes} bytes exceeds limit of ${SANDBOX_CONFIG.maxFileSizeBytes} bytes` 
      };
    }

    try {
      const sandboxPath = this.getSandboxPath(runId, taskId);
      const fullPath = validateAndResolvePath(sandboxPath, filePath);
      
      // Ensure parent directory exists
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Write the file
      fs.writeFileSync(fullPath, content, 'utf-8');
      
      // Store as artifact if artifact store is available
      let artifactId: string | null = null;
      if (this.artifactStore) {
        const artifact = await this.artifactStore.store({
          runId,
          taskId,
          name: path.basename(filePath),
          mimeType: getMimeType(filePath),
          content: content,
        });
        artifactId = artifact.id;
      }

      const artifacts = [{
        name: path.basename(filePath),
        mimeType: getMimeType(filePath),
        path: fullPath,
        sizeBytes: contentBytes,
      }];

      return {
        success: true,
        result: {
          message: `File written successfully: ${filePath}`,
          path: fullPath,
          sizeBytes: contentBytes,
          artifactId,
        },
        artifacts,
      };
    } catch (err) {
      return { success: false, error: `Failed to write file: ${(err as Error).message}` };
    }
  }

  private async toolFileRead(args: Record<string, unknown>, runId: string, taskId: string): Promise<ToolExecutionResult> {
    const filePath = args.path as string;

    if (!filePath) {
      return { success: false, error: 'file_read requires "path" argument' };
    }

    try {
      const sandboxPath = this.getSandboxPath(runId, taskId);
      const fullPath = validateAndResolvePath(sandboxPath, filePath);

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      const stats = fs.statSync(fullPath);
      if (stats.size > SANDBOX_CONFIG.maxFileSizeBytes) {
        return { 
          success: false, 
          error: `File too large to read: ${stats.size} bytes exceeds limit` 
        };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      return {
        success: true,
        result: {
          content,
          path: fullPath,
          sizeBytes: stats.size,
        },
      };
    } catch (err) {
      return { success: false, error: `Failed to read file: ${(err as Error).message}` };
    }
  }

  private async toolBashExec(args: Record<string, unknown>, runId: string, taskId: string): Promise<ToolExecutionResult> {
    const command = args.command as string;
    const timeoutMs = (args.timeout as number) || SANDBOX_CONFIG.bashTimeoutMs;
    const useDocker = (args.useDocker as boolean) ?? SANDBOX_CONFIG.useDockerSandbox;

    if (!command) {
      return { success: false, error: 'bash_exec requires "command" argument' };
    }

    // Validate command is allowed
    const validation = isCommandAllowed(command);
    if (!validation.allowed) {
      return { success: false, error: `Command not allowed: ${validation.reason}` };
    }

    const sandboxPath = this.getSandboxPath(runId, taskId);

    // Try Docker sandbox if enabled
    if (useDocker) {
      try {
        const result = await this.dockerSandbox.execute(command, {
          runId,
          taskId,
          workspacePath: sandboxPath,
        }, timeoutMs);

        return {
          success: result.exitCode === 0,
          result: {
            stdout: result.stdout,
            stderr: result.stderr,
            command,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            sandbox: result.usedDocker ? 'docker' : 'local',
          },
        };
      } catch (dockerErr) {
        // Fall through to local execution if Docker fails
        console.warn('[WorkerRuntime] Docker sandbox failed, falling back to local:', (dockerErr as Error).message);
      }
    }

    // Local execution (fallback or when Docker is disabled)
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: sandboxPath,
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024, // 5MB output buffer
        env: {
          ...process.env,
          HOME: sandboxPath,
          TMPDIR: sandboxPath,
        },
      });

      return {
        success: true,
        result: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          command,
          exitCode: 0,
          sandbox: 'local',
        },
      };
    } catch (err) {
      const execError = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message: string };
      
      if (execError.killed) {
        return { 
          success: false, 
          error: `Command timed out after ${timeoutMs}ms`,
          result: {
            stdout: execError.stdout || '',
            stderr: execError.stderr || '',
            command,
            timedOut: true,
            sandbox: 'local',
          },
        };
      }

      // Command failed but still executed (non-zero exit code)
      if (execError.stdout !== undefined || execError.stderr !== undefined) {
        return {
          success: true, // We consider execution success even if exit code != 0
          result: {
            stdout: execError.stdout || '',
            stderr: execError.stderr || '',
            command,
            exitCode: execError.code || 1,
            error: execError.message,
            sandbox: 'local',
          },
        };
      }

      return { success: false, error: `Failed to execute command: ${execError.message}` };
    }
  }

  private async toolWebSearch(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = args.query as string;
    const maxResults = Math.min((args.maxResults as number) || 5, 10);

    if (!query) {
      return { success: false, error: 'web_search requires "query" argument' };
    }

    // Rate limiting with proper mutex
    await searchRateLimiter.acquire();

    try {
      // Use DuckDuckGo HTML lite (no API key needed)
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
      
      const html = await httpGet(url, 15000);
      const results = parseDuckDuckGoResults(html).slice(0, maxResults);

      if (results.length === 0) {
        return {
          success: true,
          result: {
            query,
            results: [],
            message: 'No results found. Try different search terms.',
          },
        };
      }

      return {
        success: true,
        result: {
          query,
          resultCount: results.length,
          results: results.map((r, i) => ({
            rank: i + 1,
            title: r.title,
            url: r.url,
            snippet: r.snippet || 'No snippet available',
          })),
        },
      };
    } catch (err) {
      const errorMessage = (err as Error).message;
      
      // Fallback message if search fails
      return {
        success: false,
        error: `Web search failed: ${errorMessage}. The Researcher agent can still work with provided context.`,
      };
    }
  }

  // Available tools registry
  private getToolHandler(toolName: string): ((args: Record<string, unknown>, runId: string, taskId: string) => Promise<ToolExecutionResult>) | null {
    const tools: Record<string, (args: Record<string, unknown>, runId: string, taskId: string) => Promise<ToolExecutionResult>> = {
      file_write: this.toolFileWrite.bind(this),
      file_read: this.toolFileRead.bind(this),
      bash_exec: this.toolBashExec.bind(this),
      web_search: this.toolWebSearch.bind(this),
    };
    return tools[toolName] || null;
  }

  // Execute a tool in the sandbox
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const handler = this.getToolHandler(request.toolName);

    if (!handler) {
      return {
        success: false,
        error: `Unknown tool: ${request.toolName}. Available tools: ${this.getAvailableTools().join(', ')}`,
      };
    }

    // Emit tool request audit event
    const run = await this.pool.query('SELECT correlation_id FROM runs WHERE id = $1', [request.runId]);
    await this.pool.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       VALUES ($1, $2, $3, 'TOOL_REQUEST', $4)`,
      [request.runId, request.taskId, run.rows[0]?.correlation_id, JSON.stringify({
        toolName: request.toolName,
        toolArgs: request.toolArgs,
      })]
    );

    try {
      const result = await handler(request.toolArgs, request.runId, request.taskId);

      // Emit tool result audit event
      await this.pool.query(
        `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
         VALUES ($1, $2, $3, 'TOOL_RESULT', $4)`,
        [request.runId, request.taskId, run.rows[0]?.correlation_id, JSON.stringify({
          toolName: request.toolName,
          success: result.success,
          resultSummary: typeof result.result === 'string' 
            ? result.result.slice(0, 200) 
            : JSON.stringify(result.result).slice(0, 200),
        })]
      );

      return result;
    } catch (err) {
      const errorMessage = (err as Error).message;

      // Clean up sandbox on tool execution failure (best-effort)
      this.cleanupTaskSandbox(request.runId, request.taskId);

      await this.pool.query(
        `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
         VALUES ($1, $2, $3, 'TOOL_RESULT', $4)`,
        [request.runId, request.taskId, run.rows[0]?.correlation_id, JSON.stringify({
          toolName: request.toolName,
          success: false,
          errorMessage,
        })]
      );

      return { success: false, error: errorMessage };
    }
  }

  // List available tools
  getAvailableTools(): string[] {
    return ['file_write', 'file_read', 'bash_exec', 'web_search'];
  }

  // Get tool definitions in OpenAI format for LLM consumption
  getToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return [
      {
        name: 'file_write',
        description: 'Write content to a file. Creates the file if it does not exist.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'The file path to write to (relative to sandbox)' },
            content: { type: 'string', description: 'The content to write to the file' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'file_read',
        description: 'Read content from a file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'The file path to read (relative to sandbox)' },
          },
          required: ['path'],
        },
      },
      {
        name: 'bash_exec',
        description: 'Execute a shell command. Use for running code, installing packages, etc.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
          },
          required: ['command'],
        },
      },
    ];
  }

  // Clean up sandbox for a run (call when run completes or is deleted)
  async cleanupSandbox(runId: string): Promise<void> {
    const runPath = path.join(this.sandboxBasePath, runId);
    if (fs.existsSync(runPath)) {
      fs.rmSync(runPath, { recursive: true, force: true });
    }
    // Also cleanup Docker containers
    await this.dockerSandbox.cleanupContainers(runId);
  }

  // List files in sandbox for a task
  async listSandboxFiles(runId: string, taskId: string): Promise<string[]> {
    const sandboxPath = this.getSandboxPath(runId, taskId);
    if (!fs.existsSync(sandboxPath)) {
      return [];
    }
    
    const files: string[] = [];
    const walk = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = path.join(prefix, entry.name);
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), relativePath);
        } else {
          files.push(relativePath);
        }
      }
    };
    walk(sandboxPath);
    return files;
  }

  // Get sandbox status (Docker availability, etc.)
  async getSandboxStatus(): Promise<{
    dockerAvailable: boolean;
    dockerImageReady: boolean;
    useDockerSandbox: boolean;
    localSandboxPath: string;
  }> {
    const dockerStatus = await this.dockerSandbox.getStatus();
    return {
      dockerAvailable: dockerStatus.dockerAvailable,
      dockerImageReady: dockerStatus.imageReady,
      useDockerSandbox: SANDBOX_CONFIG.useDockerSandbox,
      localSandboxPath: this.sandboxBasePath,
    };
  }

  // Get MCP tool definitions for LLM prompting
  getMCPToolDefinitions() {
    return this.getMCPServer().getToolDefinitions();
  }

  // Format tools for system prompt
  formatToolsForPrompt(): string {
    return this.getMCPServer().formatToolsForPrompt();
  }
}

export function createWorkerRuntime(pool: Pool, artifactStore?: ArtifactStoreInterface): WorkerRuntime {
  return new WorkerRuntime(pool, artifactStore);
}

// Re-export MCP and Docker sandbox
export { MCPServer, createMCPServer } from './mcp-server.js';
export { DockerSandbox, getDockerSandbox, createDockerSandbox, SANDBOX_DOCKERFILE } from './docker-sandbox.js';
