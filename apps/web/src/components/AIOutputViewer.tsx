import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface Props {
  runId?: string;
}

interface StreamingOutput {
  taskId: string;
  role: string;
  content: string;
  startedAt: number;
  isComplete: boolean;
  tokens?: number;
}

export function AIOutputViewer({ runId }: Props) {
  const { events, connected } = useWebSocket(runId);
  const [outputs, setOutputs] = useState<Record<string, StreamingOutput>>({});
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Process only new events (check by unique identifier)
    for (const event of events) {
      // Create unique event ID from timestamp + type + taskId
      const eventId = `${event.timestamp}-${event.type}-${event.payload?.taskId || ''}`;
      
      // Skip already processed events
      if (processedEventsRef.current.has(eventId)) {
        continue;
      }
      processedEventsRef.current.add(eventId);
      
      // Keep processed set from growing too large
      if (processedEventsRef.current.size > 500) {
        const entries = Array.from(processedEventsRef.current);
        processedEventsRef.current = new Set(entries.slice(-250));
      }

      if (event.type === 'PROVIDER_CALL_STARTED') {
        const taskId = event.payload?.taskId;
        if (taskId) {
          setOutputs(prev => ({
            ...prev,
            [taskId]: {
              taskId,
              role: event.payload?.role || 'unknown',
              content: '',
              startedAt: Date.now(),
              isComplete: false,
            }
          }));
          setActiveTaskId(taskId);
        }
      } else if (event.type === 'PROVIDER_STREAM_CHUNK') {
        const taskId = event.payload?.taskId;
        const chunk = event.payload?.chunk;
        if (taskId && chunk !== undefined) {
          setOutputs(prev => {
            const existing = prev[taskId];
            // If we don't have this task yet, create it
            if (!existing) {
              return {
                ...prev,
                [taskId]: {
                  taskId,
                  role: event.payload?.role || 'unknown',
                  content: chunk,
                  startedAt: Date.now(),
                  isComplete: false,
                }
              };
            }
            return {
              ...prev,
              [taskId]: {
                ...existing,
                content: existing.content + chunk,
              }
            };
          });
          // Auto-select this task if none selected
          setActiveTaskId(prev => prev || taskId);
        }
      } else if (event.type === 'PROVIDER_CALL_COMPLETED') {
        const taskId = event.payload?.taskId;
        const output = event.payload?.output;
        if (taskId) {
          setOutputs(prev => {
            const existing = prev[taskId];
            return {
              ...prev,
              [taskId]: {
                taskId,
                role: existing?.role || event.payload?.role || 'unknown',
                content: output || existing?.content || '',
                startedAt: existing?.startedAt || Date.now(),
                isComplete: true,
                tokens: event.payload?.tokens,
              }
            };
          });
          // Auto-select this task if none selected
          setActiveTaskId(prev => prev || taskId);
        }
      }
    }
  }, [events]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [outputs, activeTaskId]);

  const activeOutput = activeTaskId ? outputs[activeTaskId] : null;
  const taskIds = Object.keys(outputs);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>🤖 AI Output</h3>
        <span style={{ ...styles.status, background: connected ? '#16a34a' : '#dc2626' }}>
          {connected ? '● Live' : '○ Disconnected'}
        </span>
      </div>

      {taskIds.length > 1 && (
        <div style={styles.tabs}>
          {taskIds.map(tid => (
            <button
              key={tid}
              onClick={() => setActiveTaskId(tid)}
              style={{
                ...styles.tab,
                background: tid === activeTaskId ? '#3b82f6' : '#333',
              }}
            >
              {outputs[tid].role}
              {!outputs[tid].isComplete && <span style={styles.pulse}>●</span>}
            </button>
          ))}
        </div>
      )}

      <div ref={contentRef} style={styles.outputArea}>
        {!activeOutput ? (
          <div style={styles.placeholder}>
            <div style={styles.placeholderIcon}>🧠</div>
            <p>Waiting for AI to generate output...</p>
            <p style={styles.hint}>Start a run to see AI responses in real-time</p>
          </div>
        ) : (
          <div style={styles.output}>
            <div style={styles.outputHeader}>
              <span style={styles.roleBadge}>{activeOutput.role}</span>
              {!activeOutput.isComplete && (
                <span style={styles.streaming}>
                  <span style={styles.dot1}>●</span>
                  <span style={styles.dot2}>●</span>
                  <span style={styles.dot3}>●</span>
                  Generating...
                </span>
              )}
              {activeOutput.isComplete && (
                <span style={styles.complete}>✓ Complete</span>
              )}
            </div>
            <pre style={styles.content}>
              {activeOutput.content || '(No output yet)'}
              {!activeOutput.isComplete && <span style={styles.cursor}>|</span>}
            </pre>
            {activeOutput.tokens && (
              <div style={styles.stats}>
                Tokens: {activeOutput.tokens}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { 
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', 
    borderRadius: 12, 
    padding: 20, 
    marginBottom: 16,
    border: '1px solid #2d3748',
  },
  header: { 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  title: { fontSize: 18, color: '#e5e5e5', margin: 0 },
  status: {
    padding: '4px 12px', 
    borderRadius: 20, 
    fontSize: 12, 
    color: 'white', 
    fontWeight: 600,
  },
  tabs: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
    overflowX: 'auto',
  },
  tab: {
    padding: '6px 12px',
    borderRadius: 6,
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  pulse: {
    animation: 'pulse 1s infinite',
    color: '#22c55e',
  },
  outputArea: { 
    minHeight: 300, 
    maxHeight: 500, 
    overflowY: 'auto',
    background: '#0d1117',
    borderRadius: 8,
    padding: 16,
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: 250,
    color: '#555',
    textAlign: 'center',
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  hint: {
    fontSize: 12,
    color: '#444',
  },
  output: {
    position: 'relative',
  },
  outputHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid #21262d',
  },
  roleBadge: {
    background: '#3b82f6',
    color: 'white',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  streaming: {
    color: '#22c55e',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  dot1: { animation: 'blink 1.4s infinite 0s' },
  dot2: { animation: 'blink 1.4s infinite 0.2s' },
  dot3: { animation: 'blink 1.4s infinite 0.4s' },
  complete: {
    color: '#22c55e',
    fontSize: 12,
  },
  content: {
    fontFamily: "'Fira Code', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.6,
    color: '#c9d1d9',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    padding: 0,
  },
  cursor: {
    animation: 'blink 1s infinite',
    color: '#3b82f6',
    fontWeight: 'bold',
  },
  stats: {
    marginTop: 12,
    paddingTop: 8,
    borderTop: '1px solid #21262d',
    fontSize: 11,
    color: '#555',
  },
};

// Add CSS animations via style tag
if (typeof document !== 'undefined') {
  const styleId = 'ai-output-viewer-animations';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes blink {
        0%, 50%, 100% { opacity: 1; }
        25%, 75% { opacity: 0; }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `;
    document.head.appendChild(style);
  }
}
