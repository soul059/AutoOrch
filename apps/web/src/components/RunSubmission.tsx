import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { 
  Send, 
  ChevronDown, 
  ChevronRight, 
  Workflow,
  ArrowRight,
  Loader2
} from 'lucide-react';

interface Props {
  onCreated: () => void;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  agent_sequence: string[];
  is_default: boolean;
}

export function RunSubmission({ onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('default');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      const data = await api.listWorkflowTemplates();
      setWorkflows(data || []);
      const defaultWf = data?.find((w: WorkflowTemplate) => w.is_default);
      if (defaultWf) {
        setSelectedWorkflow(defaultWf.id);
      }
    } catch (err) {
      console.error('Failed to load workflows:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError('');
    try {
      const workflowId = selectedWorkflow && selectedWorkflow !== 'default' ? selectedWorkflow : undefined;

      const run = await api.createRun(prompt.trim(), {
        workflow_template_id: workflowId,
      });
      await api.startRun(run.id);
      setPrompt('');
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedWf = workflows.find(w => w.id === selectedWorkflow);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          New Run
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder='Enter your prompt (e.g., "Start a drop-shipping business")'
            rows={3}
            className="resize-none"
          />
          
          {/* Workflow selector toggle */}
          <button 
            type="button" 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Workflow className="h-3 w-3" />
            Agent Workflow {selectedWf && <span className="text-primary">({selectedWf.name})</span>}
          </button>

          {showAdvanced && (
            <div className="rounded-lg bg-muted/50 border border-border/50 p-4 space-y-3 animate-fade-in">
              <p className="text-xs text-muted-foreground">Select which agents process this run:</p>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="workflow"
                    value="default"
                    checked={selectedWorkflow === 'default'}
                    onChange={() => setSelectedWorkflow('default')}
                    className="accent-primary"
                  />
                  <span className="text-sm text-foreground group-hover:text-primary transition-colors">
                    Default (Single Builder Agent)
                  </span>
                </label>
                
                {workflows.map(wf => (
                  <label key={wf.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="radio"
                      name="workflow"
                      value={wf.id}
                      checked={selectedWorkflow === wf.id}
                      onChange={() => setSelectedWorkflow(wf.id)}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                      {wf.name}
                      {wf.is_default && <Badge variant="success" className="text-[9px] px-1.5 py-0">Default</Badge>}
                    </span>
                  </label>
                ))}
              </div>
              
              {selectedWf && (
                <div className="pt-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground mb-2">Agent Flow:</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selectedWf.agent_sequence.map((agent, i) => (
                      <React.Fragment key={i}>
                        <Badge variant="info" className="text-[10px]">{agent}</Badge>
                        {i < selectedWf.agent_sequence.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading || !prompt.trim()}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Start Run
                </>
              )}
            </Button>
            
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
