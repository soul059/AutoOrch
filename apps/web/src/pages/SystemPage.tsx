import React, { useEffect, useState } from 'react';
import { useAppStore, ProviderHealthStatus } from '../stores/useAppStore';
import { api } from '../services/api';

interface HealthData {
  status: string;
  uptime: number;
  checks: {
    database: { status: string; latencyMs: number };
  };
  metrics: Record<string, number>;
}

interface DeadLetterItem {
  id: string;
  task_id: string;
  run_id: string;
  error_message: string;
  failed_at: string;
  task_name?: string;
}

interface BudgetReportItem {
  runId: string;
  prompt?: string;
  state: string;
  budget?: { maxTokens?: number; maxCostUsd?: number };
  usage: { tokens: number; costUsd: number; iterations: number };
  tokenUtilization: string;
  costUtilization: string;
}

export function SystemPage() {
  const { providers, wsConnected, addToast } = useAppStore();
  const [activeTab, setActiveTab] = useState<'health' | 'budget' | 'failures' | 'sandbox'>('health');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetterItem[]>([]);
  const [budgetReport, setBudgetReport] = useState<BudgetReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingHealth, setCheckingHealth] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [healthData, letters, budget] = await Promise.all([
        api.getHealthMetrics().catch(() => null),
        api.getDeadLetters().catch(() => []),
        api.getBudgetReport().catch(() => []),
      ]);
      setHealth(healthData);
      setDeadLetters(Array.isArray(letters) ? letters : []);
      setBudgetReport(Array.isArray(budget) ? budget : []);
    } catch (err: any) {
      console.error('Failed to load system data:', err);
      addToast('error', 'Failed to load system data', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckHealth = async () => {
    setCheckingHealth(true);
    try {
      await api.runHealthChecks();
      await loadData();
      addToast('success', 'Health check complete', 'Provider status updated');
    } catch (err: any) {
      addToast('error', 'Health check failed', err.message);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleRetryDeadLetter = async (id: string) => {
    try {
      await api.retryDeadLetter(id);
      loadData();
      addToast('success', 'Task queued for retry', 'The task will be executed again');
    } catch (err: any) {
      addToast('error', 'Failed to retry', err.message);
    }
  };

  const handleDiscardDeadLetter = async (id: string) => {
    if (!confirm('Discard this failed task?')) return;
    try {
      await api.discardDeadLetter(id);
      loadData();
      addToast('info', 'Task discarded', 'The failed task has been removed');
    } catch (err: any) {
      addToast('error', 'Failed to discard', err.message);
    }
  };

  const healthyProviders = providers.filter(p => p.health_status?.isHealthy).length;
  const unhealthyProviders = providers.filter(p => !p.health_status?.isHealthy).length;

  return (
    <div className="system-page">
      <div className="page-header">
        <h1 className="page-title">System</h1>
        <p className="page-subtitle">Monitor health, budget, and failures</p>
      </div>

      {/* Quick Status Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: wsConnected ? '#22c55e' : '#ef4444' }}>
            {wsConnected ? '●' : '○'} {wsConnected ? 'Connected' : 'Disconnected'}
          </div>
          <div className="stat-label">WebSocket</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{healthyProviders}</div>
          <div className="stat-label">Healthy Providers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: unhealthyProviders > 0 ? '#f59e0b' : '#22c55e' }}>
            {unhealthyProviders}
          </div>
          <div className="stat-label">Unhealthy Providers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: deadLetters.length > 0 ? '#ef4444' : '#22c55e' }}>
            {deadLetters.length}
          </div>
          <div className="stat-label">Failed Tasks</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'health' ? 'active' : ''}`}
          onClick={() => setActiveTab('health')}
        >
          🏥 System Health
        </button>
        <button 
          className={`tab ${activeTab === 'budget' ? 'active' : ''}`}
          onClick={() => setActiveTab('budget')}
        >
          💰 Budget Report
        </button>
        <button 
          className={`tab ${activeTab === 'failures' ? 'active' : ''}`}
          onClick={() => setActiveTab('failures')}
        >
          ⚠️ Dead Letters ({deadLetters.length})
        </button>
        <button 
          className={`tab ${activeTab === 'sandbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('sandbox')}
        >
          🔒 Sandbox Mode
        </button>
      </div>

      {loading && (
        <div className="loading"><div className="spinner"></div></div>
      )}

      {/* Health Tab */}
      {!loading && activeTab === 'health' && (
        <div className="grid grid-2">
          {/* API Server */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🌐 API Server</h3>
              <span className={`badge ${health?.status === 'healthy' ? 'badge-success' : 'badge-danger'}`}>
                {health?.status || 'unknown'}
              </span>
            </div>
            <div style={{ color: '#888', fontSize: 13 }}>
              Uptime: {Math.floor((health?.uptime ?? 0) / 3600)}h {Math.floor(((health?.uptime ?? 0) % 3600) / 60)}m
            </div>
          </div>

          {/* Database */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🗄️ Database</h3>
              <span className={`badge ${health?.checks?.database?.status === 'healthy' ? 'badge-success' : 'badge-danger'}`}>
                {health?.checks?.database?.status || 'unknown'}
              </span>
            </div>
            <div style={{ color: '#888', fontSize: 13 }}>
              Latency: {health?.checks?.database?.latencyMs ?? 0}ms
            </div>
          </div>

          {/* Metrics */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📊 Metrics</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Healthy Providers</span>
                <span style={{ color: '#fff' }}>{health?.metrics?.['autoorch_providers_healthy'] ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Mode</span>
                <span className="badge badge-success">Sandbox</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Total Tokens Used</span>
                <span style={{ color: '#fff' }}>{(health?.metrics?.['autoorch_total_tokens_used'] ?? 0).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Total Cost</span>
                <span style={{ color: '#fff' }}>${(health?.metrics?.['autoorch_total_cost_usd'] ?? 0).toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Connection Status */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🔌 Connection</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#888' }}>WebSocket</span>
                <span className={`badge ${wsConnected ? 'badge-success' : 'badge-danger'}`}>
                  {wsConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#888' }}>API</span>
                <span className={`badge ${health?.status === 'healthy' ? 'badge-success' : 'badge-danger'}`}>
                  {health?.status === 'healthy' ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          {/* Provider Status List */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <h3 className="card-title">⚡ Provider Health</h3>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={handleCheckHealth}
                disabled={checkingHealth}
              >
                {checkingHealth ? '⏳ Checking...' : '🔄 Check All'}
              </button>
            </div>
            {providers.length === 0 ? (
              <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>
                No providers registered
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Last Check</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map(p => {
                    const hs: ProviderHealthStatus = p.health_status || { isHealthy: false };
                    return (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.model_name}</td>
                        <td>
                          <span className={`badge ${hs.isHealthy ? 'badge-success' : 'badge-danger'}`}>
                            {hs.isHealthy ? 'Healthy' : 'Unhealthy'}
                          </span>
                        </td>
                        <td>{hs.latencyMs ? `${hs.latencyMs}ms` : 'N/A'}</td>
                        <td style={{ color: '#666', fontSize: 12 }}>
                          {hs.lastCheckedAt ? new Date(hs.lastCheckedAt).toLocaleTimeString() : 'Never'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Budget Tab */}
      {!loading && activeTab === 'budget' && (
        <div className="grid grid-1">
          {/* Active Runs Budget */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📊 Recent Runs Budget Usage</h3>
            </div>
            {budgetReport.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>State</th>
                    <th>Tokens Used</th>
                    <th>Cost</th>
                    <th>Token %</th>
                    <th>Cost %</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetReport.map((r) => (
                    <tr key={r.runId}>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.prompt || r.runId?.slice(0, 8)}
                      </td>
                      <td>
                        <span className={`badge ${
                          r.state === 'COMPLETED' ? 'badge-success' : 
                          r.state === 'EXECUTING' ? 'badge-warning' : 
                          r.state === 'FAILED' ? 'badge-danger' : 
                          'badge-info'
                        }`}>
                          {r.state}
                        </span>
                      </td>
                      <td>{(r.usage?.tokens ?? 0).toLocaleString()}</td>
                      <td>${(r.usage?.costUsd ?? 0).toFixed(4)}</td>
                      <td>{r.tokenUtilization || 'N/A'}</td>
                      <td>{r.costUtilization || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">✅</div>
                <p className="empty-state-title">No active runs</p>
                <p className="empty-state-text">All runs have completed. Start a new run to track usage.</p>
              </div>
            )}
          </div>

          {/* Summary Stats from Health */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📈 Total Usage</h3>
            </div>
            <div className="grid grid-3" style={{ gap: 24 }}>
              <div>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>Total Tokens</div>
                <div style={{ color: '#fff', fontSize: 24, fontWeight: 600 }}>
                  {(health?.metrics?.['autoorch_total_tokens_used'] ?? 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>Total Cost</div>
                <div style={{ color: '#fff', fontSize: 24, fontWeight: 600 }}>
                  ${(health?.metrics?.['autoorch_total_cost_usd'] ?? 0).toFixed(4)}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>Audit Events (1hr)</div>
                <div style={{ color: '#fff', fontSize: 24, fontWeight: 600 }}>
                  {health?.metrics?.['autoorch_audit_events_last_hour'] ?? 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Failures Tab */}
      {!loading && activeTab === 'failures' && (
        <div>
          {deadLetters.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">✅</div>
                <p className="empty-state-title">No failed tasks</p>
                <p className="empty-state-text">All tasks are running smoothly</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {deadLetters.map(item => (
                <div key={item.id} className="card">
                  <div className="card-header">
                    <h3 className="card-title" style={{ color: '#ef4444' }}>
                      ⚠️ {item.task_name || item.task_id.slice(0, 8)}
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRetryDeadLetter(item.id)}
                      >
                        🔄 Retry
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleDiscardDeadLetter(item.id)}
                      >
                        🗑️ Discard
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ 
                      padding: 12, background: '#1a1a2e', borderRadius: 8,
                      color: '#f87171', fontFamily: 'monospace', fontSize: 12,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {item.error_message}
                    </div>
                    <div style={{ display: 'flex', gap: 16, color: '#666', fontSize: 12 }}>
                      <span>Task: {item.task_id.slice(0, 8)}</span>
                      <span>Run: {item.run_id.slice(0, 8)}</span>
                      <span>Failed: {new Date(item.failed_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sandbox Mode Tab */}
      {!loading && activeTab === 'sandbox' && (
        <div>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🔒 Sandbox Mode Active</h3>
              <span className="badge badge-success">Enabled</span>
            </div>
            <div style={{ padding: '16px 0' }}>
              <p style={{ color: '#e5e7eb', marginBottom: 16, lineHeight: 1.6 }}>
                AutoOrch is running in <strong>sandbox mode</strong>. All agent actions are 
                automatically approved since they execute in a controlled, isolated environment.
              </p>
              
              <div style={{ 
                padding: 16, background: '#1a1a2e', borderRadius: 8, marginBottom: 16,
                border: '1px solid #2a2a3e'
              }}>
                <h4 style={{ color: '#fff', marginBottom: 12, fontSize: 14 }}>
                  ✅ Auto-Approved Actions
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['file_write', 'file_read', 'bash_exec', 'web_search', 'deploy', 'external_api_call'].map(action => (
                    <span key={action} className="badge badge-info" style={{ fontSize: 12 }}>
                      {action}
                    </span>
                  ))}
                </div>
              </div>
              
              <div style={{ 
                padding: 16, background: '#1a1a2e', borderRadius: 8,
                border: '1px solid #2a2a3e'
              }}>
                <h4 style={{ color: '#fff', marginBottom: 12, fontSize: 14 }}>
                  🚫 Always Blocked Actions
                </h4>
                <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>
                  These actions are blocked even in sandbox mode for safety:
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['rm_rf', 'format_disk', 'drop_database', 'sudo'].map(action => (
                    <span key={action} className="badge badge-danger" style={{ fontSize: 12 }}>
                      {action}
                    </span>
                  ))}
                </div>
              </div>
              
              <div style={{ 
                marginTop: 16, padding: 12, background: '#1e3a5f', borderRadius: 8,
                border: '1px solid #3b82f6', color: '#93c5fd', fontSize: 13
              }}>
                💡 <strong>Tip:</strong> To enable approval workflow in production, set 
                <code style={{ 
                  background: '#0a0a0f', padding: '2px 6px', borderRadius: 4, marginLeft: 4
                }}>SANDBOX_MODE=false</code> in your environment.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
