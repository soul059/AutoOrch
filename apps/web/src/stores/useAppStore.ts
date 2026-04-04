import { create } from 'zustand';
import { api } from '../services/api';
import { ToastMessage, createToast } from '../components/Toast';

// Types
export interface Run {
  id: string;
  prompt: string;
  state: string;
  created_at: string;
  updated_at: string;
  budget_limit?: { maxTokens: number; maxCostUsd: number };
  workflow_template_id?: string;
}

export interface Task {
  id: string;
  run_id: string;
  agent_role: string;
  state: string;
  sequence_index: number;
  depends_on: string[];
  input?: Record<string, unknown>;
  output?: { response?: string };
  token_usage?: { totalTokens?: number; costUsd?: number };
  failure_message?: string;
  retry_count?: number;
  max_retries?: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderHealthStatus {
  isHealthy: boolean;
  lastErrorMessage?: string;
  latencyMs?: number;
  lastCheckedAt?: string;
}

export interface ProviderCapabilities {
  structuredOutput?: boolean;
  toolUse?: boolean;
  streaming?: boolean;
  maxContextTokens?: number;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  model_name: string;
  endpoint: string;
  enabled: boolean;
  health_status?: ProviderHealthStatus;
  capabilities?: ProviderCapabilities;
}

export interface AgentRole {
  id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  default_provider_id?: string;
  budget_limit?: number;
  tool_whitelist?: string[];
  routing_preferences?: { strategy?: string };
}

export interface WebSocketEvent {
  type: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

// Request deduplication and throttling
const pendingRequests = new Map<string, Promise<any>>();
const lastFetchTime = new Map<string, number>();
const MIN_FETCH_INTERVAL = 2000; // Minimum 2 seconds between same requests

function throttledFetch<T>(key: string, fetchFn: () => Promise<T>, minInterval = MIN_FETCH_INTERVAL): Promise<T> {
  // Check if there's already a pending request
  const pending = pendingRequests.get(key);
  if (pending) {
    return pending;
  }
  
  // Check if we fetched recently
  const lastTime = lastFetchTime.get(key) || 0;
  const now = Date.now();
  if (now - lastTime < minInterval) {
    return Promise.resolve(undefined as T);
  }
  
  // Execute fetch
  lastFetchTime.set(key, now);
  const promise = fetchFn().finally(() => {
    pendingRequests.delete(key);
  });
  pendingRequests.set(key, promise);
  return promise;
}

interface AppState {
  // Runs
  runs: Run[];
  selectedRunId: string | null;
  selectedRun: Run | null;
  tasks: Task[];
  runsLoading: boolean;
  
  // Providers
  providers: Provider[];
  providersLoading: boolean;
  
  // Agent Roles
  agentRoles: AgentRole[];
  rolesLoading: boolean;
  
  // WebSocket
  wsConnected: boolean;
  events: WebSocketEvent[];
  
  // UI State
  sidebarCollapsed: boolean;
  
  // Toast notifications
  toasts: ToastMessage[];
  
  // Actions
  fetchRuns: (force?: boolean) => Promise<void>;
  fetchRun: (id: string) => Promise<void>;
  selectRun: (id: string | null) => void;
  fetchTasks: (runId: string, force?: boolean) => Promise<void>;
  createRun: (prompt: string, options?: { workflow_template_id?: string }) => Promise<Run>;
  startRun: (id: string) => Promise<void>;
  cancelRun: (id: string) => Promise<void>;
  resumeRun: (id: string) => Promise<void>;
  
  fetchProviders: (force?: boolean) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  
  fetchAgentRoles: () => Promise<void>;
  
  setWsConnected: (connected: boolean) => void;
  addEvent: (event: WebSocketEvent) => void;
  clearEvents: () => void;
  
  toggleSidebar: () => void;
  
  // Toast notifications
  addToast: (type: ToastMessage['type'], title: string, message?: string) => void;
  removeToast: (id: string) => void;
  
  // Update from WebSocket events (no API calls, just state updates)
  updateRunState: (runId: string, newState: string) => void;
  updateTaskState: (taskId: string, newState: string, output?: any) => void;
  addTask: (task: Partial<Task>) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  tasks: [],
  runsLoading: false,
  
  providers: [],
  providersLoading: false,
  
  agentRoles: [],
  rolesLoading: false,
  
  wsConnected: false,
  events: [],
  
  sidebarCollapsed: false,
  
  toasts: [],
  
  // Toast actions
  addToast: (type, title, message) => {
    const toast = createToast(type, title, message);
    set(state => ({ toasts: [...state.toasts, toast] }));
  },
  
  removeToast: (id) => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
  },
  
  // Run actions - with throttling
  fetchRuns: async (force = false) => {
    const interval = force ? 0 : MIN_FETCH_INTERVAL;
    set({ runsLoading: true });
    try {
      const runs = await throttledFetch('runs', () => api.listRuns(), interval);
      if (runs) {
        set({ runs: runs || [], runsLoading: false });
      } else {
        set({ runsLoading: false });
      }
    } catch (err) {
      console.error('Failed to fetch runs:', err);
      set({ runsLoading: false });
    }
  },
  
  fetchRun: async (id: string) => {
    try {
      const run = await throttledFetch(`run-${id}`, () => api.getRun(id));
      if (run) {
        set({ selectedRun: run });
      }
    } catch (err) {
      console.error('Failed to fetch run:', err);
    }
  },
  
  selectRun: (id: string | null) => {
    set({ selectedRunId: id, selectedRun: null, tasks: [] });
    if (id) {
      get().fetchRun(id);
      get().fetchTasks(id, true);
    }
  },
  
  fetchTasks: async (runId: string, force = false) => {
    const interval = force ? 0 : MIN_FETCH_INTERVAL;
    try {
      const tasks = await throttledFetch(`tasks-${runId}`, () => api.listTasks(runId), interval);
      if (tasks) {
        set({ tasks: tasks || [] });
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  },
  
  createRun: async (prompt: string, options?: { workflow_template_id?: string }) => {
    const run = await api.createRun(prompt, options);
    get().fetchRuns(true);
    return run;
  },
  
  startRun: async (id: string) => {
    await api.startRun(id);
    // Update local state immediately, don't refetch
    set(state => ({
      runs: state.runs.map(r => r.id === id ? { ...r, state: 'PLANNING' } : r),
      selectedRun: state.selectedRun?.id === id 
        ? { ...state.selectedRun, state: 'PLANNING' } 
        : state.selectedRun,
    }));
  },
  
  cancelRun: async (id: string) => {
    await api.cancelRun(id);
    // Update local state immediately
    set(state => ({
      runs: state.runs.map(r => r.id === id ? { ...r, state: 'CANCELLED' } : r),
      selectedRun: state.selectedRun?.id === id 
        ? { ...state.selectedRun, state: 'CANCELLED' } 
        : state.selectedRun,
    }));
  },
  
  resumeRun: async (id: string) => {
    await api.resumeRun(id);
    // Update local state immediately
    set(state => ({
      runs: state.runs.map(r => r.id === id ? { ...r, state: 'EXECUTING' } : r),
      selectedRun: state.selectedRun?.id === id 
        ? { ...state.selectedRun, state: 'EXECUTING' } 
        : state.selectedRun,
    }));
  },
  
  // Provider actions - with throttling
  fetchProviders: async (force = false) => {
    const interval = force ? 0 : 5000; // Providers don't change often
    set({ providersLoading: true });
    try {
      const providers = await throttledFetch('providers', () => api.listProviders(), interval);
      if (providers) {
        set({ providers: providers || [], providersLoading: false });
      } else {
        set({ providersLoading: false });
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      set({ providersLoading: false });
    }
  },
  
  deleteProvider: async (id: string) => {
    await api.deleteProvider(id);
    // Remove from local state immediately
    set(state => ({
      providers: state.providers.filter(p => p.id !== id)
    }));
  },
  
  // Agent role actions
  fetchAgentRoles: async () => {
    set({ rolesLoading: true });
    try {
      const roles = await throttledFetch('roles', () => api.listAgentRoles(), 10000);
      if (roles) {
        set({ agentRoles: roles || [], rolesLoading: false });
      } else {
        set({ rolesLoading: false });
      }
    } catch (err) {
      console.error('Failed to fetch agent roles:', err);
      set({ rolesLoading: false });
    }
  },
  
  // WebSocket actions
  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
  
  addEvent: (event: WebSocketEvent) => {
    set(state => ({
      events: [event, ...state.events].slice(0, 100)
    }));
    
    // Update state from WebSocket events
    const { payload, type } = event;
    const selectedRunId = get().selectedRunId;
    
    console.log('[Store] WebSocket event:', type, payload);
    
    // Run state changes
    if (type === 'RUN_STATE_CHANGED' && payload?.runId) {
      get().updateRunState(payload.runId as string, payload.newState as string);
      get().fetchRuns();
    }
    
    // Run created/started - refresh runs list
    if ((type === 'RUN_CREATED' || type === 'RUN_STARTED') && payload?.runId) {
      get().fetchRuns();
    }
    
    // Task state changes
    if (type === 'TASK_STATE_CHANGED' && payload?.taskId) {
      const currentTasks = get().tasks;
      const taskExists = currentTasks.some(t => t.id === payload.taskId);
      
      if (taskExists) {
        get().updateTaskState(
          payload.taskId as string, 
          payload.newState as string,
          payload.output
        );
      } else if (selectedRunId) {
        // Task not in list - fetch tasks for this run
        get().fetchTasks(selectedRunId, true);
      }
    }
    
    // New tasks queued - fetch them
    if (type === 'TASKS_QUEUED' && payload?.runId) {
      if (selectedRunId) {
        get().fetchTasks(selectedRunId, true);
      }
    }
    
    // Provider call started - mark task as RUNNING
    if (type === 'PROVIDER_CALL_STARTED' && payload?.taskId) {
      const currentTasks = get().tasks;
      const taskExists = currentTasks.some(t => t.id === payload.taskId);
      
      if (!taskExists && selectedRunId) {
        get().fetchTasks(selectedRunId, true);
      } else if (taskExists) {
        get().updateTaskState(payload.taskId as string, 'RUNNING');
      }
    }
    
    // Provider call completed - update task output
    if (type === 'PROVIDER_CALL_COMPLETED' && payload?.taskId) {
      get().updateTaskState(
        payload.taskId as string, 
        'SUCCEEDED', 
        { response: payload.output }
      );
    }
  },
  
  clearEvents: () => set({ events: [] }),
  
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  
  // Update helpers - these update local state without API calls
  updateRunState: (runId: string, newState: string) => {
    set(state => ({
      runs: state.runs.map(r => r.id === runId ? { ...r, state: newState } : r),
      selectedRun: state.selectedRun?.id === runId 
        ? { ...state.selectedRun, state: newState } 
        : state.selectedRun,
    }));
  },
  
  updateTaskState: (taskId: string, newState: string, output?: any) => {
    set(state => ({
      tasks: state.tasks.map(t => 
        t.id === taskId 
          ? { ...t, state: newState, ...(output && { output }) } 
          : t
      ),
    }));
  },
  
  addTask: (task: Partial<Task>) => {
    set(state => {
      // Don't add if already exists
      if (state.tasks.find(t => t.id === task.id)) {
        return state;
      }
      return {
        tasks: [...state.tasks, task as Task].sort((a, b) => a.sequence_index - b.sequence_index)
      };
    });
  },
}));
