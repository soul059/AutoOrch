import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { correlationId, apiKeyAuth, errorHandler } from './middleware/index.js';
import runsRouter from './routes/runs.js';
import tasksRouter from './routes/tasks.js';
import approvalsRouter from './routes/approvals.js';
import auditRouter from './routes/audit.js';
import providersRouter from './routes/providers.js';
import rolesRouter from './routes/roles.js';
import workflowsRouter from './routes/workflows.js';
import observabilityRouter from './routes/observability.js';
import gatewayRouter, { loadCredentialsFromDB } from './routes/gateway.js';
import artifactsRouter from './routes/artifacts.js';
import deadLetterRouter from './routes/dead-letter.js';
import mcpRouter from './routes/mcp.js';
import { observability } from './routes/observability.js';
import pool from './config/database.js';
import { initializeSecrets } from './config/secrets.js';
import { initializeServices } from './services.js';
import { setBroadcastFunction } from './events.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '3002', 10);

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(correlationId);

// Authenticate all /api routes except health check
app.use('/api', (req, res, next) => {
  // Health check is always public
  if (req.path === '/health') return next();
  // SSE events endpoint requires authentication (removed from exemption)
  apiKeyAuth(req, res, next);
});

// Routes
app.use('/api/runs', runsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/providers', providersRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/gateway', gatewayRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/dead-letter', deadLetterRouter);
app.use('/api/observability', observabilityRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/mcp', mcpRouter);

// Simple health check (used by Docker/load balancers)
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// SSE clients map for Server-Sent Events fallback
import type { Response as ExpressResponse } from 'express';
const sseClients = new Map<string, Set<ExpressResponse>>();

// SSE endpoint — fallback for clients that can't use WebSocket
app.get('/api/events/:runId', (req, res) => {
  const runId = req.params.runId || 'global';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', runId })}\n\n`);

  // Store SSE client for broadcasting
  if (!sseClients.has(runId)) {
    sseClients.set(runId, new Set());
  }
  sseClients.get(runId)!.add(res);

  // Keep-alive ping every 30s
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.get(runId)?.delete(res);
    if (sseClients.get(runId)?.size === 0) {
      sseClients.delete(runId);
    }
  });
});

// Error handler
app.use(errorHandler);

// WebSocket Server for live event streaming
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${WS_PORT}`);
  const runId = url.searchParams.get('runId') || 'global';

  if (!clients.has(runId)) {
    clients.set(runId, new Set());
  }
  clients.get(runId)!.add(ws);

  console.log(`[WS] Client connected for run: ${runId}`);

  ws.on('close', () => {
    clients.get(runId)?.delete(ws);
    if (clients.get(runId)?.size === 0) {
      clients.delete(runId);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client error for run ${runId}:`, err.message);
    clients.get(runId)?.delete(ws);
  });

  ws.send(JSON.stringify({ type: 'connected', runId }));
});

// Broadcast event to relevant WebSocket and SSE clients
export function broadcastEvent(runId: string, event: Record<string, unknown>): void {
  const message = JSON.stringify(event);

  const sendSafe = (ws: WebSocket, targetRunId: string) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      console.error(`[WS] Send error for run ${targetRunId}:`, (err as Error).message);
      clients.get(targetRunId)?.delete(ws);
    }
  };

  // WebSocket broadcast
  clients.get(runId)?.forEach(ws => sendSafe(ws, runId));
  clients.get('global')?.forEach(ws => sendSafe(ws, 'global'));

  // SSE broadcast
  const sseData = `data: ${message}\n\n`;
  const sendSSE = (res: ExpressResponse, targetRunId: string) => {
    try {
      res.write(sseData);
    } catch {
      sseClients.get(targetRunId)?.delete(res);
    }
  };
  sseClients.get(runId)?.forEach(res => sendSSE(res, runId));
  sseClients.get('global')?.forEach(res => sendSSE(res, 'global'));
}

// ─── Startup: await secrets, then start HTTP server ─────────
async function start() {
  // Register broadcast function for events module (before services init)
  setBroadcastFunction(broadcastEvent);
  
  try {
    await initializeSecrets();
    console.log('[API] Secrets loaded');
  } catch (err) {
    console.warn('[API] Secrets initialization warning:', (err as Error).message);
  }

  // Load persisted gateway credentials from DB into cache
  await loadCredentialsFromDB();

  // Initialize all service singletons (orchestrator, provider router, policy engine, etc.)
  try {
    await initializeServices();
    console.log('[API] Services initialized');
  } catch (err) {
    console.warn('[API] Service initialization warning:', (err as Error).message);
  }

  const httpServer = createServer(app);
  
  // Disable default 2-minute socket timeout for long-running LLM streams
  httpServer.requestTimeout = 0;        // Disable request timeout (was 120s default)
  httpServer.keepAliveTimeout = 65000;  // Keep-alive timeout (65s)
  httpServer.headersTimeout = 66000;    // Headers timeout (66s, must be > keepAliveTimeout)
  
  httpServer.listen(PORT, () => {
    console.log(`[API] HTTP server listening on port ${PORT}`);
    console.log(`[API] WebSocket server listening on port ${WS_PORT}`);
  });

  // ─── Graceful shutdown ──────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[API] ${signal} received, shutting down gracefully...`);

    // Stop observability timer first (before pool closes)
    observability.stop();

    // Close WebSocket connections
    wss.clients.forEach(ws => {
      try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
    });
    wss.close();

    // Close HTTP server
    httpServer.close(() => {
      console.log('[API] HTTP server closed');
    });

    // Drain database pool
    await pool.end();
    console.log('[API] Database pool closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
