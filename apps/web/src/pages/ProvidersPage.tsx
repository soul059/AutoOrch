import React, { useEffect, useState } from 'react';
import { useAppStore, Provider, ProviderHealthStatus, ProviderCapabilities } from '../stores/useAppStore';
import { api } from '../services/api';

interface GatewayPreset {
  name: string;
  displayName: string;
  authType: string;
  defaultModel: string;
  capabilities?: { maxContextTokens?: number };
}

interface ProviderMetric {
  provider: string;
  type: string;
  model: string;
  healthy: boolean;
  successfulCalls: number;
  failedCalls: number;
  avgLatencyMs: string | null;
}

export function ProvidersPage() {
  const { providers, providersLoading, fetchProviders, deleteProvider, addToast } = useAppStore();
  const [activeTab, setActiveTab] = useState<'providers' | 'gateway' | 'metrics'>('providers');
  const [presets, setPresets] = useState<GatewayPreset[]>([]);
  const [metrics, setMetrics] = useState<ProviderMetric[]>([]);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [formData, setFormData] = useState({ name: '', apiKey: '', baseUrl: '', modelName: '' });
  const [ollamaModels, setOllamaModels] = useState<Array<{ name: string; size: number }>>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);

  useEffect(() => {
    fetchProviders();
    loadPresets();
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      const data = await api.getProviderMetrics();
      setMetrics(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load metrics:', err);
    }
  };

  const loadPresets = async () => {
    try {
      const data = await api.getGatewayPresets();
      setPresets(data.map((p: any) => ({
        name: p.name,
        displayName: p.name.charAt(0).toUpperCase() + p.name.slice(1),
        authType: p.authType,
        defaultModel: p.defaultModel,
        capabilities: p.capabilities,
      })));
    } catch (err: any) {
      console.error('Failed to load presets:', err);
      addToast('error', 'Failed to load presets', err.message);
    }
  };

  const handlePresetSelect = async (presetName: string) => {
    setSelectedPreset(presetName);
    const preset = presets.find(p => p.name === presetName);
    if (preset) {
      setFormData({
        name: preset.displayName,
        apiKey: '',
        baseUrl: '',
        modelName: preset.defaultModel || '',
      });
    }
    setTestResult(null);

    // Scan Ollama models if selected
    if (presetName === 'ollama' || presetName === 'lmstudio') {
      try {
        const result = await api.getOllamaModels();
        if (result.success && result.models) {
          setOllamaModels(result.models);
          if (result.models.length > 0 && !formData.modelName) {
            setFormData(prev => ({ ...prev, modelName: result.models[0].name }));
          }
          addToast('info', 'Models detected', `Found ${result.models.length} local models`);
        }
      } catch {
        setOllamaModels([]);
        addToast('warning', 'Could not detect models', 'Make sure Ollama/LM Studio is running');
      }
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testGatewayConnection({
        preset: selectedPreset,
        apiKey: formData.apiKey,
        baseUrl: formData.baseUrl || undefined,
        modelName: formData.modelName,
      });
      setTestResult({ success: result.success, message: result.message || 'Connection successful!' });
      if (result.success) {
        addToast('success', 'Connection test passed', 'Provider is reachable');
      } else {
        addToast('error', 'Connection test failed', result.message);
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
      addToast('error', 'Connection test failed', err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleRegister = async () => {
    if (!formData.name.trim()) {
      addToast('warning', 'Name required', 'Please enter a provider name');
      return;
    }
    if (!formData.modelName.trim()) {
      addToast('warning', 'Model required', 'Please specify a model name');
      return;
    }
    setRegistering(true);
    try {
      await api.registerGatewayProvider({
        preset: selectedPreset,
        name: formData.name,
        apiKey: formData.apiKey || undefined,
        endpointOverride: formData.baseUrl || undefined,
        modelOverride: formData.modelName,
      });
      setShowRegisterModal(false);
      setSelectedPreset('');
      setFormData({ name: '', apiKey: '', baseUrl: '', modelName: '' });
      setTestResult(null);
      fetchProviders();
      addToast('success', 'Provider registered', `${formData.name} is now available`);
    } catch (err: any) {
      addToast('error', 'Registration failed', err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      await api.runHealthChecks();
      fetchProviders();
      addToast('success', 'Health check complete', 'Provider status updated');
    } catch (err: any) {
      addToast('error', 'Health check failed', err.message);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleDeleteProvider = async (id: string, name: string) => {
    if (!confirm(`Delete provider "${name}"?`)) return;
    try {
      await deleteProvider(id);
      addToast('success', 'Provider deleted', `${name} removed successfully`);
    } catch (err: any) {
      addToast('error', 'Failed to delete', err.message);
    }
  };

  const currentPreset = presets.find(p => p.name === selectedPreset);
  const requiresApiKey = currentPreset && currentPreset.authType !== 'none';
  const supportsLocalUrl = ['ollama', 'lmstudio', 'openai-compatible'].includes(selectedPreset);

  return (
    <div className="providers-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Providers</h1>
          <p className="page-subtitle">Manage AI providers and connections</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)}>
          + Add Provider
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'providers' ? 'active' : ''}`}
          onClick={() => setActiveTab('providers')}
        >
          ⚡ Registered Providers ({providers.length})
        </button>
        <button 
          className={`tab ${activeTab === 'gateway' ? 'active' : ''}`}
          onClick={() => setActiveTab('gateway')}
        >
          🌐 Available Gateways ({presets.length})
        </button>
        <button 
          className={`tab ${activeTab === 'metrics' ? 'active' : ''}`}
          onClick={() => { setActiveTab('metrics'); loadMetrics(); }}
        >
          📊 Metrics
        </button>
      </div>

      {/* Registered Providers Tab */}
      {activeTab === 'providers' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button 
              className="btn btn-secondary btn-sm"
              onClick={handleHealthCheck}
              disabled={checkingHealth}
            >
              {checkingHealth ? '⏳ Checking...' : '🔍 Check Health'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => fetchProviders(true)}>
              🔄 Refresh
            </button>
          </div>

          {providersLoading && providers.length === 0 ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : providers.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">⚡</div>
                <p className="empty-state-title">No providers registered</p>
                <p className="empty-state-text">Add a provider to start using AI agents</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-3">
              {providers.map(provider => {
                const health: ProviderHealthStatus = provider.health_status || { isHealthy: false };
                const caps: ProviderCapabilities = provider.capabilities || {};
                return (
                  <div key={provider.id} className="card">
                    <div className="card-header">
                      <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: health.isHealthy ? '#22c55e' : '#ef4444',
                        }} />
                        {provider.name}
                      </h3>
                      <button 
                        className="btn btn-icon btn-secondary"
                        onClick={() => handleDeleteProvider(provider.id, provider.name)}
                      >✕</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ color: '#888', fontSize: 13 }}>
                        {provider.type} — {provider.model_name}
                      </div>
                      <div style={{ 
                        color: '#555', fontSize: 11, 
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' 
                      }}>
                        {provider.endpoint}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {caps.structuredOutput && <span className="badge badge-info">JSON</span>}
                        {caps.toolUse && <span className="badge badge-info">Tools</span>}
                        {caps.streaming && <span className="badge badge-info">Stream</span>}
                      </div>
                      {!health.isHealthy && health.lastErrorMessage && (
                        <div style={{ color: '#f59e0b', fontSize: 11 }}>
                          ⚠️ {health.lastErrorMessage.slice(0, 50)}...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Gateway Presets Tab */}
      {activeTab === 'gateway' && (
        <div className="grid grid-4">
          {presets.map(preset => (
            <div 
              key={preset.name} 
              className="card" 
              style={{ cursor: 'pointer' }}
              onClick={() => {
                handlePresetSelect(preset.name);
                setShowRegisterModal(true);
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 12 }}>{getPresetIcon(preset.name)}</div>
              <h4 style={{ color: '#fff', margin: '0 0 8px', fontSize: 16 }}>{preset.displayName}</h4>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                {preset.authType === 'none' ? 'No auth required' : `Auth: ${preset.authType}`}
              </div>
              <div style={{ color: '#555', fontSize: 11 }}>
                Model: {preset.defaultModel}
                {preset.capabilities?.maxContextTokens && (
                  <> · {Math.round(preset.capabilities.maxContextTokens / 1000)}k ctx</>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn btn-secondary btn-sm" onClick={loadMetrics}>
              🔄 Refresh
            </button>
          </div>
          
          {metrics.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <p className="empty-state-title">No metrics available</p>
                <p className="empty-state-text">Metrics will appear after providers make API calls</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Type</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Successful Calls</th>
                    <th>Failed Calls</th>
                    <th>Avg Latency</th>
                    <th>Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m, i) => {
                    const total = m.successfulCalls + m.failedCalls;
                    const successRate = total > 0 ? ((m.successfulCalls / total) * 100).toFixed(1) : 'N/A';
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{m.provider}</td>
                        <td><span className="badge badge-info">{m.type}</span></td>
                        <td style={{ color: '#888', fontSize: 12 }}>{m.model}</td>
                        <td>
                          <span className={`badge ${m.healthy ? 'badge-success' : 'badge-danger'}`}>
                            {m.healthy ? 'Healthy' : 'Unhealthy'}
                          </span>
                        </td>
                        <td style={{ color: '#22c55e' }}>{m.successfulCalls}</td>
                        <td style={{ color: m.failedCalls > 0 ? '#ef4444' : '#888' }}>{m.failedCalls}</td>
                        <td>{m.avgLatencyMs ? `${m.avgLatencyMs}ms` : 'N/A'}</td>
                        <td>
                          <span style={{ 
                            color: successRate === 'N/A' ? '#888' : 
                                   parseFloat(successRate) >= 90 ? '#22c55e' : 
                                   parseFloat(successRate) >= 70 ? '#f59e0b' : '#ef4444'
                          }}>
                            {successRate}{successRate !== 'N/A' && '%'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Register Modal */}
      {showRegisterModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowRegisterModal(false)}>
          <div className="card" style={{ width: 600, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">Register Provider</h3>
              <button className="btn btn-icon btn-secondary" onClick={() => setShowRegisterModal(false)}>✕</button>
            </div>

            {/* Preset Selection */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Select Provider Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {presets.map(preset => (
                  <button
                    key={preset.name}
                    className={`btn ${selectedPreset === preset.name ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handlePresetSelect(preset.name)}
                    style={{ padding: '12px 8px', flexDirection: 'column', height: 'auto' }}
                  >
                    <span style={{ fontSize: 20, marginBottom: 4 }}>{getPresetIcon(preset.name)}</span>
                    <span style={{ fontSize: 12 }}>{preset.displayName}</span>
                  </button>
                ))}
              </div>
            </div>

            {selectedPreset && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Provider Name</label>
                  <input
                    className="input"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., My GPT-4, Local Ollama"
                  />
                </div>

                {requiresApiKey && (
                  <div>
                    <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>API Key</label>
                    <input
                      className="input"
                      type="password"
                      value={formData.apiKey}
                      onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                  </div>
                )}

                {supportsLocalUrl && (
                  <div>
                    <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Base URL (optional)</label>
                    <input
                      className="input"
                      value={formData.baseUrl}
                      onChange={e => setFormData({ ...formData, baseUrl: e.target.value })}
                      placeholder="http://localhost:11434"
                    />
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8 }}>Model Name</label>
                  {ollamaModels.length > 0 ? (
                    <select
                      className="select"
                      value={formData.modelName}
                      onChange={e => setFormData({ ...formData, modelName: e.target.value })}
                    >
                      <option value="">Select a model...</option>
                      {ollamaModels.map(m => (
                        <option key={m.name} value={m.name}>
                          {m.name} ({(m.size / 1e9).toFixed(1)}GB)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      value={formData.modelName}
                      onChange={e => setFormData({ ...formData, modelName: e.target.value })}
                      placeholder="e.g., gpt-4, llama3.2, claude-3-opus"
                    />
                  )}
                </div>

                {testResult && (
                  <div style={{
                    padding: 12, borderRadius: 8,
                    background: testResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: testResult.success ? '#22c55e' : '#ef4444',
                    fontSize: 13,
                  }}>
                    {testResult.success ? '✓' : '✕'} {testResult.message}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={handleTestConnection}
                    disabled={testing || !formData.modelName}
                  >
                    {testing ? 'Testing...' : '🔌 Test Connection'}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleRegister}
                    disabled={registering || !formData.name || !formData.modelName}
                  >
                    {registering ? 'Registering...' : '✓ Register'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getPresetIcon(name: string): string {
  const icons: Record<string, string> = {
    openai: '🟢', anthropic: '🟠', google: '🔵', ollama: '🦙',
    mistral: '🌀', groq: '⚡', azure: '☁️', cohere: '🔷',
    lmstudio: '🖥️', together: '🤝', perplexity: '🔮',
  };
  return icons[name] || '🤖';
}
