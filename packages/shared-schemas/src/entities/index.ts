import {
  RunState,
  TaskState,
  ApprovalState,
  FailureType,
  RiskLevel,
  RoutingStrategy,
  ProviderType,
  AgentRole,
} from '../enums/index.js';

// ─── Run ────────────────────────────────────────────────────────

export interface Run {
  id: string;
  prompt: string;
  state: RunState;
  workspaceId: string;
  correlationId: string;
  providerOverrides?: Record<AgentRole, string>;
  budgetLimit: BudgetLimit;
  checkpointId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Task ───────────────────────────────────────────────────────

export interface Task {
  id: string;
  runId: string;
  agentRole: AgentRole;
  state: TaskState;
  dependsOn: string[];
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  failureType?: FailureType;
  failureMessage?: string;
  providerId?: string;
  tokenUsage?: TokenUsage;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent Role Definition ──────────────────────────────────────

export interface AgentRoleDefinition {
  id: string;
  role: AgentRole;
  displayName: string;
  systemPrompt: string;
  toolWhitelist: string[];
  outputSchema: Record<string, unknown>;
  budgetPolicy: BudgetPolicy;
  routingPreferences: RoutingPreference;
  retryPolicy: RetryPolicy;
  createdAt: string;
  updatedAt: string;
}

// ─── Provider Definition ────────────────────────────────────────

export interface ProviderDefinition {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;
  modelName: string;
  capabilities: ProviderCapabilities;
  credentialsRef?: string;
  healthStatus: ProviderHealthStatus;
  costMetadata: CostMetadata;
  rateLimits: RateLimits;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Provider Mapping ───────────────────────────────────────────

export interface ProviderMapping {
  id: string;
  agentRole: AgentRole;
  providerId: string;
  priority: number;
  isDefault: boolean;
  createdAt: string;
}

// ─── Approval ───────────────────────────────────────────────────

export interface Approval {
  id: string;
  runId: string;
  taskId: string;
  action: string;
  riskLevel: RiskLevel;
  state: ApprovalState;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
  expiresAt: string;
}

// ─── Audit Event ────────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  runId: string;
  taskId?: string;
  correlationId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ─── Checkpoint ─────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  runId: string;
  sequenceNumber: number;
  runState: RunState;
  taskStates: Record<string, TaskState>;
  completedOutputs: Record<string, Record<string, unknown>>;
  providerSelections: Record<string, string>;
  budgetUsage: BudgetUsage;
  createdAt: string;
}

// ─── Budget ─────────────────────────────────────────────────────

export interface BudgetLimit {
  maxTokens: number;
  maxCostUsd: number;
  maxLoopIterations: number;
}

export interface BudgetPolicy {
  maxTokensPerTask: number;
  maxCostPerTask: number;
  maxLoopIterations: number;
}

export interface BudgetUsage {
  totalTokens: number;
  totalCostUsd: number;
  loopIterations: number;
  perRole: Record<string, { tokens: number; costUsd: number }>;
}

// ─── Token Usage ────────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

// ─── Provider Sub-types ─────────────────────────────────────────

export interface ProviderCapabilities {
  structuredOutput: boolean;
  structuredOutputReliability: number; // 0.0 - 1.0
  toolUse: boolean;
  streaming: boolean;
  maxContextTokens: number;
  estimatedLatencyMs: number;
}

export interface ProviderHealthStatus {
  isHealthy: boolean;
  lastCheckedAt?: string;
  lastErrorMessage?: string;
  consecutiveFailures: number;
}

export interface CostMetadata {
  costPerInputToken: number;
  costPerOutputToken: number;
  currency: string;
}

export interface RateLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
  currentUsage?: { requests: number; tokens: number };
}

// ─── Retry Policy ───────────────────────────────────────────────

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  backoffFactor: number;
  retryOn: FailureType[];
}

// ─── Routing Preference ─────────────────────────────────────────

export interface RoutingPreference {
  strategy: RoutingStrategy;
  preferredProviderIds?: string[];
  fallbackProviderIds?: string[];
}

// ─── Artifact ───────────────────────────────────────────────────

export interface Artifact {
  id: string;
  runId: string;
  taskId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

// ─── MCP Protocol Types ─────────────────────────────────────────

/**
 * MCP (Model Context Protocol) compatible interfaces
 * Based on Anthropic's MCP specification for tool interoperability
 */

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

export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
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

export interface MCPInitializeRequest {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
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
