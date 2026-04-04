import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Props {
  refreshTrigger?: number;
  onProviderDeleted?: () => void;
}

export function ProviderSelector({ refreshTrigger, onProviderDeleted }: Props) {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  useEffect(() => {
    loadProviders();
  }, [refreshTrigger]);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const data = await api.listProviders();
      setProviders(data);
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete provider "${name}"? This will remove all role mappings for this provider.`)) {
      return;
    }
    setDeleting(id);
    try {
      await api.deleteProvider(id);
      loadProviders();
      onProviderDeleted?.();
    } catch (err: any) {
      alert('Failed to delete: ' + err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      await api.runHealthChecks();
      loadProviders();
    } catch (err: any) {
      alert('Health check failed: ' + err.message);
    } finally {
      setCheckingHealth(false);
    }
  };

  if (loading) return <p style={styles.loading}>Loading providers...</p>;
  if (providers.length === 0) return (
    <div style={styles.container}>
      <h3 style={styles.title}>Registered Providers</h3>
      <p style={styles.empty}>No providers registered yet. Use the form above to add providers.</p>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Registered Providers ({providers.length})</h3>
        <div style={styles.headerActions}>
          <button 
            style={styles.healthBtn} 
            onClick={handleHealthCheck}
            disabled={checkingHealth}
          >
            {checkingHealth ? '⏳ Checking...' : '🔍 Check Health'}
          </button>
          <button style={styles.refreshBtn} onClick={loadProviders}>🔄 Refresh</button>
        </div>
      </div>
      <div style={styles.grid}>
        {providers.map(p => {
          const health = p.health_status || {};
          const caps = p.capabilities || {};
          return (
            <div key={p.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.name}>{p.name}</span>
                <div style={styles.cardActions}>
                  <span style={{
                    ...styles.healthDot,
                    background: health.isHealthy ? '#22c55e' : '#ef4444',
                  }} title={health.isHealthy ? 'Healthy' : (health.lastErrorMessage || 'Unhealthy')} />
                  <button 
                    style={styles.deleteBtn}
                    onClick={() => handleDelete(p.id, p.name)}
                    disabled={deleting === p.id}
                    title="Delete provider"
                  >
                    {deleting === p.id ? '...' : '✕'}
                  </button>
                </div>
              </div>
              <p style={styles.detail}>{p.type} — {p.model_name}</p>
              <p style={styles.endpoint} title={p.endpoint}>{p.endpoint}</p>
              <div style={styles.caps}>
                {caps.structuredOutput && <span style={styles.capBadge}>JSON</span>}
                {caps.toolUse && <span style={styles.capBadge}>Tools</span>}
                {caps.streaming && <span style={styles.capBadge}>Stream</span>}
              </div>
              {caps.structuredOutputReliability !== undefined && (
                <p style={{
                  ...styles.reliability,
                  color: caps.structuredOutputReliability >= 0.8 ? '#22c55e'
                    : caps.structuredOutputReliability >= 0.5 ? '#f59e0b' : '#ef4444',
                }}>
                  JSON reliability: {((caps.structuredOutputReliability ?? 0) * 100).toFixed(0)}%
                </p>
              )}
              {!health.isHealthy && health.lastErrorMessage && (
                <p style={styles.errorMsg} title={health.lastErrorMessage}>
                  ⚠️ {health.lastErrorMessage.slice(0, 40)}...
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 16, marginBottom: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerActions: { display: 'flex', gap: 8 },
  title: { fontSize: 16, margin: 0, color: '#e5e5e5' },
  refreshBtn: {
    background: '#333', color: '#aaa', border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
  },
  healthBtn: {
    background: '#1e3a5f', color: '#93c5fd', border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
  },
  loading: { color: '#666', fontSize: 13, padding: 20, textAlign: 'center' as const },
  empty: { color: '#666', fontSize: 13, padding: 20, textAlign: 'center' as const },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 },
  card: { background: '#1a1a1a', borderRadius: 6, padding: 12, border: '1px solid #222' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardActions: { display: 'flex', alignItems: 'center', gap: 8 },
  name: { color: '#e5e5e5', fontSize: 14, fontWeight: 600 },
  healthDot: { width: 8, height: 8, borderRadius: '50%' },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: 14, padding: 2,
  },
  detail: { color: '#888', fontSize: 12, marginBottom: 4 },
  endpoint: { color: '#555', fontSize: 10, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  caps: { display: 'flex', gap: 4, marginBottom: 4 },
  capBadge: {
    background: '#1e3a5f', color: '#93c5fd', padding: '1px 6px',
    borderRadius: 3, fontSize: 10, fontWeight: 600,
  },
  reliability: { fontSize: 11, marginTop: 4 },
  errorMsg: { fontSize: 10, color: '#f97316', marginTop: 4 },
};
