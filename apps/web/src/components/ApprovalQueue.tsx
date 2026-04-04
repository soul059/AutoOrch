import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../stores/useAppStore';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { AlertTriangle, CheckCircle, XCircle, Clock, Shield, User } from 'lucide-react';

interface Props {
  onAction: () => void;
}

const RISK_VARIANTS: Record<string, "success" | "warning" | "danger" | "info"> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};

export function ApprovalQueue({ onAction }: Props) {
  const [approvals, setApprovals] = useState<any[]>([]);
  const { wsConnected } = useAppStore();

  useEffect(() => {
    const load = () => api.listPendingApprovals().then(setApprovals).catch(console.error);
    load();
    
    // Slower polling - approvals don't change that frequently
    const interval = setInterval(load, wsConnected ? 30000 : 15000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  const handleApprove = async (id: string) => {
    await api.approve(id, 'Approved via dashboard');
    onAction();
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  const handleReject = async (id: string) => {
    await api.reject(id, 'Rejected via dashboard');
    onAction();
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  if (approvals.length === 0) return null;

  return (
    <Card className="border-amber-500/50 bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-400">
          <AlertTriangle className="h-5 w-5" />
          Pending Approvals
          <Badge variant="warning" className="ml-auto">{approvals.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-3">
            {approvals.map(a => (
              <div 
                key={a.id} 
                className="rounded-lg bg-muted/50 p-4 border border-border/50 space-y-3"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={RISK_VARIANTS[a.risk_level] || 'warning'}>
                    <Shield className="h-3 w-3 mr-1" />
                    {a.risk_level}
                  </Badge>
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {a.agent_role}
                  </Badge>
                </div>
                
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Action: <span className="text-primary">{a.action}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Run: {a.prompt?.slice(0, 60)}...
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expires: {new Date(a.expires_at).toLocaleString()}
                  </p>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button 
                    size="sm" 
                    variant="success" 
                    onClick={() => handleApprove(a.id)}
                    className="flex-1"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button 
                    size="sm" 
                    variant="destructive" 
                    onClick={() => handleReject(a.id)}
                    className="flex-1"
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
