import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface Agent {
  name: string;
  display_name: string;
  system_prompt: string;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  agent_sequence: string[];
  dependencies: Record<string, string[]>;
  is_default: boolean;
}

interface Props {
  onWorkflowSelect?: (workflowId: string | null, customSequence?: string[]) => void;
  selectedWorkflowId?: string | null;
}

export function WorkflowEditor({ onWorkflowSelect, selectedWorkflowId }: Props) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customSequence, setCustomSequence] = useState<string[]>([]);
  
  // New template form
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    description: '',
    agent_sequence: [] as string[],
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [templatesData, agentsData] = await Promise.all([
        api.listWorkflowTemplates(),
        api.listAgentRoles(),
      ]);
      setTemplates(templatesData || []);
      setAgents(agentsData || []);
    } catch (err) {
      console.error('Failed to load workflow data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTemplate.agent_sequence.length === 0) {
      alert('Please select at least one agent');
      return;
    }
    
    try {
      // Build dependencies (each agent depends on the previous one)
      const dependencies: Record<string, string[]> = {};
      for (let i = 1; i < newTemplate.agent_sequence.length; i++) {
        dependencies[newTemplate.agent_sequence[i]] = [newTemplate.agent_sequence[i - 1]];
      }

      await api.createWorkflowTemplate({
        name: newTemplate.name,
        description: newTemplate.description,
        agent_sequence: newTemplate.agent_sequence,
        dependencies,
      });
      
      setShowCreateForm(false);
      setNewTemplate({ name: '', description: '', agent_sequence: [] });
      loadData();
    } catch (err: any) {
      alert('Failed to create template: ' + err.message);
    }
  };

  const handleAddAgent = (agentName: string) => {
    if (!newTemplate.agent_sequence.includes(agentName)) {
      setNewTemplate(prev => ({
        ...prev,
        agent_sequence: [...prev.agent_sequence, agentName],
      }));
    }
  };

  const handleRemoveAgent = (index: number) => {
    setNewTemplate(prev => ({
      ...prev,
      agent_sequence: prev.agent_sequence.filter((_, i) => i !== index),
    }));
  };

  const handleMoveAgent = (index: number, direction: 'up' | 'down') => {
    const newSeq = [...newTemplate.agent_sequence];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < newSeq.length) {
      [newSeq[index], newSeq[newIndex]] = [newSeq[newIndex], newSeq[index]];
      setNewTemplate(prev => ({ ...prev, agent_sequence: newSeq }));
    }
  };

  const handleSelectTemplate = (template: WorkflowTemplate) => {
    setCustomMode(false);
    onWorkflowSelect?.(template.id);
  };

  const handleCustomSequenceAdd = (agentName: string) => {
    if (!customSequence.includes(agentName)) {
      const newSeq = [...customSequence, agentName];
      setCustomSequence(newSeq);
      onWorkflowSelect?.(null, newSeq);
    }
  };

  const handleCustomSequenceRemove = (index: number) => {
    const newSeq = customSequence.filter((_, i) => i !== index);
    setCustomSequence(newSeq);
    onWorkflowSelect?.(null, newSeq);
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this workflow template?')) return;
    try {
      await api.deleteWorkflowTemplate(id);
      loadData();
    } catch (err: any) {
      alert('Failed to delete: ' + err.message);
    }
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading workflows...</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>🔄 Workflow Templates</h3>
        <div style={styles.headerActions}>
          <button
            style={customMode ? styles.activeBtn : styles.btn}
            onClick={() => {
              setCustomMode(!customMode);
              if (!customMode) {
                setCustomSequence([]);
                onWorkflowSelect?.(null, []);
              }
            }}
          >
            {customMode ? '✓ Custom Mode' : '⚙ Custom'}
          </button>
          <button 
            style={styles.addBtn} 
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? '✕' : '+'}
          </button>
        </div>
      </div>

      {/* Custom Mode - Build your own sequence */}
      {customMode && (
        <div style={styles.customMode}>
          <p style={styles.customLabel}>Build custom agent sequence:</p>
          
          {/* Available agents */}
          <div style={styles.agentPicker}>
            {agents.map(agent => (
              <button
                key={agent.name}
                style={{
                  ...styles.agentChip,
                  opacity: customSequence.includes(agent.name) ? 0.5 : 1,
                }}
                onClick={() => handleCustomSequenceAdd(agent.name)}
                disabled={customSequence.includes(agent.name)}
              >
                + {agent.display_name || agent.name}
              </button>
            ))}
          </div>

          {/* Selected sequence */}
          {customSequence.length > 0 && (
            <div style={styles.sequencePreview}>
              <span style={styles.sequenceLabel}>Sequence:</span>
              {customSequence.map((name, i) => (
                <React.Fragment key={i}>
                  <span style={styles.sequenceNode}>
                    {name}
                    <button style={styles.removeChip} onClick={() => handleCustomSequenceRemove(i)}>×</button>
                  </span>
                  {i < customSequence.length - 1 && <span style={styles.arrow}>→</span>}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create new template form */}
      {showCreateForm && (
        <form onSubmit={handleCreateTemplate} style={styles.form}>
          <input
            type="text"
            placeholder="Template name"
            value={newTemplate.name}
            onChange={e => setNewTemplate({ ...newTemplate, name: e.target.value })}
            style={styles.input}
            required
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newTemplate.description}
            onChange={e => setNewTemplate({ ...newTemplate, description: e.target.value })}
            style={styles.input}
          />
          
          <p style={styles.label}>Select agents (in order):</p>
          <div style={styles.agentPicker}>
            {agents.map(agent => (
              <button
                key={agent.name}
                type="button"
                style={{
                  ...styles.agentChip,
                  opacity: newTemplate.agent_sequence.includes(agent.name) ? 0.5 : 1,
                }}
                onClick={() => handleAddAgent(agent.name)}
                disabled={newTemplate.agent_sequence.includes(agent.name)}
              >
                + {agent.display_name || agent.name}
              </button>
            ))}
          </div>

          {/* Sequence preview */}
          {newTemplate.agent_sequence.length > 0 && (
            <div style={styles.sequenceBuilder}>
              <p style={styles.label}>Agent sequence:</p>
              {newTemplate.agent_sequence.map((name, i) => (
                <div key={i} style={styles.sequenceItem}>
                  <span style={styles.sequenceNumber}>{i + 1}</span>
                  <span style={styles.sequenceName}>{name}</span>
                  <div style={styles.sequenceActions}>
                    <button type="button" onClick={() => handleMoveAgent(i, 'up')} disabled={i === 0}>↑</button>
                    <button type="button" onClick={() => handleMoveAgent(i, 'down')} disabled={i === newTemplate.agent_sequence.length - 1}>↓</button>
                    <button type="button" onClick={() => handleRemoveAgent(i)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="submit" style={styles.submitBtn}>Create Template</button>
        </form>
      )}

      {/* Template list */}
      <div style={styles.templateList}>
        {templates.length === 0 ? (
          <p style={styles.empty}>No workflow templates. Create one or use custom mode.</p>
        ) : (
          templates.map(template => (
            <div
              key={template.id}
              style={{
                ...styles.templateCard,
                borderColor: selectedWorkflowId === template.id ? '#3b82f6' : '#333',
              }}
              onClick={() => handleSelectTemplate(template)}
            >
              <div style={styles.templateHeader}>
                <span style={styles.templateName}>
                  {template.name}
                  {template.is_default && <span style={styles.defaultBadge}>Default</span>}
                </span>
                {!template.is_default && (
                  <button
                    style={styles.deleteBtn}
                    onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(template.id); }}
                  >×</button>
                )}
              </div>
              {template.description && <p style={styles.templateDesc}>{template.description}</p>}
              
              {/* Visual flow */}
              <div style={styles.flowPreview}>
                {(template.agent_sequence || []).map((agent, i) => (
                  <React.Fragment key={i}>
                    <span style={styles.flowNode}>{agent}</span>
                    {i < template.agent_sequence.length - 1 && <span style={styles.flowArrow}>→</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 16, marginBottom: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 16, color: '#e5e5e5', margin: 0 },
  headerActions: { display: 'flex', gap: 8 },
  btn: {
    background: '#222', border: '1px solid #444', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, color: '#aaa', cursor: 'pointer',
  },
  activeBtn: {
    background: '#2563eb', border: '1px solid #2563eb', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, color: 'white', cursor: 'pointer',
  },
  addBtn: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 'bold',
  },
  loading: { color: '#666', fontSize: 13 },
  empty: { color: '#555', fontSize: 12, textAlign: 'center' as const, padding: 16 },

  customMode: { background: '#1a1a2e', borderRadius: 6, padding: 12, marginBottom: 12 },
  customLabel: { color: '#888', fontSize: 12, marginBottom: 8 },

  form: { background: '#1a1a1a', borderRadius: 6, padding: 12, marginBottom: 12 },
  input: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '6px 10px',
    color: '#e5e5e5', fontSize: 12, width: '100%', marginBottom: 8, boxSizing: 'border-box' as const,
  },
  label: { color: '#888', fontSize: 11, marginBottom: 6 },
  submitBtn: {
    background: '#22c55e', color: 'white', border: 'none', borderRadius: 4,
    padding: '6px 12px', fontSize: 12, cursor: 'pointer', marginTop: 8,
  },

  agentPicker: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 8 },
  agentChip: {
    background: '#2d3748', border: 'none', borderRadius: 4, padding: '4px 8px',
    color: '#e5e5e5', fontSize: 11, cursor: 'pointer',
  },

  sequenceBuilder: { background: '#0d1117', borderRadius: 4, padding: 8, marginTop: 8 },
  sequenceItem: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
    borderBottom: '1px solid #222',
  },
  sequenceNumber: {
    background: '#3b82f6', color: 'white', borderRadius: '50%',
    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 'bold',
  },
  sequenceName: { color: '#e5e5e5', fontSize: 12, flex: 1 },
  sequenceActions: { display: 'flex', gap: 4 },

  sequencePreview: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginTop: 8 },
  sequenceLabel: { color: '#666', fontSize: 11 },
  sequenceNode: {
    background: '#3b82f6', color: 'white', padding: '4px 8px', borderRadius: 4,
    fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
  },
  removeChip: {
    background: 'transparent', border: 'none', color: 'white', cursor: 'pointer',
    fontSize: 12, padding: 0, marginLeft: 4,
  },
  arrow: { color: '#666', fontSize: 14 },

  templateList: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  templateCard: {
    background: '#1a1a1a', borderRadius: 6, padding: 10, border: '2px solid #333',
    cursor: 'pointer', transition: 'border-color 0.2s',
  },
  templateHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  templateName: { color: '#e5e5e5', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 },
  defaultBadge: {
    background: '#22c55e', color: 'white', padding: '2px 6px', borderRadius: 3,
    fontSize: 9, fontWeight: 600,
  },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#666', fontSize: 14, cursor: 'pointer',
  },
  templateDesc: { color: '#888', fontSize: 11, margin: '4px 0 8px' },

  flowPreview: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  flowNode: {
    background: '#2d3748', color: '#93c5fd', padding: '3px 8px', borderRadius: 4,
    fontSize: 10, fontWeight: 600,
  },
  flowArrow: { color: '#555', fontSize: 12 },
};
