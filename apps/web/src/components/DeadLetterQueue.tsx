import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface DeadLetterEntry {
  id: string;
  task_id: string;
  run_id: string;
  error_type: string;
  error_message: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  last_retry_at: string | null;
}

export function DeadLetterQueue() {
  const [entries, setEntries] = useState<DeadLetterEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [entriesData, countData] = await Promise.all([
        api.listDeadLetterEntries(),
        api.getDeadLetterCount(),
      ]);
      setEntries(entriesData);
      setCount(countData.pending);
    } catch (err) {
      console.error('Failed to load dead letter queue:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await api.retryDeadLetterEntry(id);
      loadData();
    } catch (err: any) {
      alert('Retry failed: ' + err.message);
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading dead letter queue...</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Dead Letter Queue</h2>
        <span style={styles.badge}>{count} pending</span>
      </div>

      {entries.length === 0 ? (
        <p style={styles.empty}>✓ No failed tasks in dead letter queue</p>
      ) : (
        <div style={styles.list}>
          {entries.map(entry => (
            <div key={entry.id} style={styles.entry}>
              <div style={styles.entryHeader}>
                <span style={styles.taskId}>Task: {entry.task_id.slice(0, 8)}</span>
                <span style={styles.errorType}>{entry.error_type}</span>
              </div>
              <p style={styles.errorMsg}>{entry.error_message}</p>
              <div style={styles.meta}>
                <span>Retries: {entry.retry_count}/{entry.max_retries}</span>
                <span>Run: {entry.run_id.slice(0, 8)}</span>
                <span>{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              <button
                style={styles.retryBtn}
                onClick={() => handleRetry(entry.id)}
                disabled={retrying === entry.id || entry.retry_count >= entry.max_retries}
              >
                {retrying === entry.id ? 'Retrying...' : '↻ Retry'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 20, marginBottom: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, color: '#e5e5e5', margin: 0 },
  badge: {
    background: '#dc2626', color: 'white', padding: '4px 10px',
    borderRadius: 12, fontSize: 12, fontWeight: 600,
  },
  loading: { color: '#666', fontSize: 14 },
  empty: { color: '#22c55e', fontSize: 14, textAlign: 'center' as const },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  entry: { background: '#1a1a1a', borderRadius: 6, padding: 12, border: '1px solid #333' },
  entryHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  taskId: { color: '#e5e5e5', fontSize: 13, fontWeight: 600 },
  errorType: {
    background: '#7f1d1d', color: '#fca5a5', padding: '2px 6px',
    borderRadius: 3, fontSize: 10, fontWeight: 600,
  },
  errorMsg: { color: '#ef4444', fontSize: 12, marginBottom: 8, fontFamily: 'monospace' },
  meta: { display: 'flex', gap: 16, color: '#666', fontSize: 11, marginBottom: 8 },
  retryBtn: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
  },
};
