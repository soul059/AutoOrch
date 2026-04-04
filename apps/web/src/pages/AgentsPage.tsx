import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { api } from '../services/api';

interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  agent_sequence: string[];
  is_default?: boolean;
}

export function AgentsPage() {
  const { agentRoles, providers, rolesLoading, fetchAgentRoles, fetchProviders, addToast } = useAppStore();
  const [activeTab, setActiveTab] = useState<'roles' | 'workflows'>('roles');
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [showEditWorkflowModal, setShowEditWorkflowModal] = useState(false);
  const [editWorkflow, setEditWorkflow] = useState<{
    id: string;
    name: string;
    description: string;
    agent_sequence: string[];
    dependencies: Record<string, string[]>;
    is_default: boolean;
  } | null>(null);
  const [newRole, setNewRole] = useState({
    name: '', 
    description: '', 
    system_prompt: '', 
    default_provider_id: '',
    tool_whitelist: [] as string[],
    routing_strategy: 'default' as 'default' | 'round-robin' | 'cost-optimized',
  });
  const [editRole, setEditRole] = useState<{
    id: string;
    name: string;
    description: string;
    system_prompt: string;
    default_provider_id: string;
    tool_whitelist: string[];
    routing_strategy: 'default' | 'round-robin' | 'cost-optimized';
  } | null>(null);
  const [newWorkflow, setNewWorkflow] = useState({ 
    name: '', 
    description: '', 
    agent_sequence: [] as string[],
    dependencies: {} as Record<string, string[]>,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAgentRoles();
    fetchProviders();
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      const data = await api.listWorkflowTemplates();
      setWorkflows(data || []);
    } catch (err: any) {
      console.error('Failed to load workflows:', err);
      addToast('error', 'Failed to load workflows', err.message);
    }
  };

  const handleCreateRole = async () => {
    if (!newRole.name.trim()) {
      addToast('warning', 'Name required', 'Please enter a role name');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.createAgentRole({
        ...newRole,
        tool_whitelist: newRole.tool_whitelist,
        routing_preferences: { strategy: newRole.routing_strategy },
      });
      setShowRoleModal(false);
      setNewRole({ name: '', description: '', system_prompt: '', default_provider_id: '', tool_whitelist: [], routing_strategy: 'default' });
      fetchAgentRoles();
      addToast('success', 'Role created', `Agent role "${newRole.name}" created successfully`);
    } catch (err: any) {
      addToast('error', 'Failed to create role', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (role: typeof agentRoles[0]) => {
    setEditRole({
      id: role.id,
      name: role.name,
      description: role.description || '',
      system_prompt: role.system_prompt || '',
      default_provider_id: role.default_provider_id || '',
      tool_whitelist: role.tool_whitelist || [],
      routing_strategy: (role.routing_preferences?.strategy as 'default' | 'round-robin' | 'cost-optimized') || 'default',
    });
    setShowEditModal(true);
  };

  const handleUpdateRole = async () => {
    if (!editRole) return;
    setIsSubmitting(true);
    try {
      await api.updateAgentRole(editRole.id, {
        name: editRole.name,
        description: editRole.description,
        system_prompt: editRole.system_prompt,
        default_provider_id: editRole.default_provider_id || null,
        tool_whitelist: editRole.tool_whitelist,
        routing_preferences: { strategy: editRole.routing_strategy },
      });
      setShowEditModal(false);
      setEditRole(null);
      fetchAgentRoles();
      addToast('success', 'Role updated', `Agent role "${editRole.name}" updated successfully`);
    } catch (err: any) {
      addToast('error', 'Failed to update role', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    if (!confirm(`Are you sure you want to delete "${roleName}"?`)) return;
    try {
      await api.deleteAgentRole(roleId);
      fetchAgentRoles();
      addToast('success', 'Role deleted', `Agent role "${roleName}" deleted`);
    } catch (err: any) {
      addToast('error', 'Failed to delete role', err.message);
    }
  };

  const handleCreateWorkflow = async () => {
    if (!newWorkflow.name.trim()) {
      addToast('warning', 'Name required', 'Please enter a workflow name');
      return;
    }
    if (newWorkflow.agent_sequence.length === 0) {
      addToast('warning', 'Agents required', 'Please add at least one agent to the workflow');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.createWorkflowTemplate({
        name: newWorkflow.name,
        description: newWorkflow.description,
        agent_sequence: newWorkflow.agent_sequence,
        dependencies: Object.keys(newWorkflow.dependencies).length > 0 ? newWorkflow.dependencies : undefined,
      });
      setShowWorkflowModal(false);
      setNewWorkflow({ name: '', description: '', agent_sequence: [], dependencies: {} });
      loadWorkflows();
      addToast('success', 'Workflow created', `Workflow "${newWorkflow.name}" created successfully`);
    } catch (err: any) {
      addToast('error', 'Failed to create workflow', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteWorkflow = async (id: string, name: string) => {
    if (!confirm(`Delete workflow "${name}"?`)) return;
    try {
      await api.deleteWorkflowTemplate(id);
      loadWorkflows();
      addToast('success', 'Workflow deleted', `Workflow "${name}" deleted`);
    } catch (err: any) {
      addToast('error', 'Failed to delete workflow', err.message);
    }
  };

  const openEditWorkflowModal = (wf: WorkflowTemplate) => {
    setEditWorkflow({
      id: wf.id,
      name: wf.name,
      description: wf.description || '',
      agent_sequence: wf.agent_sequence || [],
      dependencies: {},
      is_default: wf.is_default || false,
    });
    setShowEditWorkflowModal(true);
  };

  const handleUpdateWorkflow = async () => {
    if (!editWorkflow) return;
    if (!editWorkflow.name.trim()) {
      addToast('warning', 'Name required', 'Please enter a workflow name');
      return;
    }
    if (editWorkflow.agent_sequence.length === 0) {
      addToast('warning', 'Agents required', 'Please add at least one agent to the workflow');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.updateWorkflowTemplate(editWorkflow.id, {
        name: editWorkflow.name,
        description: editWorkflow.description,
        agent_sequence: editWorkflow.agent_sequence,
        dependencies: Object.keys(editWorkflow.dependencies).length > 0 ? editWorkflow.dependencies : undefined,
      });
      setShowEditWorkflowModal(false);
      setEditWorkflow(null);
      loadWorkflows();
      addToast('success', 'Workflow updated', `Workflow "${editWorkflow.name}" updated successfully`);
    } catch (err: any) {
      addToast('error', 'Failed to update workflow', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleAgentInEditWorkflow = (agentName: string) => {
    if (!editWorkflow) return;
    setEditWorkflow(prev => prev ? {
      ...prev,
      agent_sequence: prev.agent_sequence.includes(agentName)
        ? prev.agent_sequence.filter(a => a !== agentName)
        : [...prev.agent_sequence, agentName]
    } : null);
  };

  const handleSetDefaultWorkflow = async (id: string) => {
    try {
      await api.updateWorkflowTemplate(id, { is_default: true });
      loadWorkflows();
      addToast('success', 'Default changed', 'Workflow set as default');
    } catch (err: any) {
      addToast('error', 'Failed to set default', err.message);
    }
  };

  const handleUpdateRoleProvider = async (roleId: string, providerId: string) => {
    try {
      await api.updateAgentRole(roleId, { default_provider_id: providerId || null });
      fetchAgentRoles();
      addToast('success', 'Provider updated', 'Default provider changed successfully');
    } catch (err: any) {
      addToast('error', 'Failed to update provider', err.message);
    }
  };

  const toggleAgentInWorkflow = (agentName: string) => {
    setNewWorkflow(prev => ({
      ...prev,
      agent_sequence: prev.agent_sequence.includes(agentName)
        ? prev.agent_sequence.filter(a => a !== agentName)
        : [...prev.agent_sequence, agentName]
    }));
  };

  return (
    <div className="agents-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-subtitle">Configure agent roles and workflow templates</p>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={() => activeTab === 'roles' ? setShowRoleModal(true) : setShowWorkflowModal(true)}
        >
          + New {activeTab === 'roles' ? 'Role' : 'Workflow'}
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'roles' ? 'active' : ''}`}
          onClick={() => setActiveTab('roles')}
        >
          🤖 Agent Roles ({agentRoles.length})
        </button>
        <button 
          className={`tab ${activeTab === 'workflows' ? 'active' : ''}`}
          onClick={() => setActiveTab('workflows')}
        >
          🔄 Workflows ({workflows.length})
        </button>
      </div>

      {/* Agent Roles Tab */}
      {activeTab === 'roles' && (
        <div className="grid grid-2">
          {rolesLoading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : agentRoles.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">🤖</div>
                <p className="empty-state-title">No agent roles</p>
                <p className="empty-state-text">Create your first agent role to get started</p>
              </div>
            </div>
          ) : (
            agentRoles.map(role => (
              <div key={role.id} className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <span style={{ fontSize: 20, marginRight: 8 }}>{getRoleIcon(role.name)}</span>
                    {role.name}
                  </h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button 
                      className="btn btn-icon btn-secondary"
                      onClick={() => openEditModal(role)}
                      title="Edit role"
                    >✏️</button>
                    <button 
                      className="btn btn-icon btn-secondary"
                      onClick={() => handleDeleteRole(role.id, role.name)}
                      title="Delete role"
                    >✕</button>
                  </div>
                </div>
                {role.description && (
                  <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>{role.description}</p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', color: '#666', fontSize: 12, marginBottom: 4 }}>
                      Default Provider
                    </label>
                    <select
                      className="select"
                      value={role.default_provider_id || ''}
                      onChange={e => handleUpdateRoleProvider(role.id, e.target.value)}
                    >
                      <option value="">Auto-select</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>
                      ))}
                    </select>
                  </div>
                  {role.tool_whitelist && role.tool_whitelist.length > 0 && (
                    <div>
                      <label style={{ display: 'block', color: '#666', fontSize: 12, marginBottom: 4 }}>
                        System Tools
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {role.tool_whitelist.map((tool: string) => {
                          const toolInfo = AVAILABLE_TOOLS.find(t => t.name === tool);
                          return (
                            <span key={tool} className="badge badge-info" style={{ fontSize: 11 }}>
                              {toolInfo?.icon || '🔧'} {toolInfo?.label || tool}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {role.budget_limit != null && (
                    <div style={{ color: '#666', fontSize: 12 }}>
                      Budget: ${Number(role.budget_limit).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          
          {/* Quick Presets */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">⚡ Quick Presets</h3>
            </div>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
              Click to pre-fill a new agent role with common configurations
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ROLE_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setNewRole(preset);
                    setShowRoleModal(true);
                  }}
                >
                  {getRoleIcon(preset.name)} {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Workflows Tab */}
      {activeTab === 'workflows' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {workflows.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">🔄</div>
                <p className="empty-state-title">No workflows</p>
                <p className="empty-state-text">Create a workflow to chain multiple agents together</p>
              </div>
            </div>
          ) : (
            workflows.map(wf => (
              <div key={wf.id} className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    {wf.name}
                    {wf.is_default && <span className="badge badge-success" style={{ marginLeft: 8 }}>Default</span>}
                  </h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!wf.is_default && (
                      <button 
                        className="btn btn-icon btn-secondary"
                        onClick={() => handleSetDefaultWorkflow(wf.id)}
                        title="Set as default"
                      >⭐</button>
                    )}
                    <button 
                      className="btn btn-icon btn-secondary"
                      onClick={() => openEditWorkflowModal(wf)}
                      title="Edit workflow"
                    >✏️</button>
                    {!wf.is_default && (
                      <button 
                        className="btn btn-icon btn-secondary"
                        onClick={() => handleDeleteWorkflow(wf.id, wf.name)}
                        title="Delete workflow"
                      >✕</button>
                    )}
                  </div>
                </div>
                {wf.description && (
                  <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>{wf.description}</p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {wf.agent_sequence.map((agent, i) => (
                    <React.Fragment key={i}>
                      <div style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <span>{getRoleIcon(agent)}</span>
                        <span style={{ color: '#fff', fontWeight: 500 }}>{agent}</span>
                      </div>
                      {i < wf.agent_sequence.length - 1 && (
                        <span style={{ color: '#444', fontSize: 20 }}>→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* New Role Modal */}
      {showRoleModal && (
        <Modal title="New Agent Role" onClose={() => setShowRoleModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Role Name</label>
              <input
                className="input"
                value={newRole.name}
                onChange={e => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="e.g., PLANNER, BUILDER, REVIEWER"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Description</label>
              <input
                className="input"
                value={newRole.description}
                onChange={e => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="What does this agent do?"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>System Prompt</label>
              <textarea
                className="textarea"
                value={newRole.system_prompt}
                onChange={e => setNewRole({ ...newRole, system_prompt: e.target.value })}
                placeholder="Instructions for the AI agent..."
                rows={4}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Default Provider</label>
              <select
                className="select"
                value={newRole.default_provider_id}
                onChange={e => setNewRole({ ...newRole, default_provider_id: e.target.value })}
              >
                <option value="">Auto-select</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>
                System Tools (MCP)
              </label>
              <p style={{ color: '#666', fontSize: 11, marginBottom: 8 }}>
                Enable tools this agent can use to interact with the system
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {AVAILABLE_TOOLS.map(tool => (
                  <label key={tool.name} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 10,
                    padding: '8px 12px',
                    background: newRole.tool_whitelist.includes(tool.name) ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: newRole.tool_whitelist.includes(tool.name) ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}>
                    <input
                      type="checkbox"
                      checked={newRole.tool_whitelist.includes(tool.name)}
                      onChange={e => {
                        if (e.target.checked) {
                          setNewRole({ ...newRole, tool_whitelist: [...newRole.tool_whitelist, tool.name] });
                        } else {
                          setNewRole({ ...newRole, tool_whitelist: newRole.tool_whitelist.filter(t => t !== tool.name) });
                        }
                      }}
                      style={{ width: 16, height: 16, accentColor: '#3b82f6' }}
                    />
                    <div>
                      <div style={{ fontWeight: 500, color: '#fff', fontSize: 13 }}>
                        {tool.icon} {tool.label}
                      </div>
                      <div style={{ color: '#888', fontSize: 11 }}>{tool.description}</div>
                    </div>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  const allTools = AVAILABLE_TOOLS.map(t => t.name);
                  const hasAll = allTools.every(t => newRole.tool_whitelist.includes(t));
                  setNewRole({ ...newRole, tool_whitelist: hasAll ? [] : allTools });
                }}
              >
                {AVAILABLE_TOOLS.every(t => newRole.tool_whitelist.includes(t.name)) ? 'Deselect All' : 'Select All Tools'}
              </button>
            </div>
            
            {/* Routing Strategy */}
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>
                Routing Strategy
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { value: 'default', label: '⚡ Default', desc: 'Use configured default provider' },
                  { value: 'round-robin', label: '🔄 Round Robin', desc: 'Distribute across available providers' },
                  { value: 'cost-optimized', label: '💰 Cost Optimized', desc: 'Prefer cheaper providers first' },
                ].map(strategy => (
                  <label
                    key={strategy.value}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 4,
                      padding: 12, background: newRole.routing_strategy === strategy.value ? '#1e3a5f' : '#1a1a2e',
                      border: newRole.routing_strategy === strategy.value ? '2px solid #3b82f6' : '1px solid #2a2a3e',
                      borderRadius: 8, cursor: 'pointer', flex: '1 1 120px'
                    }}
                  >
                    <input
                      type="radio"
                      name="routing_strategy"
                      value={strategy.value}
                      checked={newRole.routing_strategy === strategy.value}
                      onChange={(e) => setNewRole({ ...newRole, routing_strategy: e.target.value as 'default' | 'round-robin' | 'cost-optimized' })}
                      style={{ display: 'none' }}
                    />
                    <span style={{ color: '#fff', fontSize: 13 }}>{strategy.label}</span>
                    <span style={{ color: '#666', fontSize: 11 }}>{strategy.desc}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <button className="btn btn-primary" onClick={handleCreateRole} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Role'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Role Modal */}
      {showEditModal && editRole && (
        <Modal title="Edit Agent Role" onClose={() => { setShowEditModal(false); setEditRole(null); }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Role Name</label>
              <input
                className="input"
                value={editRole.name}
                onChange={e => setEditRole({ ...editRole, name: e.target.value })}
                placeholder="e.g., PLANNER, BUILDER"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Description</label>
              <input
                className="input"
                value={editRole.description}
                onChange={e => setEditRole({ ...editRole, description: e.target.value })}
                placeholder="What does this agent do?"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>System Prompt</label>
              <textarea
                className="input"
                style={{ minHeight: 100, resize: 'vertical' }}
                value={editRole.system_prompt}
                onChange={e => setEditRole({ ...editRole, system_prompt: e.target.value })}
                placeholder="Instructions for the AI agent..."
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Default Provider</label>
              <select
                className="select"
                value={editRole.default_provider_id}
                onChange={e => setEditRole({ ...editRole, default_provider_id: e.target.value })}
              >
                <option value="">Auto-select best available</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>
                ))}
              </select>
            </div>
            
            {/* Tool Whitelist */}
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>
                System Tools (MCP)
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {AVAILABLE_TOOLS.map(tool => (
                  <label
                    key={tool.name}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: 10, background: editRole.tool_whitelist.includes(tool.name) ? '#1e3a5f' : '#1a1a2e',
                      border: editRole.tool_whitelist.includes(tool.name) ? '2px solid #3b82f6' : '1px solid #2a2a3e',
                      borderRadius: 8, cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={editRole.tool_whitelist.includes(tool.name)}
                      onChange={(e) => {
                        const newTools = e.target.checked 
                          ? [...editRole.tool_whitelist, tool.name]
                          : editRole.tool_whitelist.filter(t => t !== tool.name);
                        setEditRole({ ...editRole, tool_whitelist: newTools });
                      }}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ color: '#fff', fontSize: 13 }}>
                        <span style={{ marginRight: 6 }}>{tool.icon}</span>
                        {tool.label}
                      </div>
                      <div style={{ color: '#888', fontSize: 11 }}>{tool.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            
            {/* Routing Strategy */}
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>
                Routing Strategy
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { value: 'default', label: '⚡ Default', desc: 'Use configured default provider' },
                  { value: 'round-robin', label: '🔄 Round Robin', desc: 'Distribute across available providers' },
                  { value: 'cost-optimized', label: '💰 Cost Optimized', desc: 'Prefer cheaper providers first' },
                ].map(strategy => (
                  <label
                    key={strategy.value}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 4,
                      padding: 12, background: editRole.routing_strategy === strategy.value ? '#1e3a5f' : '#1a1a2e',
                      border: editRole.routing_strategy === strategy.value ? '2px solid #3b82f6' : '1px solid #2a2a3e',
                      borderRadius: 8, cursor: 'pointer', flex: '1 1 120px'
                    }}
                  >
                    <input
                      type="radio"
                      name="edit_routing_strategy"
                      value={strategy.value}
                      checked={editRole.routing_strategy === strategy.value}
                      onChange={(e) => setEditRole({ ...editRole, routing_strategy: e.target.value as 'default' | 'round-robin' | 'cost-optimized' })}
                      style={{ display: 'none' }}
                    />
                    <span style={{ color: '#fff', fontSize: 13 }}>{strategy.label}</span>
                    <span style={{ color: '#666', fontSize: 11 }}>{strategy.desc}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <button className="btn btn-primary" onClick={handleUpdateRole} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* New Workflow Modal */}
      {showWorkflowModal && (
        <Modal title="New Workflow" onClose={() => setShowWorkflowModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Workflow Name</label>
              <input
                className="input"
                value={newWorkflow.name}
                onChange={e => setNewWorkflow({ ...newWorkflow, name: e.target.value })}
                placeholder="e.g., Full Pipeline, Quick Review"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Description</label>
              <input
                className="input"
                value={newWorkflow.description}
                onChange={e => setNewWorkflow({ ...newWorkflow, description: e.target.value })}
                placeholder="What is this workflow for?"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Select Agents (in order)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {agentRoles.map(role => (
                  <button
                    key={role.id}
                    className={`btn btn-sm ${newWorkflow.agent_sequence.includes(role.name) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => toggleAgentInWorkflow(role.name)}
                  >
                    {getRoleIcon(role.name)} {role.name}
                    {newWorkflow.agent_sequence.includes(role.name) && (
                      <span style={{ marginLeft: 4 }}>
                        ({newWorkflow.agent_sequence.indexOf(role.name) + 1})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {newWorkflow.agent_sequence.length > 0 && (
              <div style={{ 
                padding: 12, background: '#0a0a0f', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'
              }}>
                <span style={{ color: '#666', fontSize: 12 }}>Flow:</span>
                {newWorkflow.agent_sequence.map((agent, i) => (
                  <React.Fragment key={i}>
                    <span style={{ color: '#fff' }}>{agent}</span>
                    {i < newWorkflow.agent_sequence.length - 1 && <span style={{ color: '#444' }}>→</span>}
                  </React.Fragment>
                ))}
              </div>
            )}
            
            {/* Dependencies Editor */}
            {newWorkflow.agent_sequence.length > 1 && (
              <div>
                <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>
                  Dependencies (optional)
                </label>
                <p style={{ color: '#555', fontSize: 11, marginBottom: 12 }}>
                  Select which agents must complete before another can start
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {newWorkflow.agent_sequence.slice(1).map((agent, i) => {
                    const agentIndex = i + 1;
                    const possibleDeps = newWorkflow.agent_sequence.slice(0, agentIndex);
                    const currentDeps = newWorkflow.dependencies[agent] || [];
                    
                    return (
                      <div key={agent} style={{ 
                        padding: 10, background: '#1a1a2e', borderRadius: 6,
                        border: '1px solid #2a2a3e'
                      }}>
                        <div style={{ color: '#fff', fontSize: 13, marginBottom: 6 }}>
                          {getRoleIcon(agent)} {agent} depends on:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {possibleDeps.map(dep => (
                            <label key={dep} style={{ 
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 8px', background: currentDeps.includes(dep) ? '#3b82f6' : '#2a2a3e',
                              borderRadius: 4, cursor: 'pointer', fontSize: 12
                            }}>
                              <input
                                type="checkbox"
                                checked={currentDeps.includes(dep)}
                                onChange={(e) => {
                                  const newDeps = e.target.checked 
                                    ? [...currentDeps, dep]
                                    : currentDeps.filter(d => d !== dep);
                                  setNewWorkflow({
                                    ...newWorkflow,
                                    dependencies: {
                                      ...newWorkflow.dependencies,
                                      [agent]: newDeps
                                    }
                                  });
                                }}
                                style={{ display: 'none' }}
                              />
                              <span style={{ color: currentDeps.includes(dep) ? '#fff' : '#888' }}>
                                {getRoleIcon(dep)} {dep}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            <button className="btn btn-primary" onClick={handleCreateWorkflow} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Workflow'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Workflow Modal */}
      {showEditWorkflowModal && editWorkflow && (
        <Modal title="Edit Workflow" onClose={() => { setShowEditWorkflowModal(false); setEditWorkflow(null); }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Workflow Name</label>
              <input
                className="input"
                value={editWorkflow.name}
                onChange={e => setEditWorkflow({ ...editWorkflow, name: e.target.value })}
                placeholder="e.g., Full Pipeline, Quick Review"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Description</label>
              <input
                className="input"
                value={editWorkflow.description}
                onChange={e => setEditWorkflow({ ...editWorkflow, description: e.target.value })}
                placeholder="What is this workflow for?"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Select Agents (in order)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {agentRoles.map(role => (
                  <button
                    key={role.id}
                    className={`btn btn-sm ${editWorkflow.agent_sequence.includes(role.name) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => toggleAgentInEditWorkflow(role.name)}
                  >
                    {getRoleIcon(role.name)} {role.name}
                    {editWorkflow.agent_sequence.includes(role.name) && (
                      <span style={{ marginLeft: 4 }}>
                        ({editWorkflow.agent_sequence.indexOf(role.name) + 1})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {editWorkflow.agent_sequence.length > 0 && (
              <div style={{ 
                padding: 12, background: '#0a0a0f', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'
              }}>
                <span style={{ color: '#666', fontSize: 12 }}>Flow:</span>
                {editWorkflow.agent_sequence.map((agent, i) => (
                  <React.Fragment key={i}>
                    <span style={{ color: '#fff' }}>{agent}</span>
                    {i < editWorkflow.agent_sequence.length - 1 && <span style={{ color: '#444' }}>→</span>}
                  </React.Fragment>
                ))}
              </div>
            )}
            
            {/* Reorder agents */}
            {editWorkflow.agent_sequence.length > 1 && (
              <div>
                <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>
                  Reorder Agents
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {editWorkflow.agent_sequence.map((agent, i) => (
                    <div key={agent} style={{ 
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', background: '#1a1a2e', borderRadius: 6,
                      border: '1px solid #2a2a3e'
                    }}>
                      <span style={{ color: '#3b82f6', fontWeight: 600, width: 24 }}>{i + 1}</span>
                      <span style={{ color: '#fff', flex: 1 }}>{getRoleIcon(agent)} {agent}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-icon btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          disabled={i === 0}
                          onClick={() => {
                            const newSeq = [...editWorkflow.agent_sequence];
                            [newSeq[i], newSeq[i - 1]] = [newSeq[i - 1], newSeq[i]];
                            setEditWorkflow({ ...editWorkflow, agent_sequence: newSeq });
                          }}
                        >↑</button>
                        <button
                          className="btn btn-icon btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          disabled={i === editWorkflow.agent_sequence.length - 1}
                          onClick={() => {
                            const newSeq = [...editWorkflow.agent_sequence];
                            [newSeq[i], newSeq[i + 1]] = [newSeq[i + 1], newSeq[i]];
                            setEditWorkflow({ ...editWorkflow, agent_sequence: newSeq });
                          }}
                        >↓</button>
                        <button
                          className="btn btn-icon btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 12, color: '#f87171' }}
                          onClick={() => {
                            setEditWorkflow({
                              ...editWorkflow,
                              agent_sequence: editWorkflow.agent_sequence.filter((_, idx) => idx !== i)
                            });
                          }}
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <button className="btn btn-primary" onClick={handleUpdateWorkflow} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      padding: '20px',
    }} onClick={onClose}>
      <div 
        className="card" 
        style={{ 
          width: 500, 
          maxWidth: '90vw', 
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div className="card-header" style={{ flexShrink: 0 }}>
          <h3 className="card-title">{title}</h3>
          <button className="btn btn-icon btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function getRoleIcon(name: string): string {
  const icons: Record<string, string> = {
    PLANNER: '📋', RESEARCHER: '🔍', BUILDER: '🔧', CODER: '💻',
    REVIEWER: '👁️', OPERATIONS: '⚙️', EXECUTOR: '⚡',
  };
  return icons[name.toUpperCase()] || '🤖';
}

const AVAILABLE_TOOLS = [
  { name: 'file_write', label: 'File Write', icon: '📝', description: 'Write files to the sandboxed workspace' },
  { name: 'file_read', label: 'File Read', icon: '📖', description: 'Read files from the workspace' },
  { name: 'bash_exec', label: 'Command Execution', icon: '⚡', description: 'Execute whitelisted bash commands (npm, node, python, etc.)' },
  { name: 'web_search', label: 'Web Search', icon: '🔍', description: 'Search the web using DuckDuckGo' },
];

const ROLE_PRESETS = [
  { name: 'PLANNER', description: 'Breaks down tasks into actionable steps', system_prompt: 'You are a strategic planner. Analyze requests and create structured task plans.', default_provider_id: '', tool_whitelist: [] as string[], routing_strategy: 'default' as const },
  { name: 'BUILDER', description: 'Executes the main work with tool access', system_prompt: 'You are an expert builder. Complete the assigned tasks with high quality output. You can write files, execute commands, and create working code.', default_provider_id: '', tool_whitelist: ['file_write', 'file_read', 'bash_exec'], routing_strategy: 'default' as const },
  { name: 'REVIEWER', description: 'Reviews and validates output', system_prompt: 'You are a quality reviewer. Check work for errors and suggest improvements.', default_provider_id: '', tool_whitelist: ['file_read'], routing_strategy: 'default' as const },
  { name: 'RESEARCHER', description: 'Gathers information from the web', system_prompt: 'You are a researcher. Find relevant information to support the task using web search.', default_provider_id: '', tool_whitelist: ['web_search'], routing_strategy: 'default' as const },
];
