import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';

interface Task {
  id: string;
  run_id: string;
  agent_role: string;
  state: string;
  sequence_index: number;
  depends_on: string[]; // UUIDs of dependent tasks
  input?: { prompt?: string; role?: string; taskIndex?: number; totalTasks?: number };
  output?: { response?: string };
  token_usage?: { totalTokens?: number; costUsd?: number };
  created_at: string;
  updated_at: string;
}

interface Props {
  runId: string;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
}

const STATE_COLORS: Record<string, string> = {
  PENDING: '#6b7280',
  QUEUED: '#a855f7',
  DISPATCHED: '#3b82f6',
  RUNNING: '#f59e0b',
  SUCCEEDED: '#22c55e',
  FAILED: '#ef4444',
  SKIPPED: '#9ca3af',
  CANCELLED: '#71717a',
};

const STATE_ICONS: Record<string, string> = {
  PENDING: '○',
  QUEUED: '◐',
  DISPATCHED: '◑',
  RUNNING: '◉',
  SUCCEEDED: '✓',
  FAILED: '✗',
  SKIPPED: '⊘',
  CANCELLED: '⊗',
};

const ROLE_ICONS: Record<string, string> = {
  PLANNER: '📋',
  RESEARCHER: '🔍',
  BUILDER: '🔧',
  REVIEWER: '👁️',
  OPERATIONS: '⚙️',
};

export function AgentFlowDiagram({ runId, tasks, onTaskClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredTask, setHoveredTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Sort tasks by sequence index
  const sortedTasks = [...tasks].sort((a, b) => a.sequence_index - b.sequence_index);

  // Calculate node positions
  useEffect(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const nodeWidth = 140;
    const nodeHeight = 80;
    const horizontalGap = 60;
    const startX = 80;
    const centerY = 100;

    sortedTasks.forEach((task, index) => {
      positions.set(task.id, {
        x: startX + index * (nodeWidth + horizontalGap),
        y: centerY,
      });
    });

    setNodePositions(positions);
  }, [tasks]);

  // Draw connections on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodePositions.size === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw connections
    sortedTasks.forEach((task) => {
      if (!task.depends_on || task.depends_on.length === 0) return;

      const toPos = nodePositions.get(task.id);
      if (!toPos) return;

      task.depends_on.forEach((depId) => {
        // depends_on contains UUIDs, find the task by ID
        const depTask = sortedTasks.find(t => t.id === depId);
        if (!depTask) return;

        const fromPos = nodePositions.get(depTask.id);
        if (!fromPos) return;

        // Draw arrow
        ctx.beginPath();
        ctx.strokeStyle = task.state === 'RUNNING' || task.state === 'SUCCEEDED' ? '#22c55e' : '#4b5563';
        ctx.lineWidth = 2;

        // Arrow from right side of source to left side of target
        const fromX = fromPos.x + 70;
        const fromY = fromPos.y + 40;
        const toX = toPos.x - 10;
        const toY = toPos.y + 40;

        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        // Draw arrowhead
        const angle = Math.atan2(toY - fromY, toX - fromX);
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - 10 * Math.cos(angle - Math.PI / 6), toY - 10 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - 10 * Math.cos(angle + Math.PI / 6), toY - 10 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = task.state === 'RUNNING' || task.state === 'SUCCEEDED' ? '#22c55e' : '#4b5563';
        ctx.fill();
      });
    });
  }, [nodePositions, tasks]);

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    onTaskClick?.(task);
  };

  if (tasks.length === 0) {
    return (
      <div style={styles.emptyState}>
        <span style={styles.emptyIcon}>🔄</span>
        <p>No tasks planned yet. Submit a prompt to see the agent workflow.</p>
      </div>
    );
  }

  const canvasWidth = Math.max(800, sortedTasks.length * 200 + 100);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Agent Flow</h3>
        <div style={styles.legend}>
          {Object.entries(STATE_COLORS).slice(0, 5).map(([state, color]) => (
            <div key={state} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, backgroundColor: color }} />
              <span style={styles.legendLabel}>{state}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.diagramContainer}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={200}
          style={styles.canvas}
        />

        <div style={styles.nodesContainer}>
          {sortedTasks.map((task) => {
            const pos = nodePositions.get(task.id);
            if (!pos) return null;

            const isHovered = hoveredTask?.id === task.id;
            const isSelected = selectedTask?.id === task.id;
            const stateColor = STATE_COLORS[task.state] || '#6b7280';

            return (
              <div
                key={task.id}
                style={{
                  ...styles.node,
                  left: pos.x,
                  top: pos.y,
                  borderColor: isSelected ? '#3b82f6' : stateColor,
                  boxShadow: isHovered || isSelected
                    ? `0 0 20px ${stateColor}40`
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                }}
                onMouseEnter={() => setHoveredTask(task)}
                onMouseLeave={() => setHoveredTask(null)}
                onClick={() => handleTaskClick(task)}
              >
                <div style={styles.nodeHeader}>
                  <span style={styles.roleIcon}>{ROLE_ICONS[task.agent_role] || '🤖'}</span>
                  <span style={styles.roleName}>{task.agent_role}</span>
                </div>
                <div style={{ ...styles.nodeStatus, color: stateColor }}>
                  <span style={styles.stateIcon}>{STATE_ICONS[task.state] || '○'}</span>
                  <span>{task.state}</span>
                </div>
                {task.token_usage?.totalTokens && (
                  <div style={styles.nodeTokens}>
                    {task.token_usage.totalTokens.toLocaleString()} tokens
                  </div>
                )}
                {task.state === 'RUNNING' && (
                  <div style={styles.pulsingDot} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selectedTask && (
        <div style={styles.taskDetail}>
          <div style={styles.detailHeader}>
            <span style={styles.detailIcon}>{ROLE_ICONS[selectedTask.agent_role] || '🤖'}</span>
            <h4 style={styles.detailTitle}>{selectedTask.agent_role} Details</h4>
            <button
              style={styles.closeBtn}
              onClick={() => setSelectedTask(null)}
            >
              ✕
            </button>
          </div>
          <div style={styles.detailContent}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Status:</span>
              <span style={{ color: STATE_COLORS[selectedTask.state] }}>{selectedTask.state}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Task ID:</span>
              <code style={styles.detailCode}>{selectedTask.id.slice(0, 8)}...</code>
            </div>
            {selectedTask.depends_on?.length > 0 && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Depends on:</span>
                <span>{selectedTask.depends_on.map(depId => sortedTasks.find(t => t.id === depId)?.agent_role).filter(Boolean).join(', ')}</span>
              </div>
            )}
            {selectedTask.token_usage && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Tokens:</span>
                <span>{selectedTask.token_usage.totalTokens?.toLocaleString() || 0}</span>
              </div>
            )}
            {selectedTask.output?.response && (
              <div style={styles.detailOutput}>
                <span style={styles.detailLabel}>Output Preview:</span>
                <pre style={styles.outputPreview}>
                  {selectedTask.output.response.slice(0, 500)}
                  {selectedTask.output.response.length > 500 && '...'}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0a0a0a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#e5e5e5',
    margin: 0,
  },
  legend: {
    display: 'flex',
    gap: 12,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  legendLabel: {
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
  },
  diagramContainer: {
    position: 'relative',
    overflowX: 'auto',
    minHeight: 200,
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    pointerEvents: 'none',
  },
  nodesContainer: {
    position: 'relative',
    minHeight: 200,
  },
  node: {
    position: 'absolute',
    width: 140,
    background: '#1a1a1a',
    border: '2px solid',
    borderRadius: 10,
    padding: 12,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  nodeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  roleIcon: {
    fontSize: 16,
  },
  roleName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#e5e5e5',
  },
  nodeStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    fontWeight: 500,
  },
  stateIcon: {
    fontSize: 12,
  },
  nodeTokens: {
    fontSize: 9,
    color: '#666',
    marginTop: 4,
  },
  pulsingDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#f59e0b',
    animation: 'pulse 1.5s infinite',
  },
  emptyState: {
    textAlign: 'center',
    padding: 40,
    color: '#666',
  },
  emptyIcon: {
    fontSize: 32,
    display: 'block',
    marginBottom: 12,
  },
  taskDetail: {
    background: '#111',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    border: '1px solid #333',
  },
  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: '1px solid #333',
  },
  detailIcon: {
    fontSize: 20,
  },
  detailTitle: {
    flex: 1,
    margin: 0,
    fontSize: 14,
    color: '#e5e5e5',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: 14,
  },
  detailContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  detailRow: {
    display: 'flex',
    gap: 8,
    fontSize: 12,
  },
  detailLabel: {
    color: '#888',
    minWidth: 80,
  },
  detailCode: {
    background: '#1a1a1a',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    color: '#93c5fd',
  },
  detailOutput: {
    marginTop: 8,
  },
  outputPreview: {
    background: '#1a1a1a',
    padding: 12,
    borderRadius: 6,
    fontSize: 11,
    color: '#a5a5a5',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: 150,
    overflow: 'auto',
    margin: '8px 0 0 0',
  },
};

// Add CSS animation for pulsing dot
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.2); }
    100% { opacity: 1; transform: scale(1); }
  }
`;
document.head.appendChild(styleSheet);
