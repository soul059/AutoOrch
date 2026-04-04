import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore, Task } from '../stores/useAppStore';
import { api } from '../services/api';
import { ArtifactViewer } from '../components/ArtifactViewer';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../lib/utils';
import {
  Rocket,
  Plus,
  Play,
  Pause,
  X,
  ChevronDown,
  ChevronUp,
  Inbox,
  ClipboardList,
  FileText,
  Loader2,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  ListTodo,
  Send,
  Brain,
  Search,
  Wrench,
  Eye,
  Settings,
  Bot,
  RefreshCw
} from 'lucide-react';

const TASK_STATE_BADGE_VARIANTS: Record<string, "success" | "warning" | "danger" | "info" | "purple" | "secondary"> = {
  PENDING: 'secondary', QUEUED: 'purple', DISPATCHED: 'info',
  RUNNING: 'warning', SUCCEEDED: 'success', FAILED: 'danger',
  SKIPPED: 'secondary', CANCELLED: 'secondary',
};

const RUN_STATE_BADGE_VARIANTS: Record<string, "success" | "warning" | "danger" | "info" | "purple" | "secondary"> = {
  DRAFT: 'secondary', PLANNING: 'info', ROUTING: 'purple',
  EXECUTING: 'success', WAITING_APPROVAL: 'warning', RETRYING: 'warning',
  PAUSED: 'secondary', FAILED: 'danger', COMPLETED: 'success', CANCELLED: 'secondary',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  PLANNER: <ClipboardList className="h-5 w-5" />,
  RESEARCHER: <Search className="h-5 w-5" />,
  BUILDER: <Wrench className="h-5 w-5" />,
  REVIEWER: <Eye className="h-5 w-5" />,
  OPERATIONS: <Settings className="h-5 w-5" />,
};

export function RunsPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  // WebSocket is connected globally in App.tsx - events come through the store
  const { 
    runs, selectedRun, tasks, runsLoading, wsConnected,
    fetchRuns, selectRun, createRun, startRun, cancelRun, resumeRun, fetchTasks,
    events, addToast, providers
  } = useAppStore();
  
  const [showNewRunModal, setShowNewRunModal] = useState(false);
  const [newPrompt, setNewPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [streamingOutputs, setStreamingOutputs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchRuns(true); // Force initial fetch
    loadWorkflows();
  }, []);

  // Slow polling only when WebSocket is disconnected
  useEffect(() => {
    if (wsConnected) return;
    const interval = setInterval(() => fetchRuns(), 30000); // 30 seconds fallback
    return () => clearInterval(interval);
  }, [wsConnected]);

  useEffect(() => {
    if (runId) {
      selectRun(runId);
    }
  }, [runId]);

  // Fallback task polling when run is active and WS disconnected
  useEffect(() => {
    if (!runId || wsConnected) return;
    // Poll tasks while run is active
    const activeStates = ['PLANNING', 'ROUTING', 'EXECUTING', 'RETRYING'];
    if (selectedRun && activeStates.includes(selectedRun.state)) {
      const interval = setInterval(() => fetchTasks(runId), 5000);
      return () => clearInterval(interval);
    }
  }, [runId, wsConnected, selectedRun?.state]);

  useEffect(() => {
    const latestEvent = events[0];
    if (!latestEvent) return;

    if (latestEvent.type === 'PROVIDER_STREAM_CHUNK' && latestEvent.payload?.taskId) {
      const taskId = latestEvent.payload.taskId as string;
      const chunk = latestEvent.payload.chunk as string;
      setStreamingOutputs(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || '') + chunk
      }));
    }
    if (latestEvent.type === 'PROVIDER_CALL_COMPLETED' && latestEvent.payload?.taskId) {
      const taskId = latestEvent.payload.taskId as string;
      const output = latestEvent.payload.output as string;
      setStreamingOutputs(prev => ({ ...prev, [taskId]: output }));
    }
    if (latestEvent.type === 'TASK_STATE_CHANGED' && latestEvent.payload?.newState === 'FAILED') {
      const error = latestEvent.payload.error as string | undefined;
      addToast('error', 'Task failed', error || 'An agent task failed');
    }
    if (latestEvent.type === 'RUN_STATE_CHANGED' && latestEvent.payload?.newState === 'COMPLETED') {
      addToast('success', 'Run completed', 'All tasks finished successfully');
    }
    if (latestEvent.type === 'RUN_STATE_CHANGED' && latestEvent.payload?.newState === 'FAILED') {
      addToast('error', 'Run failed', 'The workflow encountered an error');
    }
  }, [events]);

  const loadWorkflows = async () => {
    try {
      const data = await api.listWorkflowTemplates();
      setWorkflows(data || []);
    } catch (err: any) {
      console.error('Failed to load workflows:', err);
      addToast('error', 'Failed to load workflows', err.message);
    }
  };

  const handleCreateRun = async () => {
    if (!newPrompt.trim()) {
      addToast('warning', 'Prompt required', 'Please enter a prompt for your run');
      return;
    }
    if (providers.length === 0) {
      addToast('warning', 'No providers configured', 'Please register a provider first on the Providers page');
      return;
    }
    setCreating(true);
    try {
      const run = await createRun(newPrompt.trim(), {
        workflow_template_id: selectedWorkflow || undefined
      });
      await startRun(run.id);
      setShowNewRunModal(false);
      setNewPrompt('');
      navigate(`/runs/${run.id}`);
      addToast('success', 'Run started', 'Workflow execution has begun');
    } catch (err: any) {
      addToast('error', 'Failed to create run', err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCancelRun = async () => {
    if (!runId) return;
    try {
      await cancelRun(runId);
      addToast('info', 'Run cancelled', 'The workflow has been stopped');
    } catch (err: any) {
      addToast('error', 'Failed to cancel', err.message);
    }
  };

  const handleResumeRun = async () => {
    if (!runId) return;
    try {
      await resumeRun(runId);
      addToast('success', 'Run resumed', 'The workflow will continue');
    } catch (err: any) {
      addToast('error', 'Failed to resume', err.message);
    }
  };

  const sortedTasks = [...tasks].sort((a, b) => a.sequence_index - b.sequence_index);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground">Manage and monitor your AI workflow runs</p>
        </div>
        <Button onClick={() => setShowNewRunModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Run
        </Button>
      </div>

      <div className={cn(
        "grid gap-6",
        runId ? "grid-cols-[320px_1fr]" : "grid-cols-1"
      )}>
        {/* Runs List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              All Runs
              <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {runs.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {runsLoading && runs.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground px-4">
                <Inbox className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm font-medium">No runs yet</p>
                <p className="text-xs">Create your first run to get started</p>
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="space-y-2 p-4">
                  {runs.map(run => (
                    <div
                      key={run.id}
                      onClick={() => navigate(`/runs/${run.id}`)}
                      className={cn(
                        "cursor-pointer rounded-lg p-3 transition-all",
                        runId === run.id
                          ? "bg-primary/10 border-2 border-primary"
                          : "bg-muted/30 border-2 border-transparent hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full",
                          run.state === 'EXECUTING' && "bg-emerald-400",
                          run.state === 'COMPLETED' && "bg-emerald-500",
                          run.state === 'FAILED' && "bg-red-500",
                          run.state === 'PAUSED' && "bg-amber-500",
                          !['EXECUTING', 'COMPLETED', 'FAILED', 'PAUSED'].includes(run.state) && "bg-gray-500"
                        )} />
                        <Badge variant={RUN_STATE_BADGE_VARIANTS[run.state] || 'secondary'} className="text-[10px]">
                          {run.state}
                        </Badge>
                        <code className="ml-auto text-[10px] text-muted-foreground font-mono">
                          {run.id.slice(0, 8)}
                        </code>
                      </div>
                      <p className="text-sm text-foreground mb-1">
                        {run.prompt.slice(0, 60)}{run.prompt.length > 60 ? '...' : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(run.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Run Detail */}
        {runId && selectedRun && (
          <div className="space-y-4">
            {/* Run Header */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-bold">Run {runId.slice(0, 8)}</h2>
                      <Badge variant={RUN_STATE_BADGE_VARIANTS[selectedRun.state] || 'secondary'}>
                        {selectedRun.state}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">{selectedRun.prompt}</p>
                  </div>
                  <div className="flex gap-2">
                    {selectedRun.state === 'PAUSED' && (
                      <Button size="sm" onClick={handleResumeRun}>
                        <Play className="h-4 w-4 mr-1" />
                        Resume
                      </Button>
                    )}
                    {!['COMPLETED', 'CANCELLED', 'FAILED'].includes(selectedRun.state) && (
                      <Button size="sm" variant="destructive" onClick={handleCancelRun}>
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Task Flow */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Agent Workflow
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sortedTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Clock className="h-10 w-10 mb-3 opacity-50 animate-pulse" />
                    <p className="text-sm">Waiting for tasks to be created...</p>
                  </div>
                ) : (
                  <div className="flex gap-4 overflow-x-auto py-2">
                    {sortedTasks.map((task, i) => (
                      <React.Fragment key={task.id}>
                        <TaskCard task={task} streamingOutput={streamingOutputs[task.id]} />
                        {i < sortedTasks.length - 1 && (
                          <div className="flex items-center text-muted-foreground text-2xl">→</div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Task Details */}
            {sortedTasks.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Task Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sortedTasks.map(task => (
                    <TaskDetailRow key={task.id} task={task} streamingOutput={streamingOutputs[task.id]} />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Artifacts Section */}
            <ArtifactViewer runId={runId} />
          </div>
        )}
      </div>

      {/* New Run Modal */}
      <Dialog open={showNewRunModal} onOpenChange={setShowNewRunModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              New Run
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Prompt</label>
              <Textarea
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                placeholder='Describe what you want to accomplish (e.g., "Build a REST API for a todo app")'
                rows={4}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">
                Workflow Template (optional)
              </label>
              <select 
                className="w-full rounded-md bg-muted/50 border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={selectedWorkflow} 
                onChange={e => setSelectedWorkflow(e.target.value)}
              >
                <option value="">Default (Single Agent)</option>
                {workflows.map(wf => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} ({wf.agent_sequence?.join(' → ')})
                  </option>
                ))}
              </select>
            </div>
            <Button 
              className="w-full"
              onClick={handleCreateRun}
              disabled={creating || !newPrompt.trim()}
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Run
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskCard({ task, streamingOutput }: { task: Task; streamingOutput?: string }) {
  const isActive = ['RUNNING', 'DISPATCHED'].includes(task.state);
  return (
    <div className={cn(
      "min-w-[160px] p-4 rounded-xl bg-muted/30 border-2 relative",
      task.state === 'SUCCEEDED' && "border-emerald-500/50",
      task.state === 'FAILED' && "border-red-500/50",
      task.state === 'RUNNING' && "border-amber-500/50",
      !['SUCCEEDED', 'FAILED', 'RUNNING'].includes(task.state) && "border-border"
    )}>
      {isActive && (
        <div className="absolute top-3 right-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
        </div>
      )}
      <div className="text-2xl mb-2 text-muted-foreground">
        {ROLE_ICONS[task.agent_role] || <Bot className="h-6 w-6" />}
      </div>
      <div className="font-semibold text-sm mb-2">{task.agent_role}</div>
      <Badge variant={TASK_STATE_BADGE_VARIANTS[task.state] || 'secondary'} className="text-[10px]">
        {task.state}
      </Badge>
      {task.token_usage?.totalTokens && (
        <div className="text-xs text-muted-foreground mt-2">
          {task.token_usage.totalTokens.toLocaleString()} tokens
        </div>
      )}
    </div>
  );
}

function TaskDetailRow({ task, streamingOutput }: { task: Task; streamingOutput?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const addToast = useAppStore(s => s.addToast);
  
  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await api.retryTask(task.id);
      addToast('success', 'Task re-queued', 'The task will be retried');
    } catch (err: any) {
      addToast('error', 'Retry failed', err.message);
    } finally {
      setRetrying(false);
    }
  };
  
  const getTaskOutput = (): string => {
    if (streamingOutput) return streamingOutput;
    if (task.output?.response) return task.output.response;
    if (task.output && typeof task.output === 'string') {
      try {
        const parsed = JSON.parse(task.output);
        return parsed.response || JSON.stringify(parsed, null, 2);
      } catch {
        return task.output;
      }
    }
    if (task.output && typeof task.output === 'object') {
      return JSON.stringify(task.output, null, 2);
    }
    if (task.failure_message) return `Error: ${task.failure_message}`;
    return '';
  };
  
  const output = getTaskOutput();
  const displayOutput = output.slice(0, 80) + (output.length > 80 ? '...' : '');

  return (
    <div className={cn(
      "rounded-lg bg-muted/30 border overflow-hidden",
      task.state === 'SUCCEEDED' && "border-emerald-500/30",
      task.state === 'FAILED' && "border-red-500/30",
      task.state === 'RUNNING' && "border-amber-500/30",
      !['SUCCEEDED', 'FAILED', 'RUNNING'].includes(task.state) && "border-border/50"
    )}>
      <div 
        onClick={() => setExpanded(!expanded)}
        className="p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
      >
        <span className="text-muted-foreground">
          {ROLE_ICONS[task.agent_role] || <Bot className="h-5 w-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{task.agent_role}</div>
          <div className={cn(
            "text-xs truncate",
            task.state === 'FAILED' ? "text-red-400" : "text-muted-foreground"
          )}>
            {task.state === 'RUNNING' ? 'Processing...' : 
             task.state === 'FAILED' ? (task.failure_message || 'Task failed') :
             output ? displayOutput : 'Waiting...'}
          </div>
        </div>
        {task.state === 'FAILED' && (
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleRetry}
            disabled={retrying}
            className="h-7 px-2"
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        )}
        <Badge variant={TASK_STATE_BADGE_VARIANTS[task.state] || 'secondary'} className="text-[10px]">
          {task.state}
        </Badge>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      {expanded && (output || task.failure_message) && (
        <div className="p-4 border-t border-border/50 bg-background/50">
          <pre className={cn(
            "whitespace-pre-wrap break-words text-sm max-h-[300px] overflow-y-auto font-mono",
            task.state === 'FAILED' ? "text-red-400" : "text-muted-foreground"
          )}>
            {output || task.failure_message}
            {task.state === 'RUNNING' && <span className="text-amber-500 animate-pulse">|</span>}
          </pre>
          {task.state === 'FAILED' && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={handleRetry}
              disabled={retrying}
              className="mt-3"
            >
              {retrying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Task
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
