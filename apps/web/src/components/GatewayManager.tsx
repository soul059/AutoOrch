import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface GatewayPresetRaw {
  name: string;
  displayName: string;
  authType: string;
  capabilities: {
    structuredOutput?: boolean;
    structuredOutputReliability?: number;
    toolUse?: boolean;
    streaming?: boolean;
    maxContextTokens?: number;
  };
  defaultModel: string;
}

interface GatewayPreset {
  name: string;
  displayName: string;
  authType: string;
  requiresApiKey: boolean;
  supportsLocalUrl: boolean;
  defaultModel: string;
  capabilities: GatewayPresetRaw['capabilities'];
}

interface Props {
  onProviderRegistered?: () => void;
}

export function GatewayManager({ onProviderRegistered }: Props) {
  const [presets, setPresets] = useState<GatewayPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [formData, setFormData] = useState({
    name: '',
    apiKey: '',
    baseUrl: '',
    modelName: '',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<Array<{ name: string; size: number }>>([]);
  const [scanningModels, setScanningModels] = useState(false);

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    try {
      const data: GatewayPresetRaw[] = await api.getGatewayPresets();
      // Transform raw API response to component format
      const transformed: GatewayPreset[] = data.map(p => ({
        name: p.name,
        displayName: p.name.charAt(0).toUpperCase() + p.name.slice(1), // Capitalize name
        authType: p.authType,
        requiresApiKey: p.authType !== 'none',
        supportsLocalUrl: ['ollama', 'lmstudio', 'openai-compatible'].includes(p.name),
        defaultModel: p.defaultModel,
        capabilities: p.capabilities,
      }));
      setPresets(transformed);
    } catch (err) {
      console.error('Failed to load gateway presets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetSelect = (presetName: string) => {
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
    
    // Auto-scan Ollama models if selecting Ollama preset
    if (presetName === 'ollama' || presetName === 'lmstudio') {
      scanOllamaModels();
    }
  };

  const scanOllamaModels = async () => {
    setScanningModels(true);
    try {
      const result = await api.getOllamaModels();
      if (result.success && result.models) {
        setOllamaModels(result.models);
        if (result.models.length > 0 && !formData.modelName) {
          setFormData(prev => ({ ...prev, modelName: result.models[0].name }));
        }
      } else {
        setOllamaModels([]);
        console.warn('Ollama scan failed:', result.error);
      }
    } catch (err) {
      console.error('Failed to scan Ollama models:', err);
      setOllamaModels([]);
    } finally {
      setScanningModels(false);
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
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleRegister = async () => {
    setRegistering(true);
    try {
      await api.registerGatewayProvider({
        preset: selectedPreset,
        name: formData.name,
        apiKey: formData.apiKey || undefined,
        endpointOverride: formData.baseUrl || undefined,
        modelOverride: formData.modelName,
      });
      setShowRegisterForm(false);
      setSelectedPreset('');
      setFormData({ name: '', apiKey: '', baseUrl: '', modelName: '' });
      setTestResult(null);
      setOllamaModels([]);
      alert('Provider registered successfully!');
      
      // Trigger parent refresh
      if (onProviderRegistered) {
        onProviderRegistered();
      }
    } catch (err: any) {
      alert('Registration failed: ' + err.message);
    } finally {
      setRegistering(false);
    }
  };

  const currentPreset = presets.find(p => p.name === selectedPreset);

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading gateway presets...</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Provider Gateway</h2>
        <button
          style={styles.addBtn}
          onClick={() => setShowRegisterForm(!showRegisterForm)}
        >
          {showRegisterForm ? '✕ Cancel' : '+ Add Provider'}
        </button>
      </div>

      <p style={styles.description}>
        Connect to AI providers using the universal gateway. Supports 50+ providers including
        OpenAI, Anthropic, Google Gemini, Mistral, Groq, and more.
      </p>

      {showRegisterForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitle}>Register New Provider</h3>

          {/* Preset Selection */}
          <div style={styles.presetGrid}>
            {presets.map(preset => (
              <button
                key={preset.name}
                style={selectedPreset === preset.name ? styles.presetActive : styles.preset}
                onClick={() => handlePresetSelect(preset.name)}
              >
                <span style={styles.presetName}>{preset.displayName}</span>
                <span style={styles.presetDesc}>
                  {preset.authType === 'none' ? 'No auth required' : `Auth: ${preset.authType}`}
                </span>
              </button>
            ))}
          </div>

          {selectedPreset && currentPreset && (
            <div style={styles.configSection}>
              <input
                type="text"
                placeholder="Provider name (e.g., My GPT-4)"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                style={styles.input}
              />

              {currentPreset.requiresApiKey && (
                <input
                  type="password"
                  placeholder="API Key"
                  value={formData.apiKey}
                  onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                  style={styles.input}
                />
              )}

              {currentPreset.supportsLocalUrl && (
                <input
                  type="text"
                  placeholder="Base URL (optional, e.g., http://localhost:11434)"
                  value={formData.baseUrl}
                  onChange={e => setFormData({ ...formData, baseUrl: e.target.value })}
                  style={styles.input}
                />
              )}

              <input
                type="text"
                placeholder="Model name (e.g., gpt-4, llama3.2)"
                value={formData.modelName}
                onChange={e => setFormData({ ...formData, modelName: e.target.value })}
                style={styles.input}
              />

              {/* Ollama/LMStudio model selector */}
              {(selectedPreset === 'ollama' || selectedPreset === 'lmstudio') && (
                <div style={styles.modelScanSection}>
                  <div style={styles.scanHeader}>
                    <span style={styles.scanLabel}>
                      {ollamaModels.length > 0 ? `${ollamaModels.length} models found` : 'No models detected'}
                    </span>
                    <button
                      type="button"
                      style={styles.scanBtn}
                      onClick={scanOllamaModels}
                      disabled={scanningModels}
                    >
                      {scanningModels ? '🔄 Scanning...' : '🔍 Scan Models'}
                    </button>
                  </div>
                  {ollamaModels.length > 0 && (
                    <select
                      value={formData.modelName}
                      onChange={e => setFormData({ ...formData, modelName: e.target.value })}
                      style={styles.select}
                    >
                      <option value="">Select a model...</option>
                      {ollamaModels.map(model => (
                        <option key={model.name} value={model.name}>
                          {model.name} ({(model.size / 1e9).toFixed(1)}GB)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {testResult && (
                <div style={{
                  ...styles.testResult,
                  background: testResult.success ? '#14532d' : '#7f1d1d',
                  color: testResult.success ? '#86efac' : '#fca5a5',
                }}>
                  {testResult.success ? '✓' : '✕'} {testResult.message}
                </div>
              )}

              <div style={styles.formActions}>
                <button
                  style={styles.testBtn}
                  onClick={handleTestConnection}
                  disabled={testing || !formData.modelName || (currentPreset.requiresApiKey && !formData.apiKey)}
                >
                  {testing ? 'Testing...' : '🔌 Test Connection'}
                </button>
                <button
                  style={styles.registerBtn}
                  onClick={handleRegister}
                  disabled={registering || !formData.name || !formData.modelName || (currentPreset.requiresApiKey && !formData.apiKey)}
                >
                  {registering ? 'Registering...' : '✓ Register Provider'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Available Presets Info */}
      <div style={styles.presetsInfo}>
        <h3 style={styles.infoTitle}>Supported Providers ({presets.length})</h3>
        <div style={styles.presetList}>
          {presets.map(preset => (
            <div key={preset.name} style={styles.presetInfo}>
              <span style={styles.presetInfoName}>{preset.displayName}</span>
              <span style={styles.presetInfoModels}>
                Model: {preset.defaultModel}
                {preset.capabilities?.maxContextTokens && ` · ${Math.round(preset.capabilities.maxContextTokens/1000)}k ctx`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 20, marginBottom: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 18, color: '#e5e5e5', margin: 0 },
  addBtn: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 4,
    padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  },
  description: { color: '#666', fontSize: 13, marginBottom: 16 },
  loading: { color: '#666', fontSize: 14 },

  form: { background: '#1a1a1a', borderRadius: 8, padding: 16, marginBottom: 16 },
  formTitle: { fontSize: 15, color: '#e5e5e5', marginBottom: 12 },
  presetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 16 },
  preset: {
    background: '#222', border: '1px solid #333', borderRadius: 6,
    padding: 10, cursor: 'pointer', textAlign: 'left' as const,
  },
  presetActive: {
    background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6,
    padding: 10, cursor: 'pointer', textAlign: 'left' as const,
  },
  presetName: { display: 'block', color: '#e5e5e5', fontSize: 13, fontWeight: 600, marginBottom: 2 },
  presetDesc: { display: 'block', color: '#666', fontSize: 11 },

  configSection: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  input: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '10px 12px',
    color: '#e5e5e5', fontSize: 13, width: '100%', boxSizing: 'border-box' as const,
  },
  select: {
    background: '#222', border: '1px solid #333', borderRadius: 4, padding: '10px 12px',
    color: '#e5e5e5', fontSize: 13,
  },
  testResult: { padding: '8px 12px', borderRadius: 4, fontSize: 12 },
  formActions: { display: 'flex', gap: 10, marginTop: 8 },
  testBtn: {
    background: '#333', color: '#aaa', border: 'none', borderRadius: 4,
    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
  },
  registerBtn: {
    background: '#22c55e', color: 'white', border: 'none', borderRadius: 4,
    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
  },

  presetsInfo: { marginTop: 16 },
  infoTitle: { fontSize: 14, color: '#888', marginBottom: 10 },
  presetList: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  presetInfo: {
    background: '#1a1a1a', borderRadius: 4, padding: '6px 10px',
    display: 'flex', flexDirection: 'column' as const, gap: 2,
  },
  presetInfoName: { color: '#e5e5e5', fontSize: 12, fontWeight: 500 },
  presetInfoModels: { color: '#666', fontSize: 10 },
  
  modelScanSection: { background: '#1a1a1a', borderRadius: 6, padding: 12, border: '1px solid #333' },
  scanHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  scanLabel: { color: '#888', fontSize: 12 },
  scanBtn: {
    background: '#333', color: '#aaa', border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
  },
};
