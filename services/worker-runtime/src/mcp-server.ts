/**
 * MCP (Model Context Protocol) Server Implementation
 * 
 * This service provides an MCP-compatible interface for AutoOrch tools.
 * It wraps the existing worker-runtime tools in MCP protocol format,
 * enabling interoperability with MCP-compatible AI systems.
 * 
 * MCP Protocol: https://modelcontextprotocol.io/
 */

// MCP Protocol version
const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'autoorch-mcp-server';
const SERVER_VERSION = '0.1.0';

// ─── MCP Protocol Types ─────────────────────────────────────────

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPPropertySchema>;
    required?: string[];
  };
}

export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: MCPPropertySchema;
  default?: unknown;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPToolCallResult {
  content: MCPContent[];
  isError?: boolean;
}

export interface MCPContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface MCPInitializeResponse {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// MCP Error Codes (JSON-RPC 2.0 compliant)
export const MCPErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom MCP errors
  TOOL_NOT_FOUND: -32001,
  TOOL_EXECUTION_FAILED: -32002,
  PERMISSION_DENIED: -32003,
  RATE_LIMITED: -32004,
} as const;

// Tool definitions in MCP format
const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    name: 'file_write',
    description: 'Write content to a file in the sandboxed workspace. Creates parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path within the workspace (e.g., "src/index.ts")',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_read',
    description: 'Read content from a file in the sandboxed workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path within the workspace (e.g., "src/index.ts")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'bash_exec',
    description: 'Execute a whitelisted bash command in the sandboxed workspace. Only safe commands are allowed (node, npm, python, ls, cat, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute (must use whitelisted executables)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
          default: 30000,
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Returns titles, URLs, and snippets of search results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (1-10, default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
];

// Tool executor interface
export interface ToolExecutor {
  executeTool(request: {
    taskId: string;
    runId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
}

export class MCPServer {
  private toolExecutor: ToolExecutor;
  private initialized = false;
  private requestId = 0;

  constructor(toolExecutor: ToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  // Generate next request ID
  private nextId(): number {
    return ++this.requestId;
  }

  // Handle MCP initialize request
  handleInitialize(): MCPInitializeResponse {
    this.initialized = true;
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    };
  }

  // Handle tools/list request
  handleToolsList(): MCPToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  // Handle tools/call request
  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: { runId: string; taskId: string }
  ): Promise<MCPToolCallResult> {
    // Validate tool exists
    const toolDef = TOOL_DEFINITIONS.find(t => t.name === toolName);
    if (!toolDef) {
      return {
        content: [{
          type: 'text',
          text: `Error: Unknown tool "${toolName}". Available tools: ${TOOL_DEFINITIONS.map(t => t.name).join(', ')}`,
        }],
        isError: true,
      };
    }

    // Validate required parameters
    const required = toolDef.inputSchema.required || [];
    for (const param of required) {
      if (args[param] === undefined) {
        return {
          content: [{
            type: 'text',
            text: `Error: Missing required parameter "${param}" for tool "${toolName}"`,
          }],
          isError: true,
        };
      }
    }

    // Execute tool via worker runtime
    try {
      const result = await this.toolExecutor.executeTool({
        taskId: context.taskId,
        runId: context.runId,
        toolName,
        toolArgs: args,
      });

      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `Tool execution failed: ${result.error || 'Unknown error'}`,
          }],
          isError: true,
        };
      }

      // Format result as MCP content
      const content: MCPContent[] = [];
      
      if (typeof result.result === 'string') {
        content.push({ type: 'text', text: result.result });
      } else if (result.result) {
        content.push({ type: 'text', text: JSON.stringify(result.result, null, 2) });
      } else {
        content.push({ type: 'text', text: 'Tool executed successfully (no output)' });
      }

      return { content, isError: false };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Tool execution error: ${(err as Error).message}`,
        }],
        isError: true,
      };
    }
  }

  // Handle generic MCP request (JSON-RPC 2.0)
  async handleRequest(
    request: MCPRequest,
    context: { runId: string; taskId: string }
  ): Promise<MCPResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: this.handleInitialize(),
          };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { tools: this.handleToolsList() },
          };

        case 'tools/call':
          if (!params || typeof params.name !== 'string') {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: MCPErrorCodes.INVALID_PARAMS,
                message: 'tools/call requires "name" parameter',
              },
            };
          }
          const toolResult = await this.handleToolCall(
            params.name as string,
            (params.arguments || {}) as Record<string, unknown>,
            context
          );
          return {
            jsonrpc: '2.0',
            id,
            result: toolResult,
          };

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: MCPErrorCodes.METHOD_NOT_FOUND,
              message: `Unknown method: ${method}`,
            },
          };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: MCPErrorCodes.INTERNAL_ERROR,
          message: (err as Error).message,
        },
      };
    }
  }

  // Create MCP request helper
  createRequest(method: string, params?: Record<string, unknown>): MCPRequest {
    return {
      jsonrpc: '2.0',
      id: this.nextId(),
      method,
      params,
    };
  }

  // Get tool definitions (for LLM prompting)
  getToolDefinitions(): MCPToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  // Get tool definition by name
  getToolDefinition(name: string): MCPToolDefinition | undefined {
    return TOOL_DEFINITIONS.find(t => t.name === name);
  }

  // Check if server is initialized
  isInitialized(): boolean {
    return this.initialized;
  }

  // Get server info
  getServerInfo(): { name: string; version: string; protocolVersion: string } {
    return {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocolVersion: MCP_PROTOCOL_VERSION,
    };
  }

  // Format tools for LLM system prompt
  formatToolsForPrompt(): string {
    return TOOL_DEFINITIONS.map(tool => {
      const params = Object.entries(tool.inputSchema.properties)
        .map(([name, schema]) => {
          const required = tool.inputSchema.required?.includes(name) ? '(required)' : '(optional)';
          return `  - ${name} ${required}: ${schema.description || schema.type}`;
        })
        .join('\n');
      
      return `## ${tool.name}\n${tool.description}\nParameters:\n${params}`;
    }).join('\n\n');
  }
}

// Export tool definitions for external use
export { TOOL_DEFINITIONS, MCP_PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION };

// Factory function
export function createMCPServer(toolExecutor: ToolExecutor): MCPServer {
  return new MCPServer(toolExecutor);
}
