const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit, retries = 2): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    } catch (err: any) {
      lastError = err;
      // Only retry on network errors (not HTTP errors like 400/500)
      if (err.name !== 'TypeError' || attempt === retries) {
        throw err;
      }
      // Wait before retrying (exponential backoff)
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(res.statusText);
  }
  return res.blob();
}

export const api = {
  // Runs
  listRuns: () => request<any[]>('/runs'),
  getRun: (id: string) => request<any>(`/runs/${id}`),
  createRun: (prompt: string, options?: {
    providerOverrides?: Record<string, string>;
    workflow_template_id?: string;
    custom_agent_sequence?: string[];
  }) =>
    request<any>('/runs', { method: 'POST', body: JSON.stringify({
      prompt,
      providerOverrides: options?.providerOverrides,
      workflow_template_id: options?.workflow_template_id,
      custom_agent_sequence: options?.custom_agent_sequence,
    }) }),
  startRun: (id: string) => request<any>(`/runs/${id}/start`, { method: 'POST' }),
  cancelRun: (id: string) => request<any>(`/runs/${id}/cancel`, { method: 'POST' }),
  resumeRun: (id: string) => request<any>(`/runs/${id}/resume`, { method: 'POST' }),
  planRun: (id: string) => request<any>(`/runs/${id}/plan`, { method: 'POST' }),
  dispatchRun: (id: string) => request<any>(`/runs/${id}/dispatch`, { method: 'POST' }),

  // Tasks
  listTasks: (runId: string) => request<any[]>(`/tasks/run/${runId}`),
  getTask: (id: string) => request<any>(`/tasks/${id}`),
  executeTask: (id: string) => request<any>(`/tasks/${id}/execute`, { method: 'POST' }),
  completeTask: (id: string, output?: any) =>
    request<any>(`/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify({ output }) }),
  failTask: (id: string, error?: string) =>
    request<any>(`/tasks/${id}/fail`, { method: 'POST', body: JSON.stringify({ error }) }),
  retryTask: (id: string) => request<any>(`/tasks/${id}/retry`, { method: 'POST' }),

  // Approvals
  listPendingApprovals: () => request<any[]>('/approvals/pending'),
  approve: (id: string, reason?: string) =>
    request<any>(`/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reject: (id: string, reason?: string) =>
    request<any>(`/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Audit
  listAuditEvents: (runId: string, limit = 50) =>
    request<any[]>(`/audit/run/${runId}?limit=${limit}`),
  listCheckpoints: (runId: string) => request<any[]>(`/audit/checkpoints/${runId}`),

  // Providers
  listProviders: () => request<any[]>('/providers'),
  getProviderMappings: (role: string) => request<any[]>(`/providers/mappings/${role}`),
  registerProvider: (provider: any) => request<any>('/providers', { method: 'POST', body: JSON.stringify(provider) }),
  updateProviderHealth: (id: string, health: any) =>
    request<any>(`/providers/${id}/health`, { method: 'PUT', body: JSON.stringify(health) }),
  runHealthChecks: () => request<any>('/providers/health-check-all', { method: 'POST' }),
  reloadProviders: () => request<any>('/providers/reload', { method: 'POST' }),
  deleteProvider: (id: string) => request<any>(`/providers/${id}`, { method: 'DELETE' }),

  // Agent Roles
  listAgentRoles: () => request<any[]>('/roles'),
  getAgentRole: (id: string) => request<any>(`/roles/${id}`),
  createAgentRole: (role: {
    name: string;
    description?: string;
    system_prompt?: string;
    default_provider_id?: string;
    max_tokens_per_request?: number;
    budget_limit?: number;
    tool_whitelist?: string[];
    routing_preferences?: { strategy?: string };
  }) => request<any>('/roles', { method: 'POST', body: JSON.stringify(role) }),
  updateAgentRole: (id: string, updates: Partial<{
    name: string;
    description: string;
    system_prompt: string;
    default_provider_id: string | null;
    max_tokens_per_request: number;
    budget_limit: number;
    tool_whitelist: string[];
    routing_preferences: { strategy?: string };
  }>) => request<any>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  deleteAgentRole: (id: string) => request<any>(`/roles/${id}`, { method: 'DELETE' }),
  updateRoleProvider: (roleId: string, providerId: string, priority?: number) =>
    request<any>(`/roles/${roleId}/provider`, { method: 'PUT', body: JSON.stringify({ provider_id: providerId, priority }) }),
  getRoleProviders: (roleId: string) => request<any[]>(`/roles/${roleId}/providers`),

  // Gateway
  getGatewayPresets: () => request<any[]>('/gateway/presets'),
  getGatewayPreset: (name: string) => request<any>(`/gateway/presets/${name}`),
  registerGatewayProvider: (config: {
    preset?: string;
    name: string;
    apiKey?: string;
    endpointOverride?: string;
    modelOverride?: string;
    capabilities?: Record<string, unknown>;
  }) => request<any>('/gateway/register', { method: 'POST', body: JSON.stringify(config) }),
  testGatewayConnection: (config: {
    preset: string;
    apiKey?: string;
    baseUrl?: string;
    modelName: string;
  }) => request<any>('/gateway/test', { method: 'POST', body: JSON.stringify(config) }),
  getOllamaModels: () => request<{ success: boolean; models: Array<{ name: string; size: number; modified_at: string; digest: string }>; source?: string; error?: string }>('/gateway/ollama/models'),

  // Artifacts
  listArtifacts: (runId: string) => request<any[]>(`/artifacts/run/${runId}`),
  listTaskArtifacts: (runId: string, taskId: string) => request<any[]>(`/artifacts/run/${runId}/task/${taskId}`),
  uploadArtifact: (artifact: { runId: string; taskId: string; name: string; mimeType?: string; content: string }) =>
    request<any>('/artifacts', { method: 'POST', body: JSON.stringify(artifact) }),
  getArtifact: (id: string) => request<any>(`/artifacts/${id}`),
  downloadArtifact: (id: string) => requestBlob(`/artifacts/${id}/download`),
  getArtifactUsage: (runId: string) => request<any>(`/artifacts/run/${runId}/usage`),
  deleteArtifacts: (runId: string) => request<any>(`/artifacts/run/${runId}`, { method: 'DELETE' }),

  // Dead Letter Queue
  listDeadLetterEntries: (limit = 50) => request<any[]>(`/dead-letter?limit=${limit}`),
  listRunDeadLetterEntries: (runId: string) => request<any[]>(`/dead-letter/run/${runId}`),
  getDeadLetterCount: () => request<{ pending: number }>('/dead-letter/count'),
  retryDeadLetterEntry: (id: string) => request<any>(`/dead-letter/${id}/retry`, { method: 'POST' }),
  enqueueDeadLetter: (taskId: string) => request<any>(`/dead-letter/enqueue/${taskId}`, { method: 'POST' }),
  purgeDeadLetter: () => request<any>('/dead-letter/purge', { method: 'DELETE' }),

  // Observability
  getObservabilityHealth: () => request<any>('/observability/health'),
  getObservabilityMetrics: () => request<string>('/observability/metrics'),
  getObservabilityStatus: () => request<any>('/observability/status'),
  getSecretsAudit: () => request<any>('/observability/secrets-audit'),
  getBudgetReport: () => request<any>('/observability/budget-report'),
  getProviderMetrics: () => request<any>('/observability/provider-metrics'),
  getFailures: () => request<any>('/observability/failures'),
  
  // Health metrics
  getHealthMetrics: () => request<any>('/observability/health'),
  
  // Dead letters (alias)
  getDeadLetters: () => request<any[]>('/dead-letter?limit=100'),
  retryDeadLetter: (id: string) => request<any>(`/dead-letter/${id}/retry`, { method: 'POST' }),
  discardDeadLetter: (id: string) => request<any>(`/dead-letter/${id}`, { method: 'DELETE' }),

  // Workflow Templates
  listWorkflowTemplates: () => request<any[]>('/workflows'),
  getWorkflowTemplate: (id: string) => request<any>(`/workflows/${id}`),
  createWorkflowTemplate: (template: {
    name: string;
    description?: string;
    agent_sequence: string[];
    dependencies?: Record<string, string[]>;
  }) => request<any>('/workflows', { method: 'POST', body: JSON.stringify(template) }),
  updateWorkflowTemplate: (id: string, updates: Partial<{
    name: string;
    description: string;
    agent_sequence: string[];
    dependencies: Record<string, string[]>;
    is_default: boolean;
  }>) => request<any>(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  deleteWorkflowTemplate: (id: string) => request<any>(`/workflows/${id}`, { method: 'DELETE' }),
  getAvailableAgents: () => request<any[]>('/workflows/available-agents'),

  // MCP (Model Context Protocol) Tools
  getMCPInfo: () => request<any>('/mcp/info'),
  getMCPTools: () => request<{ jsonrpc: string; id: number; result: { tools: Array<{ name: string; description: string; inputSchema: any }> } }>('/mcp/tools'),
  callMCPTool: (name: string, args: Record<string, unknown>, context: { runId: string; taskId: string }) =>
    request<any>('/mcp/tools/call', { method: 'POST', body: JSON.stringify({ name, arguments: args, ...context }) }),
};
