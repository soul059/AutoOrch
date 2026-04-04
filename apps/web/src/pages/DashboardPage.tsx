import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/utils';
import { 
  Rocket, 
  CheckCircle2, 
  Zap, 
  Wifi,
  WifiOff,
  Clock,
  AlertCircle,
  Activity,
  TrendingUp,
  Server
} from 'lucide-react';

interface DashboardStats {
  runs: Record<string, number>;
  tasks: Record<string, number>;
  providers: { total: number; healthy: number };
}

const STATE_ICONS: Record<string, React.ReactNode> = {
  DRAFT: <Clock className="h-5 w-5 text-muted-foreground" />,
  PLANNING: <Activity className="h-5 w-5 text-blue-400" />,
  ROUTING: <TrendingUp className="h-5 w-5 text-violet-400" />,
  EXECUTING: <Zap className="h-5 w-5 text-emerald-400" />,
  WAITING_APPROVAL: <Clock className="h-5 w-5 text-amber-400" />,
  RETRYING: <Activity className="h-5 w-5 text-orange-400" />,
  PAUSED: <Clock className="h-5 w-5 text-muted-foreground" />,
  FAILED: <AlertCircle className="h-5 w-5 text-red-400" />,
  COMPLETED: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
  CANCELLED: <AlertCircle className="h-5 w-5 text-muted-foreground" />,
};

const STATE_BADGE_VARIANTS: Record<string, "success" | "warning" | "danger" | "info" | "purple" | "secondary"> = {
  EXECUTING: 'success',
  PLANNING: 'info',
  ROUTING: 'purple',
  COMPLETED: 'success',
  FAILED: 'danger',
  PAUSED: 'warning',
  WAITING_APPROVAL: 'warning',
};

const EVENT_COLORS: Record<string, string> = {
  RUN_STATE_CHANGED: 'text-blue-400',
  TASK_STATE_CHANGED: 'text-violet-400',
  PROVIDER_CALL_STARTED: 'text-amber-400',
  PROVIDER_CALL_COMPLETED: 'text-emerald-400',
  PROVIDER_CALL_FAILED: 'text-red-400',
  TASKS_QUEUED: 'text-cyan-400',
  TASKS_DISPATCHED: 'text-teal-400',
};

export function DashboardPage() {
  const { runs, providers, fetchRuns, fetchProviders, events, wsConnected, addToast } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    // Initial fetch only - WebSocket handles updates
    fetchRuns(true);
    fetchProviders(true);
    loadStats();
  }, []);
  
  // Slow health check polling (not critical real-time data)
  useEffect(() => {
    const interval = setInterval(loadStats, 60000); // Once per minute
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      const [statusData, healthData] = await Promise.all([
        api.getObservabilityStatus().catch(() => ({ runs: {}, tasks: {}, providers: [] })),
        api.getObservabilityHealth().catch(() => null),
      ]);
      setStats(statusData as DashboardStats);
      setHealth(healthData);
    } catch (err: any) {
      console.error('Failed to load stats:', err);
    }
  };

  const activeRuns = runs.filter(r => ['EXECUTING', 'PLANNING', 'ROUTING'].includes(r.state)).length;
  const completedRuns = runs.filter(r => r.state === 'COMPLETED').length;
  const failedRuns = runs.filter(r => r.state === 'FAILED').length;
  const healthyProviders = providers.filter(p => p.health_status?.isHealthy).length;

  const recentEvents = events.slice(0, 10);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your AutoOrch system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Runs</CardTitle>
            <Rocket className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{activeRuns}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {runs.length} total runs
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{completedRuns}</div>
            <Progress 
              value={runs.length ? (completedRuns / runs.length) * 100 : 0} 
              className="mt-2"
              indicatorClassName="bg-emerald-500"
            />
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Providers</CardTitle>
            <Zap className="h-4 w-4 text-violet-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {healthyProviders}<span className="text-lg text-muted-foreground">/{providers.length}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {healthyProviders === providers.length ? 'All healthy' : `${providers.length - healthyProviders} unhealthy`}
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className={cn(
            "absolute inset-0 bg-gradient-to-br to-transparent",
            wsConnected ? "from-emerald-500/10" : "from-red-500/10"
          )} />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Connection</CardTitle>
            {wsConnected ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-400" />
            )}
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold",
              wsConnected ? "text-emerald-400" : "text-red-400"
            )}>
              {wsConnected ? 'Live' : 'Offline'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Real-time updates
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Recent Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Rocket className="h-12 w-12 mb-4 opacity-50" />
                <p>No runs yet</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {runs.slice(0, 5).map(run => (
                    <div
                      key={run.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      {STATE_ICONS[run.state] || <Activity className="h-5 w-5" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {run.prompt.slice(0, 50)}{run.prompt.length > 50 ? '...' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(run.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={STATE_BADGE_VARIANTS[run.state] || 'secondary'}>
                        {run.state}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Live Events */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                {wsConnected && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span className={cn(
                  "relative inline-flex rounded-full h-2 w-2",
                  wsConnected ? "bg-emerald-400" : "bg-red-400"
                )}></span>
              </span>
              Live Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Activity className="h-12 w-12 mb-4 opacity-50" />
                <p>Waiting for events...</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2 font-mono text-xs">
                  {recentEvents.map((event, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2 rounded bg-muted/30 animate-slide-in"
                    >
                      <span className={cn("font-semibold min-w-[160px]", EVENT_COLORS[event.type] || "text-muted-foreground")}>
                        {event.type}
                      </span>
                      <span className="text-muted-foreground">
                        {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* System Health */}
      {health && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                System Health
              </CardTitle>
              <Badge variant={health.status === 'healthy' ? 'success' : 'danger'}>
                {health.status?.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Database</p>
                <p className={cn(
                  "text-lg font-semibold",
                  health.checks?.database?.status === 'healthy' ? "text-emerald-400" : "text-red-400"
                )}>
                  {health.checks?.database?.status === 'healthy' ? `${health.checks?.database?.latencyMs ?? 0}ms` : 'Disconnected'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className="text-lg font-semibold">
                  {Math.floor((health.uptime ?? 0) / 3600)}h {Math.floor(((health.uptime ?? 0) % 3600) / 60)}m
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Healthy Providers</p>
                <p className="text-lg font-semibold">
                  {health.metrics?.['autoorch_providers_healthy'] ?? healthyProviders}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Total Runs</p>
                <p className="text-lg font-semibold">{runs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
