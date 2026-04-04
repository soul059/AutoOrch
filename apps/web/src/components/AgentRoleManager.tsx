import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface AgentRole {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  default_provider_id: string | null;
  tool_whitelist: string[];
  max_tokens_per_request: number;
  budget_limit: number;
}

interface Provider {
  id: string;
  name: string;
  type: string;
  model_name: string;
}

interface Props {
  refreshTrigger?: number;
}

export function AgentRoleManager({ refreshTrigger }: Props) {
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // New role form state
  const [newRole, setNewRole] = useState({
    name: '',
    description: '',
    system_prompt: '',
    default_provider_id: '',
    max_tokens_per_request: 4096,
    budget_limit: 10.00,
    tool_whitelist: [] as string[],
  });

  // Available tools
  const availableTools = [
    { id: 'file_write', name: 'File Write', description: 'Create and write files' },
    { id: 'file_read', name: 'File Read', description: 'Read file contents' },
    { id: 'bash_exec', name: 'Bash Execute', description: 'Run shell commands' },
    { id: 'web_search', name: 'Web Search', description: 'Search the internet' },
  ];

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rolesData, providersData] = await Promise.all([
        api.listAgentRoles(),
        api.listProviders(),
      ]);
      setRoles(rolesData);
      setProviders(providersData);
    } catch (err) {
      console.error('Failed to load agent roles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAgentRole(newRole);
      setShowCreateForm(false);
      setNewRole({
        name: '',
        description: '',
        system_prompt: '',
        default_provider_id: '',
        max_tokens_per_request: 4096,
        budget_limit: 10.00,
        tool_whitelist: [],
      });
      loadData();
    } catch (err: any) {
      alert('Failed to create role: ' + err.message);
    }
  };

  const handleUpdateProvider = async (roleId: string, providerId: string) => {
    try {
      await api.updateAgentRole(roleId, { default_provider_id: providerId || null });
      loadData();
    } catch (err: any) {
      alert('Failed to update provider: ' + err.message);
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    if (!confirm('Delete this agent role?')) return;
    try {
      await api.deleteAgentRole(roleId);
      loadData();
    } catch (err: any) {
      alert('Failed to delete role: ' + err.message);
    }
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading agent roles...</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Agent Roles</h2>
        <button style={styles.addBtn} onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? '✕ Cancel' : '+ Add Role'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateRole} style={styles.form}>
          <input
            type="text"
            placeholder="Role name (e.g., Planner, Coder, Reviewer)"
            value={newRole.name}
            onChange={e => setNewRole({ ...newRole, name: e.target.value })}
            style={styles.input}
            required
          />
          <input
            type="text"
            placeholder="Description"
            value={newRole.description}
            onChange={e => setNewRole({ ...newRole, description: e.target.value })}
            style={styles.input}
          />
          <textarea
            placeholder="System prompt for this agent..."
            value={newRole.system_prompt}
            onChange={e => setNewRole({ ...newRole, system_prompt: e.target.value })}
            style={styles.textarea}
            rows={3}
          />
          
          {/* Tool Selection */}
          <div style={styles.toolSection}>
            <label style={styles.toolLabel}>Tools this agent can use:</label>
            <div style={styles.toolGrid}>
              {availableTools.map(tool => (
                <label key={tool.id} style={styles.toolCheckbox}>
                  <input
                    type="checkbox"
                    checked={newRole.tool_whitelist.includes(tool.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setNewRole({ ...newRole, tool_whitelist: [...newRole.tool_whitelist, tool.id] });
                      } else {
                        setNewRole({ ...newRole, tool_whitelist: newRole.tool_whitelist.filter(t => t !== tool.id) });
                      }
                    }}
                  />
                  <span style={styles.toolName}>{tool.name}</span>
                  <span style={styles.toolDesc}>{tool.description}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={styles.row}>
            <select
              value={newRole.default_provider_id}
              onChange={e => setNewRole({ ...newRole, default_provider_id: e.target.value })}
              style={styles.select}
            >
              <option value="">Select default provider...</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Budget limit ($)"
              value={newRole.budget_limit}
              onChange={e => setNewRole({ ...newRole, budget_limit: parseFloat(e.target.value) || 0 })}
              style={{ ...styles.input, width: 120 }}
              step="0.01"
              min="0"
            />
          </div>
          <button type="submit" style={styles.submitBtn}>Create Role</button>
        </form>
      )}

      {roles.length === 0 ? (
        <p style={styles.empty}>
          No agent roles configured. Create roles to define how agents behave (Planner, Coder, Reviewer, etc.).
        </p>
      ) : (
        <div style={styles.roleList}>
          {roles.map(role => (
            <div key={role.id} style={styles.roleCard}>
              <div style={styles.roleHeader}>
                <span style={styles.roleName}>{role.name}</span>
                <button
                  style={styles.deleteBtn}
                  onClick={() => handleDeleteRole(role.id)}
                  title="Delete role"
                >✕</button>
              </div>
              
              {role.description && (
                <p style={styles.roleDesc}>{role.description}</p>
              )}

              <div style={styles.providerRow}>
                <label style={styles.label}>Provider:</label>
                <select
                  value={role.default_provider_id || ''}
                  onChange={e => handleUpdateProvider(role.id, e.target.value)}
                  style={styles.providerSelect}
                >
                  <option value="">Auto-select</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div style={styles.metaRow}>
                <span style={styles.meta}>
                  Budget: ${role.budget_limit?.toFixed(2) || '∞'}
                </span>
                <span style={styles.meta}>
                  Max tokens: {role.max_tokens_per_request || 'default'}
                </span>
              </div>

              {role.tool_whitelist && role.tool_whitelist.length > 0 && (
                <div style={styles.tools}>
                  {role.tool_whitelist.map(tool => (
                    <span key={tool} style={styles.toolBadge}>{tool}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={styles.presets}>
        <p style={styles.presetsTitle}>Quick Presets:</p>
        <div style={styles.presetBtns}>
          <button
            style={styles.presetBtn}
            onClick={() => {
              setNewRole({
                name: 'Planner',
                description: 'Breaks down user prompts into actionable task plans',
                system_prompt: 'You are a strategic planner. Analyze the user request and break it into specific, actionable tasks. Output a structured JSON plan.',
                default_provider_id: '',
                max_tokens_per_request: 8192,
                budget_limit: 5.00,
                tool_whitelist: [],
              });
              setShowCreateForm(true);
            }}
          >📋 Planner</button>
          <button
            style={styles.presetBtn}
            onClick={() => {
              setNewRole({
                name: 'Coder',
                description: 'Writes and modifies code based on task specifications',
                system_prompt: 'You are an expert software engineer. Write clean, well-documented code. Use file_write to create files.',
                default_provider_id: '',
                max_tokens_per_request: 16384,
                budget_limit: 20.00,
                tool_whitelist: ['file_write', 'file_read'],
              });
              setShowCreateForm(true);
            }}
          >💻 Coder</button>
          <button
            style={styles.presetBtn}
            onClick={() => {
              setNewRole({
                name: 'Reviewer',
                description: 'Reviews code and task outputs for quality',
                system_prompt: 'You are a code reviewer. Check for bugs, security issues, and improvements. Use file_read to inspect code.',
                default_provider_id: '',
                max_tokens_per_request: 4096,
                budget_limit: 3.00,
                tool_whitelist: ['file_read'],
              });
              setShowCreateForm(true);
            }}
          >🔍 Reviewer</button>
          <button
            style={styles.presetBtn}
            onClick={() => {
              setNewRole({
                name: 'Executor',
                description: 'Executes tools and commands safely',
                system_prompt: 'You are a task executor. Run the specified tools and commands. Report results clearly and handle errors gracefully.',
                default_provider_id: '',
                max_tokens_per_request: 2048,
                budget_limit: 1.00,
                tool_whitelist: ['bash_exec', 'file_read', 'file_write'],
              });
              setShowCreateForm(true);
            }}
          >⚡ Executor</button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 20, marginBottom: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, color: '#e5e5e5', margin: 0 },
  addBtn: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 4,
    padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  },
  loading: { color: '#666', fontSize: 14 },
  empty: { color: '#666', fontSize: 14, textAlign: 'center' as const, padding: '20px 0' },
  
  form: { background: '#1a1a1a', borderRadius: 6, padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column' as const, gap: 10 },
  input: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '8px 12px',
    color: '#e5e5e5', fontSize: 13, width: '100%', boxSizing: 'border-box' as const,
  },
  textarea: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '8px 12px',
    color: '#e5e5e5', fontSize: 13, resize: 'vertical' as const, fontFamily: 'inherit',
  },
  select: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '8px 12px',
    color: '#e5e5e5', fontSize: 13, flex: 1,
  },
  row: { display: 'flex', gap: 10 },
  submitBtn: {
    background: '#22c55e', color: 'white', border: 'none', borderRadius: 4,
    padding: '8px 16px', fontSize: 13, cursor: 'pointer', alignSelf: 'flex-start' as const,
  },

  roleList: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  roleCard: { background: '#1a1a1a', borderRadius: 6, padding: 14, border: '1px solid #222' },
  roleHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  roleName: { color: '#e5e5e5', fontSize: 15, fontWeight: 600 },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#666', fontSize: 14, cursor: 'pointer',
    padding: '2px 6px', borderRadius: 4,
  },
  roleDesc: { color: '#888', fontSize: 12, marginBottom: 10 },
  
  providerRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { color: '#888', fontSize: 12 },
  providerSelect: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '4px 8px',
    color: '#e5e5e5', fontSize: 12, flex: 1,
  },
  
  metaRow: { display: 'flex', gap: 16, marginBottom: 8 },
  meta: { color: '#666', fontSize: 11 },
  
  tools: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  toolBadge: {
    background: '#1e3a5f', color: '#93c5fd', padding: '2px 6px',
    borderRadius: 3, fontSize: 10, fontWeight: 600,
  },

  // Tool selection in form
  toolSection: { marginTop: 4 },
  toolLabel: { color: '#888', fontSize: 12, display: 'block', marginBottom: 8 },
  toolGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 },
  toolCheckbox: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
    background: '#222', borderRadius: 4, border: '1px solid #333', cursor: 'pointer',
  },
  toolName: { color: '#e5e5e5', fontSize: 12, fontWeight: 600 },
  toolDesc: { color: '#666', fontSize: 10, marginLeft: 'auto' },

  presets: { borderTop: '1px solid #222', marginTop: 16, paddingTop: 12 },
  presetsTitle: { color: '#666', fontSize: 12, marginBottom: 8 },
  presetBtns: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  presetBtn: {
    background: '#222', border: '1px solid #333', borderRadius: 4,
    padding: '6px 10px', fontSize: 12, color: '#aaa', cursor: 'pointer',
  },
};
