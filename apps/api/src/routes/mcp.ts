import { Router, Request, Response } from 'express';
import { workerRuntime } from '../services.js';

const router = Router();

/**
 * MCP (Model Context Protocol) API Endpoints
 * 
 * These endpoints provide MCP-compatible tool discovery and invocation.
 * They allow external MCP clients to interact with AutoOrch's tool sandbox.
 */

// Get MCP server info
router.get('/info', async (_req: Request, res: Response) => {
  try {
    const mcpServer = workerRuntime.getMCPServer();
    res.json(mcpServer.getServerInfo());
  } catch (err) {
    console.error('[mcp.info]', err);
    res.status(500).json({ error: 'Failed to get MCP server info' });
  }
});

// Initialize MCP session (MCP protocol: initialize)
router.post('/initialize', async (req: Request, res: Response) => {
  try {
    const mcpServer = workerRuntime.getMCPServer();
    const response = mcpServer.handleInitialize();
    res.json({
      jsonrpc: '2.0',
      id: req.body.id || 1,
      result: response,
    });
  } catch (err) {
    console.error('[mcp.initialize]', err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id || 1,
      error: {
        code: -32603,
        message: 'Failed to initialize MCP server',
      },
    });
  }
});

// List available tools (MCP protocol: tools/list)
router.get('/tools', async (_req: Request, res: Response) => {
  try {
    const mcpServer = workerRuntime.getMCPServer();
    const tools = mcpServer.handleToolsList();
    res.json({
      jsonrpc: '2.0',
      id: 1,
      result: { tools },
    });
  } catch (err) {
    console.error('[mcp.tools.list]', err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32603,
        message: 'Failed to list tools',
      },
    });
  }
});

// Get single tool definition
router.get('/tools/:name', async (req: Request, res: Response) => {
  try {
    const mcpServer = workerRuntime.getMCPServer();
    const toolName = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const tool = mcpServer.getToolDefinition(toolName);
    
    if (!tool) {
      res.status(404).json({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32001,
          message: `Tool not found: ${req.params.name}`,
        },
      });
      return;
    }

    res.json({
      jsonrpc: '2.0',
      id: 1,
      result: tool,
    });
  } catch (err) {
    console.error('[mcp.tools.get]', err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32603,
        message: 'Failed to get tool',
      },
    });
  }
});

// Call a tool (MCP protocol: tools/call)
router.post('/tools/call', async (req: Request, res: Response) => {
  try {
    const { name, arguments: args, runId, taskId } = req.body;

    if (!name) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: req.body.id || 1,
        error: {
          code: -32602,
          message: 'Missing required parameter: name',
        },
      });
      return;
    }

    if (!runId || !taskId) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: req.body.id || 1,
        error: {
          code: -32602,
          message: 'Missing required context: runId and taskId',
        },
      });
      return;
    }

    const mcpServer = workerRuntime.getMCPServer();
    const result = await mcpServer.handleToolCall(
      name,
      args || {},
      { runId, taskId }
    );

    res.json({
      jsonrpc: '2.0',
      id: req.body.id || 1,
      result,
    });
  } catch (err) {
    console.error('[mcp.tools.call]', err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id || 1,
      error: {
        code: -32603,
        message: 'Failed to call tool',
      },
    });
  }
});

// Generic MCP request handler (JSON-RPC 2.0)
router.post('/request', async (req: Request, res: Response) => {
  try {
    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0') {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc must be "2.0"',
        },
      });
      return;
    }

    // Extract context from params or headers
    const runId = params?.context?.runId || req.headers['x-run-id'] as string;
    const taskId = params?.context?.taskId || req.headers['x-task-id'] as string;

    const mcpServer = workerRuntime.getMCPServer();
    const response = await mcpServer.handleRequest(
      { jsonrpc: '2.0', id, method, params },
      { runId: runId || 'default', taskId: taskId || 'default' }
    );

    res.json(response);
  } catch (err) {
    console.error('[mcp.request]', err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id || null,
      error: {
        code: -32603,
        message: (err as Error).message,
      },
    });
  }
});

// Get sandbox status
router.get('/sandbox/status', async (_req: Request, res: Response) => {
  try {
    const status = await workerRuntime.getSandboxStatus();
    res.json(status);
  } catch (err) {
    console.error('[mcp.sandbox.status]', err);
    res.status(500).json({ error: 'Failed to get sandbox status' });
  }
});

// Get tools formatted for LLM prompting
router.get('/tools/prompt-format', async (_req: Request, res: Response) => {
  try {
    const formatted = workerRuntime.formatToolsForPrompt();
    res.type('text/plain').send(formatted);
  } catch (err) {
    console.error('[mcp.tools.prompt-format]', err);
    res.status(500).json({ error: 'Failed to format tools' });
  }
});

export default router;
