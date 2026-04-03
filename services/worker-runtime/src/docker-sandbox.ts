/**
 * Docker Sandbox Manager
 * 
 * Provides isolated container execution for tool commands.
 * Falls back to local execution if Docker is unavailable.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Docker sandbox configuration
const DOCKER_CONFIG = {
  // Base image with Node.js, Python, and common tools
  image: process.env.SANDBOX_IMAGE || 'autoorch-sandbox:latest',
  // Resource limits
  memoryLimit: process.env.SANDBOX_MEMORY || '512m',
  cpuLimit: process.env.SANDBOX_CPU || '1.0',
  // Timeouts
  containerTimeout: 60000, // 60s max container lifetime
  commandTimeout: 30000,   // 30s max command execution
  // Network mode (none = no network access)
  networkMode: process.env.SANDBOX_NETWORK || 'none',
  // Auto-remove containers after exit
  autoRemove: true,
};

// Dockerfile content for sandbox image
const SANDBOX_DOCKERFILE = `
FROM node:20-alpine

# Install Python and common tools
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash \
    git \
    curl \
    jq \
    && ln -sf python3 /usr/bin/python

# Install common npm packages globally
RUN npm install -g typescript ts-node

# Create non-root user for security
RUN adduser -D -u 1000 sandbox
WORKDIR /workspace
RUN chown sandbox:sandbox /workspace

# Switch to non-root user
USER sandbox

# Default command
CMD ["bash"]
`.trim();

export interface DockerSandboxConfig {
  runId: string;
  taskId: string;
  workspacePath: string;
}

export interface SandboxExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  usedDocker: boolean;
  error?: string;
}

export class DockerSandbox {
  private dockerAvailable: boolean | null = null;
  private imageBuilt = false;

  // Check if Docker is available and running
  async isDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) {
      return this.dockerAvailable;
    }

    try {
      await execAsync('docker info', { timeout: 5000 });
      this.dockerAvailable = true;
    } catch {
      this.dockerAvailable = false;
    }

    return this.dockerAvailable;
  }

  // Build the sandbox image if needed
  async ensureImage(): Promise<boolean> {
    if (this.imageBuilt) return true;

    const isAvailable = await this.isDockerAvailable();
    if (!isAvailable) return false;

    try {
      // Check if image exists
      await execAsync(`docker image inspect ${DOCKER_CONFIG.image}`, { timeout: 5000 });
      this.imageBuilt = true;
      return true;
    } catch {
      // Image doesn't exist, try to build it
      console.log('[DockerSandbox] Building sandbox image...');
      
      // Create temp directory for Dockerfile
      const tempDir = path.join(process.env.TEMP || '/tmp', 'autoorch-sandbox-build');
      const dockerfilePath = path.join(tempDir, 'Dockerfile');
      
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(dockerfilePath, SANDBOX_DOCKERFILE);
        
        await execAsync(`docker build -t ${DOCKER_CONFIG.image} ${tempDir}`, {
          timeout: 120000, // 2 minutes for build
        });
        
        this.imageBuilt = true;
        console.log('[DockerSandbox] Sandbox image built successfully');
        return true;
      } catch (buildErr) {
        console.warn('[DockerSandbox] Failed to build image:', (buildErr as Error).message);
        return false;
      } finally {
        // Cleanup temp files
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    }
  }

  // Execute command in Docker container
  async executeInContainer(
    command: string,
    config: DockerSandboxConfig,
    timeout = DOCKER_CONFIG.commandTimeout
  ): Promise<SandboxExecutionResult> {
    // Ensure workspace exists
    if (!fs.existsSync(config.workspacePath)) {
      fs.mkdirSync(config.workspacePath, { recursive: true });
    }

    // Generate unique container name
    const containerName = `autoorch-sandbox-${config.runId}-${config.taskId}-${Date.now()}`;

    // Resolve workspace path and convert to Docker-compatible format on Windows
    let workspacePath = path.resolve(config.workspacePath);
    // On Windows, convert path for Docker volume mount (e.g., C:\foo\bar -> /c/foo/bar)
    if (process.platform === 'win32') {
      workspacePath = workspacePath
        .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
        .replace(/\\/g, '/');
    }

    // Build docker run command
    const dockerArgs = [
      'run',
      '--rm',                                    // Auto-remove container
      '--name', containerName,
      '--memory', DOCKER_CONFIG.memoryLimit,
      '--cpus', DOCKER_CONFIG.cpuLimit,
      '--network', DOCKER_CONFIG.networkMode,
      '--user', '1000:1000',                     // Run as non-root
      '--workdir', '/workspace',
      '-v', `${workspacePath}:/workspace:rw`,
      // Security options
      '--security-opt', 'no-new-privileges',
      '--cap-drop', 'ALL',
      // Temp directory
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      // Image and command
      DOCKER_CONFIG.image,
      'bash', '-c', command,
    ];

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let timedOut = false;

      const proc = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
      });

      // Set timeout for the process
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        killed = true;
        // Kill the container
        exec(`docker kill ${containerName}`, () => {
          // Ignore errors - container may already be stopped
        });
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle);
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || (killed ? 137 : 1),
          timedOut,
          usedDocker: true,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutHandle);
        resolve({
          success: false,
          stdout: '',
          stderr: err.message,
          exitCode: 1,
          usedDocker: true,
          error: err.message,
        });
      });
    });
  }

  // Execute command locally (fallback when Docker unavailable)
  async executeLocally(
    command: string,
    config: DockerSandboxConfig,
    timeout = DOCKER_CONFIG.commandTimeout
  ): Promise<SandboxExecutionResult> {
    // Ensure workspace exists
    if (!fs.existsSync(config.workspacePath)) {
      fs.mkdirSync(config.workspacePath, { recursive: true });
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: config.workspacePath,
        timeout,
        maxBuffer: 5 * 1024 * 1024, // 5MB
        env: {
          ...process.env,
          HOME: config.workspacePath,
          TMPDIR: config.workspacePath,
        },
      });

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        usedDocker: false,
      };
    } catch (err) {
      const execError = err as { 
        stdout?: string; 
        stderr?: string; 
        code?: number; 
        killed?: boolean;
        message: string;
      };

      return {
        success: false,
        stdout: execError.stdout?.trim() || '',
        stderr: execError.stderr?.trim() || execError.message,
        exitCode: execError.code || 1,
        timedOut: execError.killed,
        usedDocker: false,
        error: execError.message,
      };
    }
  }

  // Main execute method - tries Docker first, falls back to local
  async execute(
    command: string,
    config: DockerSandboxConfig,
    timeout = DOCKER_CONFIG.commandTimeout
  ): Promise<SandboxExecutionResult> {
    // Try Docker first
    const dockerAvailable = await this.isDockerAvailable();
    
    if (dockerAvailable) {
      const imageReady = await this.ensureImage();
      
      if (imageReady) {
        return this.executeInContainer(command, config, timeout);
      }
    }

    // Fall back to local execution with warning
    console.warn('[DockerSandbox] Docker not available, using local execution');
    return this.executeLocally(command, config, timeout);
  }

  // Cleanup containers for a run (in case any are orphaned)
  async cleanupContainers(runId: string): Promise<void> {
    const isAvailable = await this.isDockerAvailable();
    if (!isAvailable) return;

    try {
      // Find containers matching the run ID pattern
      const { stdout } = await execAsync(
        `docker ps -aq --filter "name=autoorch-sandbox-${runId}"`,
        { timeout: 5000 }
      );

      const containerIds = stdout.trim().split('\n').filter(Boolean);
      
      if (containerIds.length > 0) {
        await execAsync(`docker rm -f ${containerIds.join(' ')}`, { timeout: 10000 });
        console.log(`[DockerSandbox] Cleaned up ${containerIds.length} containers for run ${runId}`);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // Get sandbox status info
  async getStatus(): Promise<{
    dockerAvailable: boolean;
    imageReady: boolean;
    config: typeof DOCKER_CONFIG;
  }> {
    const dockerAvailable = await this.isDockerAvailable();
    const imageReady = dockerAvailable && this.imageBuilt;

    return {
      dockerAvailable,
      imageReady,
      config: DOCKER_CONFIG,
    };
  }
}

// Singleton instance
let sandboxInstance: DockerSandbox | null = null;

export function getDockerSandbox(): DockerSandbox {
  if (!sandboxInstance) {
    sandboxInstance = new DockerSandbox();
  }
  return sandboxInstance;
}

export function createDockerSandbox(): DockerSandbox {
  return new DockerSandbox();
}

// Export Dockerfile for reference
export { SANDBOX_DOCKERFILE, DOCKER_CONFIG };
