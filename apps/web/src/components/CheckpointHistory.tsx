import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Props {
  runId: string;
}

export function CheckpointHistory({ runId }: Props) {
  const [checkpoints, setCheckpoints] = useState<any[]>([]);

  useEffect(() => {
    api.listCheckpoints(runId).then(setCheckpoints).catch(console.error);
  }, [runId]);

  if (checkpoints.length === 0) return null;

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Checkpoint History</h3>
      <div style={styles.list}>
        {checkpoints.map(cp => (
          <div key={cp.id} style={styles.item}>
            <span style={styles.seq}>#{cp.sequence_number}</span>
            <span style={styles.state}>{cp.run_state}</span>
            <span style={styles.time}>{new Date(cp.created_at).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 16, marginBottom: 16 },
  title: { fontSize: 16, marginBottom: 12, color: '#e5e5e5' },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  item: {
    display: 'flex', gap: 12, padding: '6px 10px',
    background: '#1a1a1a', borderRadius: 4, alignItems: 'center',
  },
  seq: { color: '#6366f1', fontWeight: 700, fontFamily: 'monospace', fontSize: 13 },
  state: { color: '#ccc', fontSize: 13 },
  time: { color: '#555', fontSize: 12, marginLeft: 'auto' },
};
