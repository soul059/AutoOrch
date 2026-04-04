import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../stores/useAppStore';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';
import {
  FileText,
  Brain,
  GitBranch,
  Zap,
  Clock,
  RefreshCw,
  Pause,
  XCircle,
  CheckCircle2,
  Ban,
  Rocket,
  Inbox
} from 'lucide-react';

const STATE_ICONS: Record<string, React.ReactNode> = {
  DRAFT: <FileText className="h-4 w-4 text-gray-400" />,
  PLANNING: <Brain className="h-4 w-4 text-blue-400" />,
  ROUTING: <GitBranch className="h-4 w-4 text-violet-400" />,
  EXECUTING: <Zap className="h-4 w-4 text-emerald-400" />,
  WAITING_APPROVAL: <Clock className="h-4 w-4 text-amber-400" />,
  RETRYING: <RefreshCw className="h-4 w-4 text-orange-400" />,
  PAUSED: <Pause className="h-4 w-4 text-gray-400" />,
  FAILED: <XCircle className="h-4 w-4 text-red-400" />,
  COMPLETED: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  CANCELLED: <Ban className="h-4 w-4 text-gray-400" />,
};

const STATE_BADGE_VARIANTS: Record<string, "success" | "warning" | "danger" | "info" | "purple" | "secondary"> = {
  DRAFT: 'secondary',
  PLANNING: 'info',
  ROUTING: 'purple',
  EXECUTING: 'success',
  WAITING_APPROVAL: 'warning',
  RETRYING: 'warning',
  PAUSED: 'secondary',
  FAILED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
};

interface Props {
  onSelectRun: (id: string) => void;
  refreshKey: number;
}

export function RunList({ onSelectRun, refreshKey }: Props) {
  const { runs, fetchRuns, wsConnected } = useAppStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Initial load and manual refresh only
  useEffect(() => {
    fetchRuns(true);
  }, [refreshKey]);

  // Slow polling only when WebSocket is disconnected (fallback)
  useEffect(() => {
    if (wsConnected) return; // Don't poll when WS is connected
    
    const interval = setInterval(() => {
      fetchRuns();
    }, 15000); // 15 seconds instead of 5
    return () => clearInterval(interval);
  }, [wsConnected]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    onSelectRun(id);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Rocket className="h-5 w-5" />
          Runs
        </CardTitle>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          {runs.length}
        </span>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Inbox className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm">No runs yet. Submit a prompt above.</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-2">
              {runs.map(run => (
                <div
                  key={run.id}
                  onClick={() => handleSelect(run.id)}
                  className={cn(
                    "group cursor-pointer rounded-lg border-2 p-3 transition-all hover:bg-muted/50",
                    selectedId === run.id
                      ? "border-primary bg-muted/70"
                      : "border-transparent bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {STATE_ICONS[run.state] || <Zap className="h-4 w-4" />}
                    <Badge variant={STATE_BADGE_VARIANTS[run.state] || 'secondary'} className="text-[10px]">
                      {run.state}
                    </Badge>
                    <code className="ml-auto text-xs text-muted-foreground font-mono">
                      {run.id.slice(0, 8)}
                    </code>
                  </div>
                  <p className="text-sm text-foreground mb-2 leading-snug">
                    {run.prompt.slice(0, 80)}{run.prompt.length > 80 ? '...' : ''}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                    {run.state === 'EXECUTING' && (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                        </span>
                        Live
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
