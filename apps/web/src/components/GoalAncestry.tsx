import React, { useState, useEffect } from 'react';
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
}

interface Run {
  id: string;
  prompt: string;
  state: string;
  workflow_template_id?: string;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  agent_sequence: string[];
}

interface Props {
  task: Task;
  run?: Run;
  allTasks: Task[];
}

export function GoalAncestry({ task, run, allTasks }: Props) {
  const [workflow, setWorkflow] = useState<WorkflowTemplate | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (run?.workflow_template_id) {
      loadWorkflow(run.workflow_template_id);
    }
  }, [run?.workflow_template_id]);

  const loadWorkflow = async (workflowId: string) => {
    try {
      const wf = await api.getWorkflowTemplate(workflowId);
      setWorkflow(wf);
    } catch (err) {
      console.error('Failed to load workflow:', err);
    }
  };

  // Build the ancestry chain
  const buildAncestryChain = (): Array<{ level: number; type: string; label: string; description: string }> => {
    const chain: Array<{ level: number; type: string; label: string; description: string }> = [];

    // Level 1: The overall goal (run prompt)
    if (run) {
      chain.push({
        level: 1,
        type: 'goal',
        label: 'Mission',
        description: run.prompt.length > 100 ? run.prompt.slice(0, 100) + '...' : run.prompt,
      });
    }

    // Level 2: The workflow/strategy
    if (workflow) {
      chain.push({
        level: 2,
        type: 'workflow',
        label: 'Strategy',
        description: `${workflow.name}: ${workflow.agent_sequence.join(' → ')}`,
      });
    } else if (run) {
      chain.push({
        level: 2,
        type: 'workflow',
        label: 'Strategy',
        description: 'Default single-agent workflow',
      });
    }

    // Level 3: The task's role in the workflow
    const roleDescription = getRoleDescription(task.agent_role, task.sequence_index, allTasks.length);
    chain.push({
      level: 3,
      type: 'phase',
      label: `Phase ${task.sequence_index + 1}`,
      description: roleDescription,
    });

    // Level 4: The specific task
    chain.push({
      level: 4,
      type: 'task',
      label: task.agent_role,
      description: getTaskDescription(task),
    });

    return chain;
  };

  const getRoleDescription = (role: string, index: number, total: number): string => {
    const roleDescriptions: Record<string, string> = {
      PLANNER: 'Analyze requirements and create execution plan',
      RESEARCHER: 'Gather information and domain knowledge',
      BUILDER: 'Implement the solution based on requirements',
      REVIEWER: 'Validate output quality and correctness',
      OPERATIONS: 'Deploy and monitor the solution',
    };
    return roleDescriptions[role] || `Execute ${role} responsibilities (step ${index + 1} of ${total})`;
  };

  const getTaskDescription = (task: Task): string => {
    if (task.input?.prompt) {
      const prompt = task.input.prompt;
      return prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt;
    }
    return `Process input as ${task.agent_role}`;
  };

  // Get dependent tasks (depends_on now contains UUIDs)
  const getAncestorTasks = (): Task[] => {
    if (!task.depends_on || task.depends_on.length === 0) return [];
    return task.depends_on
      .map(depId => allTasks.find(t => t.id === depId))
      .filter((t): t is Task => t !== undefined);
  };

  const ancestryChain = buildAncestryChain();
  const ancestorTasks = getAncestorTasks();

  const LEVEL_ICONS: Record<string, string> = {
    goal: '🎯',
    workflow: '📊',
    phase: '📍',
    task: '⚡',
  };

  const LEVEL_COLORS: Record<string, string> = {
    goal: '#a855f7',
    workflow: '#3b82f6',
    phase: '#f59e0b',
    task: '#22c55e',
  };

  return (
    <div style={styles.container}>
      <div
        style={styles.header}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={styles.headerIcon}>🧬</span>
        <span style={styles.headerTitle}>Goal Ancestry</span>
        <span style={styles.expandIcon}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div style={styles.content}>
          {/* Ancestry Chain */}
          <div style={styles.chain}>
            {ancestryChain.map((item, index) => (
              <div key={index} style={styles.chainItem}>
                <div style={styles.chainConnector}>
                  <div
                    style={{
                      ...styles.chainDot,
                      backgroundColor: LEVEL_COLORS[item.type],
                    }}
                  >
                    <span style={styles.chainIcon}>{LEVEL_ICONS[item.type]}</span>
                  </div>
                  {index < ancestryChain.length - 1 && (
                    <div style={styles.chainLine} />
                  )}
                </div>
                <div style={styles.chainContent}>
                  <div style={styles.chainLabel}>
                    <span style={{ color: LEVEL_COLORS[item.type] }}>{item.label}</span>
                  </div>
                  <div style={styles.chainDescription}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Dependencies */}
          {ancestorTasks.length > 0 && (
            <div style={styles.dependencies}>
              <div style={styles.depHeader}>
                <span style={styles.depIcon}>↳</span>
                <span style={styles.depTitle}>Builds on output from:</span>
              </div>
              <div style={styles.depList}>
                {ancestorTasks.map((depTask) => (
                  <div key={depTask.id} style={styles.depItem}>
                    <span style={styles.depRole}>{depTask.agent_role}</span>
                    {depTask.state === 'SUCCEEDED' && (
                      <span style={styles.depStatus}>✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Context summary */}
          <div style={styles.context}>
            <div style={styles.contextHeader}>Why this task exists:</div>
            <p style={styles.contextText}>
              This <strong>{task.agent_role}</strong> task is step {task.sequence_index + 1} of {allTasks.length} in achieving
              the goal: "{run?.prompt?.slice(0, 60)}..."
              {ancestorTasks.length > 0 && (
                <span> It will use context from {ancestorTasks.map(t => t.agent_role).join(', ')}.</span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Simplified inline version for task cards
export function GoalAncestryBadge({ task, run, allTasks }: Props) {
  const getAncestryPath = () => {
    const parts = ['Mission'];
    if (task.sequence_index > 0) {
      parts.push(`Phase ${task.sequence_index}`);
    }
    parts.push(task.agent_role);
    return parts;
  };

  const path = getAncestryPath();

  return (
    <div style={badgeStyles.container}>
      {path.map((part, index) => (
        <React.Fragment key={index}>
          <span style={badgeStyles.part}>{part}</span>
          {index < path.length - 1 && <span style={badgeStyles.separator}>›</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0a0a0a',
    borderRadius: 8,
    border: '1px solid #222',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    cursor: 'pointer',
    background: '#111',
  },
  headerIcon: {
    fontSize: 14,
  },
  headerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    color: '#888',
  },
  expandIcon: {
    fontSize: 10,
    color: '#666',
  },
  content: {
    padding: 14,
  },
  chain: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  chainItem: {
    display: 'flex',
    gap: 12,
  },
  chainConnector: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: 24,
  },
  chainDot: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chainIcon: {
    fontSize: 12,
  },
  chainLine: {
    width: 2,
    flex: 1,
    minHeight: 16,
    background: '#333',
  },
  chainContent: {
    flex: 1,
    paddingBottom: 14,
  },
  chainLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  chainDescription: {
    fontSize: 12,
    color: '#888',
    lineHeight: 1.4,
  },
  dependencies: {
    background: '#111',
    borderRadius: 6,
    padding: 10,
    marginTop: 12,
  },
  depHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  depIcon: {
    color: '#666',
  },
  depTitle: {
    fontSize: 11,
    color: '#666',
  },
  depList: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  depItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: '#1a1a1a',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 11,
  },
  depRole: {
    color: '#93c5fd',
    fontWeight: 500,
  },
  depStatus: {
    color: '#22c55e',
    fontSize: 10,
  },
  context: {
    marginTop: 12,
    padding: 10,
    background: '#111',
    borderRadius: 6,
    borderLeft: '3px solid #3b82f6',
  },
  contextHeader: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  contextText: {
    fontSize: 12,
    color: '#888',
    lineHeight: 1.5,
    margin: 0,
  },
};

const badgeStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    color: '#666',
  },
  part: {
    // Individual part styling
  },
  separator: {
    color: '#444',
  },
};
