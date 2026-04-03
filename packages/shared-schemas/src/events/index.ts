import {
  RunState,
  TaskState,
  ApprovalState,
  RiskLevel,
  FailureType,
  EventType,
} from '../enums/index.js';
import type { TokenUsage, BudgetUsage } from '../entities/index.js';

// ─── Base Event ─────────────────────────────────────────────────

export interface BaseEvent {
  id: string;
  type: EventType;
  runId: string;
  taskId?: string;
  correlationId: string;
  timestamp: string;
}

// ─── Run Events ─────────────────────────────────────────────────

export interface RunStateChangedEvent extends BaseEvent {
  type: EventType.RUN_STATE_CHANGED;
  payload: {
    previousState: RunState;
    newState: RunState;
    reason?: string;
  };
}

// ─── Task Events ────────────────────────────────────────────────

export interface TaskStateChangedEvent extends BaseEvent {
  type: EventType.TASK_STATE_CHANGED;
  taskId: string;
  payload: {
    previousState: TaskState;
    newState: TaskState;
    failureType?: FailureType;
    failureMessage?: string;
    retryCount?: number;
  };
}

// ─── Provider Events ────────────────────────────────────────────

export interface ProviderCallStartedEvent extends BaseEvent {
  type: EventType.PROVIDER_CALL_STARTED;
  taskId: string;
  payload: {
    providerId: string;
    providerName: string;
    modelName: string;
    agentRole: string;
  };
}

export interface ProviderCallCompletedEvent extends BaseEvent {
  type: EventType.PROVIDER_CALL_COMPLETED;
  taskId: string;
  payload: {
    providerId: string;
    tokenUsage: TokenUsage;
    durationMs: number;
    outputValid: boolean;
  };
}

export interface ProviderCallFailedEvent extends BaseEvent {
  type: EventType.PROVIDER_CALL_FAILED;
  taskId: string;
  payload: {
    providerId: string;
    errorType: FailureType;
    errorMessage: string;
    willRetry: boolean;
  };
}

// ─── Tool Events ────────────────────────────────────────────────

export interface ToolRequestEvent extends BaseEvent {
  type: EventType.TOOL_REQUEST;
  taskId: string;
  payload: {
    toolName: string;
    toolArgs: Record<string, unknown>;
    riskLevel: RiskLevel;
    requiresApproval: boolean;
  };
}

export interface ToolResultEvent extends BaseEvent {
  type: EventType.TOOL_RESULT;
  taskId: string;
  payload: {
    toolName: string;
    success: boolean;
    resultSummary?: string;
    errorMessage?: string;
  };
}

// ─── Approval Events ───────────────────────────────────────────

export interface ApprovalRequestedEvent extends BaseEvent {
  type: EventType.APPROVAL_REQUESTED;
  taskId: string;
  payload: {
    approvalId: string;
    action: string;
    riskLevel: RiskLevel;
    expiresAt: string;
  };
}

export interface ApprovalResolvedEvent extends BaseEvent {
  type: EventType.APPROVAL_RESOLVED;
  taskId: string;
  payload: {
    approvalId: string;
    state: ApprovalState;
    resolvedBy?: string;
    reason?: string;
  };
}

// ─── Policy Events ──────────────────────────────────────────────

export interface PolicyEvaluatedEvent extends BaseEvent {
  type: EventType.POLICY_EVALUATED;
  taskId: string;
  payload: {
    action: string;
    riskLevel: RiskLevel;
    decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
    reason: string;
  };
}

// ─── Checkpoint Events ──────────────────────────────────────────

export interface CheckpointCreatedEvent extends BaseEvent {
  type: EventType.CHECKPOINT_CREATED;
  payload: {
    checkpointId: string;
    sequenceNumber: number;
    runState: RunState;
  };
}

// ─── Budget Events ──────────────────────────────────────────────

export interface BudgetWarningEvent extends BaseEvent {
  type: EventType.BUDGET_WARNING;
  payload: {
    budgetUsage: BudgetUsage;
    thresholdPercent: number;
    limitType: 'tokens' | 'cost' | 'loops';
  };
}

export interface BudgetExceededEvent extends BaseEvent {
  type: EventType.BUDGET_EXCEEDED;
  payload: {
    budgetUsage: BudgetUsage;
    limitType: 'tokens' | 'cost' | 'loops';
  };
}

// ─── Union Type ─────────────────────────────────────────────────

export type AutoOrchEvent =
  | RunStateChangedEvent
  | TaskStateChangedEvent
  | ProviderCallStartedEvent
  | ProviderCallCompletedEvent
  | ProviderCallFailedEvent
  | ToolRequestEvent
  | ToolResultEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | PolicyEvaluatedEvent
  | CheckpointCreatedEvent
  | BudgetWarningEvent
  | BudgetExceededEvent;
