import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

interface AgentBudgetStats {
  role: string;
  totalTokens: number;
  totalCost: number;
  taskCount: number;
  avgTokensPerTask: number;
  avgCostPerTask: number;
  lastUsed: string | null;
}

interface Props {
  runId?: string; // If provided, show stats for specific run; otherwise show global
}

export function AgentBudgetDashboard({ runId }: Props) {
  const [budgetStats, setBudgetStats] = useState<AgentBudgetStats[]>([]);
  const [totalBudget, setTotalBudget] = useState({ tokens: 100000, cost: 10.0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBudgetStats();
    const interval = setInterval(loadBudgetStats, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [runId]);

  const loadBudgetStats = async () => {
    try {
      // Get tasks to calculate per-agent stats
      let tasks: any[] = [];

      if (runId) {
        tasks = await api.listTasks(runId);
        const run = await api.getRun(runId);
        if (run.budget_limit) {
          setTotalBudget({
            tokens: run.budget_limit.maxTokens || 100000,
            cost: run.budget_limit.maxCostUsd || 10.0,
          });
        }
      } else {
        // Get global stats from all runs
        const runs = await api.listRuns();
        for (const run of runs.slice(0, 20)) { // Last 20 runs
          try {
            const runTasks = await api.listTasks(run.id);
            tasks.push(...runTasks);
          } catch (e) {
            // Run may not have tasks yet
          }
        }
      }

      // Group by agent role
      const statsByRole = new Map<string, AgentBudgetStats>();

      for (const task of tasks) {
        if (!task.agent_role) continue;

        const existing = statsByRole.get(task.agent_role) || {
          role: task.agent_role,
          totalTokens: 0,
          totalCost: 0,
          taskCount: 0,
          avgTokensPerTask: 0,
          avgCostPerTask: 0,
          lastUsed: null,
        };

        const tokens = task.token_usage?.totalTokens || 0;
        const cost = task.token_usage?.costUsd || 0;

        existing.totalTokens += tokens;
        existing.totalCost += cost;
        existing.taskCount += 1;

        if (!existing.lastUsed || new Date(task.updated_at) > new Date(existing.lastUsed)) {
          existing.lastUsed = task.updated_at;
        }

        statsByRole.set(task.agent_role, existing);
      }

      // Calculate averages
      for (const stats of statsByRole.values()) {
        if (stats.taskCount > 0) {
          stats.avgTokensPerTask = Math.round(stats.totalTokens / stats.taskCount);
          stats.avgCostPerTask = stats.totalCost / stats.taskCount;
        }
      }

      // Sort by total tokens descending
      const sortedStats = Array.from(statsByRole.values())
        .sort((a, b) => b.totalTokens - a.totalTokens);

      setBudgetStats(sortedStats);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalUsedTokens = budgetStats.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalUsedCost = budgetStats.reduce((sum, s) => sum + s.totalCost, 0);
  const tokenPercentage = Math.min(100, (totalUsedTokens / totalBudget.tokens) * 100);
  const costPercentage = Math.min(100, (totalUsedCost / totalBudget.cost) * 100);

  const ROLE_COLORS: Record<string, string> = {
    PLANNER: '#a855f7',
    RESEARCHER: '#3b82f6',
    BUILDER: '#22c55e',
    REVIEWER: '#f59e0b',
    OPERATIONS: '#ef4444',
  };

  const ROLE_ICONS: Record<string, string> = {
    PLANNER: '📋',
    RESEARCHER: '🔍',
    BUILDER: '🔧',
    REVIEWER: '👁️',
    OPERATIONS: '⚙️',
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading budget data...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          {runId ? 'Run Budget' : 'Agent Budget Dashboard'}
        </h3>
        <span style={styles.subtitle}>
          {runId ? 'Per-agent usage for this run' : 'Global usage across all runs'}
        </span>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Overall budget bars */}
      <div style={styles.overallSection}>
        <div style={styles.budgetBar}>
          <div style={styles.barHeader}>
            <span style={styles.barLabel}>Tokens</span>
            <span style={styles.barValue}>
              {totalUsedTokens.toLocaleString()} / {totalBudget.tokens.toLocaleString()}
            </span>
          </div>
          <div style={styles.barTrack}>
            <div
              style={{
                ...styles.barFill,
                width: `${tokenPercentage}%`,
                backgroundColor: tokenPercentage > 80 ? '#ef4444' : tokenPercentage > 60 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
        </div>

        <div style={styles.budgetBar}>
          <div style={styles.barHeader}>
            <span style={styles.barLabel}>Cost (USD)</span>
            <span style={styles.barValue}>
              ${(totalUsedCost ?? 0).toFixed(4)} / ${(totalBudget?.cost ?? 0).toFixed(2)}
            </span>
          </div>
          <div style={styles.barTrack}>
            <div
              style={{
                ...styles.barFill,
                width: `${costPercentage}%`,
                backgroundColor: costPercentage > 80 ? '#ef4444' : costPercentage > 60 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
        </div>
      </div>

      {/* Per-agent breakdown */}
      <div style={styles.agentSection}>
        <h4 style={styles.sectionTitle}>Per-Agent Breakdown</h4>

        {budgetStats.length === 0 ? (
          <div style={styles.emptyState}>No agent activity recorded yet</div>
        ) : (
          <div style={styles.agentGrid}>
            {budgetStats.map((stats) => {
              const color = ROLE_COLORS[stats.role] || '#6b7280';
              const icon = ROLE_ICONS[stats.role] || '🤖';
              const roleTokenPercentage = totalUsedTokens > 0
                ? (stats.totalTokens / totalUsedTokens) * 100
                : 0;

              return (
                <div key={stats.role} style={styles.agentCard}>
                  <div style={styles.agentHeader}>
                    <span style={styles.agentIcon}>{icon}</span>
                    <span style={styles.agentRole}>{stats.role}</span>
                    <span style={{ ...styles.agentBadge, backgroundColor: color }}>
                      {(roleTokenPercentage ?? 0).toFixed(0)}%
                    </span>
                  </div>

                  <div style={styles.agentStats}>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>Total Tokens</span>
                      <span style={styles.statValue}>{stats.totalTokens.toLocaleString()}</span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>Total Cost</span>
                      <span style={styles.statValue}>${(stats.totalCost ?? 0).toFixed(4)}</span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>Tasks Run</span>
                      <span style={styles.statValue}>{stats.taskCount}</span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>Avg Tokens/Task</span>
                      <span style={styles.statValue}>{stats.avgTokensPerTask.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Mini progress bar showing proportion */}
                  <div style={styles.miniBarTrack}>
                    <div
                      style={{
                        ...styles.miniBarFill,
                        width: `${roleTokenPercentage}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cost distribution pie chart (simplified as bars) */}
      {budgetStats.length > 0 && (
        <div style={styles.distributionSection}>
          <h4 style={styles.sectionTitle}>Token Distribution</h4>
          <div style={styles.distributionBar}>
            {budgetStats.map((stats, index) => {
              const percentage = totalUsedTokens > 0
                ? (stats.totalTokens / totalUsedTokens) * 100
                : 0;
              const color = ROLE_COLORS[stats.role] || '#6b7280';

              return (
                <div
                  key={stats.role}
                  style={{
                    ...styles.distributionSegment,
                    width: `${percentage}%`,
                    backgroundColor: color,
                    borderRadius: index === 0 ? '4px 0 0 4px' : index === budgetStats.length - 1 ? '0 4px 4px 0' : 0,
                  }}
                  title={`${stats.role}: ${(percentage ?? 0).toFixed(1)}%`}
                >
                  {percentage > 15 && (
                    <span style={styles.segmentLabel}>{ROLE_ICONS[stats.role]}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={styles.distributionLegend}>
            {budgetStats.map((stats) => (
              <div key={stats.role} style={styles.legendItem}>
                <span
                  style={{
                    ...styles.legendDot,
                    backgroundColor: ROLE_COLORS[stats.role] || '#6b7280',
                  }}
                />
                <span style={styles.legendLabel}>{stats.role}</span>
              </div>
            ))}
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
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#e5e5e5',
    margin: 0,
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
  },
  loading: {
    color: '#888',
    padding: 20,
    textAlign: 'center',
  },
  error: {
    color: '#ef4444',
    fontSize: 12,
    padding: 10,
    background: '#1a0a0a',
    borderRadius: 6,
    marginBottom: 16,
  },
  overallSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 24,
    padding: 16,
    background: '#111',
    borderRadius: 8,
  },
  budgetBar: {
    // Wrapper for each budget bar
  },
  barHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barLabel: {
    fontSize: 12,
    color: '#888',
  },
  barValue: {
    fontSize: 12,
    color: '#e5e5e5',
    fontFamily: 'monospace',
  },
  barTrack: {
    height: 8,
    background: '#1a1a1a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
  agentSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: '#888',
    margin: '0 0 12px 0',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  emptyState: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  agentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 12,
  },
  agentCard: {
    background: '#111',
    borderRadius: 8,
    padding: 14,
    border: '1px solid #222',
  },
  agentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  agentIcon: {
    fontSize: 18,
  },
  agentRole: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    color: '#e5e5e5',
  },
  agentBadge: {
    fontSize: 10,
    fontWeight: 600,
    color: 'white',
    padding: '2px 6px',
    borderRadius: 10,
  },
  agentStats: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
  },
  statLabel: {
    color: '#666',
  },
  statValue: {
    color: '#a5a5a5',
    fontFamily: 'monospace',
  },
  miniBarTrack: {
    height: 3,
    background: '#1a1a1a',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
  distributionSection: {
    marginTop: 8,
  },
  distributionBar: {
    display: 'flex',
    height: 24,
    borderRadius: 4,
    overflow: 'hidden',
  },
  distributionSegment: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'width 0.3s ease',
    minWidth: 2,
  },
  segmentLabel: {
    fontSize: 12,
  },
  distributionLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
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
  },
};
