import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { cn } from '../lib/utils';
import {
  ClipboardList,
  Clock,
  ListTodo,
  Send,
  Play,
  CheckCircle2,
  XCircle,
  SkipForward,
  Ban,
  Zap,
  FileText,
  AlertTriangle,
  Coins,
  X
} from 'lucide-react';

const TASK_STATE_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="h-4 w-4 text-gray-400" />,
  QUEUED: <ListTodo className="h-4 w-4 text-blue-400" />,
  DISPATCHED: <Send className="h-4 w-4 text-violet-400" />,
  RUNNING: <Play className="h-4 w-4 text-emerald-400" />,
  SUCCEEDED: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  FAILED: <XCircle className="h-4 w-4 text-red-400" />,
  SKIPPED: <SkipForward className="h-4 w-4 text-gray-400" />,
  CANCELLED: <Ban className="h-4 w-4 text-gray-400" />,
};

const TASK_STATE_BADGE_VARIANTS: Record<string, "success" | "warning" | "danger" | "info" | "purple" | "secondary"> = {
  PENDING: 'secondary',
  QUEUED: 'info',
  DISPATCHED: 'purple',
  RUNNING: 'success',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  SKIPPED: 'secondary',
  CANCELLED: 'secondary',
};

interface Props {
  runId: string;
}

export function TaskGraph({ runId }: Props) {
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  // Use tasks from the store
  const { tasks, fetchTasks, wsConnected } = useAppStore();
  
  useEffect(() => {
    // Initial fetch only
    fetchTasks(runId, true);
  }, [runId]);

  // Slow polling only when WebSocket is disconnected
  useEffect(() => {
    if (wsConnected) return;
    
    const interval = setInterval(() => {
      fetchTasks(runId);
    }, 10000); // 10 seconds instead of 3
    return () => clearInterval(interval);
  }, [runId, wsConnected]);

  const openTaskDetail = (task: any) => {
    setSelectedTask(task);
    setShowModal(true);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Task Graph
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Clock className="h-10 w-10 mb-3 opacity-50 animate-pulse" />
            <p className="text-sm">No tasks yet. Waiting for planning to complete...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tasks.map(task => (
              <div
                key={task.id}
                onClick={() => openTaskDetail(task)}
                className={cn(
                  "rounded-lg bg-muted/30 p-4 cursor-pointer transition-all hover:bg-muted/50 border-l-4",
                  task.state === 'SUCCEEDED' && "border-l-emerald-500",
                  task.state === 'FAILED' && "border-l-red-500",
                  task.state === 'RUNNING' && "border-l-emerald-400",
                  task.state === 'QUEUED' && "border-l-blue-400",
                  task.state === 'DISPATCHED' && "border-l-violet-400",
                  !['SUCCEEDED', 'FAILED', 'RUNNING', 'QUEUED', 'DISPATCHED'].includes(task.state) && "border-l-gray-500"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-foreground">{task.agent_role}</span>
                  <Badge variant={TASK_STATE_BADGE_VARIANTS[task.state] || 'secondary'} className="text-[10px]">
                    {task.state}
                  </Badge>
                </div>

                {task.state === 'RUNNING' && (
                  <div className="flex items-center gap-2 text-emerald-400 text-xs mb-2">
                    <Zap className="h-3 w-3 animate-pulse" />
                    Processing...
                  </div>
                )}

                {(task.retry_count ?? 0) > 0 && (
                  <p className="text-xs text-orange-400 mb-1">
                    Retry: {task.retry_count}/{task.max_retries}
                  </p>
                )}

                {task.failure_message && (
                  <p className="text-xs text-red-400 mb-1 truncate">
                    {task.failure_message.slice(0, 80)}
                  </p>
                )}

                {task.token_usage && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                    <Coins className="h-3 w-3" />
                    {task.token_usage.totalTokens || 0} tokens
                  </p>
                )}

                {task.output && (
                  <div className="flex items-start gap-2 mt-2 p-2 bg-background/50 rounded text-xs text-muted-foreground">
                    <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="truncate">
                      {typeof task.output === 'string'
                        ? (task.output as string).slice(0, 60)
                        : (task.output as any)?.response?.slice(0, 60) || 'Click to view output'}...
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Task Detail Modal */}
        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent className="max-w-3xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                {TASK_STATE_ICONS[selectedTask?.state]}
                {selectedTask?.agent_role} Task
                <Badge variant={TASK_STATE_BADGE_VARIANTS[selectedTask?.state] || 'secondary'}>
                  {selectedTask?.state}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="output" className="mt-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="output">Output</TabsTrigger>
                <TabsTrigger value="input">Input</TabsTrigger>
                <TabsTrigger value="stats">Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="output" className="mt-4">
                <ScrollArea className="h-[400px]">
                  {selectedTask?.output ? (
                    <div className="bg-muted/30 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
                      {typeof selectedTask.output === 'string'
                        ? selectedTask.output
                        : selectedTask.output?.response || JSON.stringify(selectedTask.output, null, 2)
                      }
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <FileText className="h-10 w-10 mb-3 opacity-50" />
                      <p className="text-sm">No output yet</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="input" className="mt-4">
                <ScrollArea className="h-[400px]">
                  <pre className="bg-muted/30 rounded-lg p-4 text-xs overflow-auto font-mono">
                    {JSON.stringify(selectedTask?.input, null, 2)}
                  </pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="stats" className="mt-4">
                <div className="space-y-4">
                  {selectedTask?.token_usage && (
                    <div className="bg-muted/30 rounded-lg p-4">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Coins className="h-4 w-4" />
                        Token Usage
                      </h4>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-background/50 rounded-lg">
                          <p className="text-2xl font-bold text-primary">{selectedTask.token_usage.promptTokens || 0}</p>
                          <p className="text-xs text-muted-foreground">Prompt</p>
                        </div>
                        <div className="text-center p-3 bg-background/50 rounded-lg">
                          <p className="text-2xl font-bold text-violet-400">{selectedTask.token_usage.completionTokens || 0}</p>
                          <p className="text-xs text-muted-foreground">Completion</p>
                        </div>
                        <div className="text-center p-3 bg-background/50 rounded-lg">
                          <p className="text-2xl font-bold text-emerald-400">{selectedTask.token_usage.totalTokens || 0}</p>
                          <p className="text-xs text-muted-foreground">Total</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedTask?.failure_message && (
                    <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-4">
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 text-red-400">
                        <AlertTriangle className="h-4 w-4" />
                        Error
                      </h4>
                      <p className="text-sm text-red-300">{selectedTask.failure_message}</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
