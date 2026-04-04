import React from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

const EVENT_COLORS: Record<string, string> = {
  RUN_STATE_CHANGED: '#3b82f6',
  TASK_STATE_CHANGED: '#8b5cf6',
  PROVIDER_CALL_STARTED: '#f59e0b',
  PROVIDER_CALL_COMPLETED: '#22c55e',
  PROVIDER_CALL_FAILED: '#ef4444',
  TOOL_REQUEST: '#06b6d4',
  TOOL_RESULT: '#14b8a6',
  APPROVAL_REQUESTED: '#f97316',
  APPROVAL_RESOLVED: '#10b981',
  POLICY_EVALUATED: '#ec4899',
  CHECKPOINT_CREATED: '#6366f1',
  BUDGET_WARNING: '#f59e0b',
  BUDGET_EXCEEDED: '#ef4444',
};

interface Props {
  runId?: string;
}

export function LiveLogs({ runId }: Props) {
  const { events, connected } = useWebSocket(runId);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Live Logs</h3>
        <span style={{ ...styles.status, background: connected ? '#16a34a' : '#dc2626' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div style={styles.logs}>
        {events.length === 0 ? (
          <p style={styles.empty}>Waiting for events...</p>
        ) : (
          events.map((event, i) => (
            <div key={i} style={styles.event}>
              <span style={{ ...styles.eventType, color: EVENT_COLORS[event.type] || '#666' }}>
                {event.type || event.payload?.newState || 'EVENT'}
              </span>
              <span style={styles.timestamp}>
                {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}
              </span>
              <span style={styles.detail}>
                {event.payload ? JSON.stringify(event.payload).slice(0, 120) : JSON.stringify(event).slice(0, 120)}
              </span>
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
  title: { fontSize: 16, color: '#e5e5e5' },
  status: {
    padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'white', fontWeight: 600,
  },
  logs: { maxHeight: 400, overflowY: 'auto' as const, fontFamily: 'monospace', fontSize: 12 },
  empty: { color: '#555' },
  event: { padding: '4px 0', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: 8, alignItems: 'baseline' },
  eventType: { fontWeight: 700, fontSize: 11, minWidth: 180 },
  timestamp: { color: '#555', fontSize: 11, minWidth: 80 },
  detail: { color: '#888', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
