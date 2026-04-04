import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { connected: boolean; latencyMs: number };
  providers: { total: number; healthy: number; degraded: number };
  memory: { heapUsedMB: number; heapTotalMB: number };
  uptime: number;
}

interface SystemStatus {
  runs: Record<string, number>;
  tasks: Record<string, number>;
  approvals: Record<string, number>;
  providers: Array<{ name: string; type: string; model: string; enabled: boolean; healthy: boolean }>;
  auditEventsLastHour: number;
}

interface BudgetReport {
  runs: Array<{
    run_id: string;
    prompt: string;
    state: string;
    budget_limit: number;
    tokens_used: number;
    cost_used: number;
  }>;
  totals: { totalTokens: number; totalCost: number };
}

interface FailureData {
  recentFailures: Array<{
    task_id: string;
    run_id: string;
    error_type: string;
    error_message: string;
    timestamp: string;
  }>;
  failuresByType: Record<string, number>;
}

export function SystemDashboard() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [budget, setBudget] = useState<BudgetReport | null>(null);
  const [failures, setFailures] = useState<FailureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'overview' | 'budget' | 'failures'>('overview');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [healthData, statusData, budgetData, failuresData] = await Promise.all([
        api.getObservabilityHealth().catch(err => {
          console.warn('Health check failed:', err.message);
          return { status: 'unknown', uptime: 0, checks: {}, metrics: {} };
        }),
        api.getObservabilityStatus().catch(err => {
          console.warn('Status check failed:', err.message);
          return { runs: {}, tasks: {}, approvals: {}, providers: [], auditEventsLastHour: 0 };
        }),
        api.getBudgetReport().catch(err => {
          console.warn('Budget report failed:', err.message);
          return { runs: [], totals: { totalTokens: 0, totalCost: 0 } };
        }),
        api.getFailures().catch(err => {
          console.warn('Failures report failed:', err.message);
          return { recentFailures: [], failuresByType: {} };
        }),
      ]);
      setHealth(healthData as any);
      setStatus(statusData as any);
      setBudget(budgetData as any);
      setFailures(failuresData as any);
    } catch (err) {
      console.error('Failed to load observability data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatUptime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading system dashboard...</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>System Dashboard</h2>
        {health && (
          <span style={{
            ...styles.statusBadge,
            background: health.status === 'healthy' ? '#166534' : health.status === 'degraded' ? '#854d0e' : '#991b1b',
          }}>
            {health.status.toUpperCase()}
          </span>
        )}
      </div>

      {/* Navigation */}
      <div style={styles.nav}>
        <button
          style={activeSection === 'overview' ? styles.navActive : styles.navBtn}
          onClick={() => setActiveSection('overview')}
        >Overview</button>
        <button
          style={activeSection === 'budget' ? styles.navActive : styles.navBtn}
          onClick={() => setActiveSection('budget')}
        >Budget</button>
        <button
          style={activeSection === 'failures' ? styles.navActive : styles.navBtn}
          onClick={() => setActiveSection('failures')}
        >Failures</button>
      </div>

      {activeSection === 'overview' && health && status && (
        <>
          {/* Health Metrics */}
          <div style={styles.metricsGrid}>
            <div style={styles.metric}>
              <span style={styles.metricLabel}>Database</span>
              <span style={{
                ...styles.metricValue,
                color: health.database.connected ? '#22c55e' : '#ef4444',
              }}>
                {health.database.connected ? `${health.database.latencyMs}ms` : 'Disconnected'}
              </span>
            </div>
            <div style={styles.metric}>
              <span style={styles.metricLabel}>Providers</span>
              <span style={styles.metricValue}>
                {health.providers.healthy}/{health.providers.total} healthy
              </span>
            </div>
            <div style={styles.metric}>
              <span style={styles.metricLabel}>Memory</span>
              <span style={styles.metricValue}>
                {(health.memory?.heapUsedMB ?? 0).toFixed(0)}MB / {(health.memory?.heapTotalMB ?? 0).toFixed(0)}MB
              </span>
            </div>
            <div style={styles.metric}>
              <span style={styles.metricLabel}>Uptime</span>
              <span style={styles.metricValue}>{formatUptime(health.uptime)}</span>
            </div>
          </div>

          {/* Run/Task Counts */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Runs by State</h3>
            <div style={styles.stateCounts}>
              {Object.entries(status.runs).map(([state, count]) => (
                <div key={state} style={styles.stateItem}>
                  <span style={styles.stateLabel}>{state}</span>
                  <span style={styles.stateCount}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Tasks by State</h3>
            <div style={styles.stateCounts}>
              {Object.entries(status.tasks).map(([state, count]) => (
                <div key={state} style={styles.stateItem}>
                  <span style={styles.stateLabel}>{state}</span>
                  <span style={styles.stateCount}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Providers */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Providers</h3>
            <div style={styles.providerList}>
              {status.providers.map(p => (
                <div key={p.name} style={styles.provider}>
                  <span style={{
                    ...styles.healthDot,
                    background: p.healthy ? '#22c55e' : '#ef4444',
                  }} />
                  <span style={styles.providerName}>{p.name}</span>
                  <span style={styles.providerType}>{p.type}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeSection === 'budget' && budget && (
        <div style={styles.section}>
          <div style={styles.totals}>
            <div style={styles.totalItem}>
              <span style={styles.totalLabel}>Total Tokens</span>
              <span style={styles.totalValue}>{budget.totals.totalTokens.toLocaleString()}</span>
            </div>
            <div style={styles.totalItem}>
              <span style={styles.totalLabel}>Total Cost</span>
              <span style={styles.totalValue}>${(budget.totals?.totalCost ?? 0).toFixed(4)}</span>
            </div>
          </div>

          <h3 style={styles.sectionTitle}>Active Runs Budget</h3>
          {budget.runs.length === 0 ? (
            <p style={styles.empty}>No active runs</p>
          ) : (
            <div style={styles.budgetList}>
              {budget.runs.map(run => {
                const usagePercent = run.budget_limit > 0 ? (run.cost_used / run.budget_limit) * 100 : 0;
                return (
                  <div key={run.run_id} style={styles.budgetItem}>
                    <div style={styles.budgetHeader}>
                      <span style={styles.runId}>{run.run_id.slice(0, 8)}</span>
                      <span style={styles.runState}>{run.state}</span>
                    </div>
                    <p style={styles.prompt}>{run.prompt?.slice(0, 50)}...</p>
                    <div style={styles.budgetBar}>
                      <div style={{
                        ...styles.budgetFill,
                        width: `${Math.min(usagePercent, 100)}%`,
                        background: usagePercent > 80 ? '#ef4444' : usagePercent > 50 ? '#f59e0b' : '#22c55e',
                      }} />
                    </div>
                    <div style={styles.budgetMeta}>
                      <span>${(run.cost_used ?? 0).toFixed(4)} / ${(run.budget_limit ?? 0).toFixed(2)}</span>
                      <span>{(run.tokens_used ?? 0).toLocaleString()} tokens</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeSection === 'failures' && failures && (
        <div style={styles.section}>
          {/* Failure by Type */}
          <h3 style={styles.sectionTitle}>Failures by Type</h3>
          <div style={styles.failureTypes}>
            {Object.entries(failures.failuresByType).map(([type, count]) => (
              <div key={type} style={styles.failureType}>
                <span style={styles.failureTypeLabel}>{type}</span>
                <span style={styles.failureTypeCount}>{count}</span>
              </div>
            ))}
          </div>

          {/* Recent Failures */}
          <h3 style={styles.sectionTitle}>Recent Failures</h3>
          {failures.recentFailures.length === 0 ? (
            <p style={styles.empty}>No recent failures</p>
          ) : (
            <div style={styles.failureList}>
              {failures.recentFailures.slice(0, 10).map((f, i) => (
                <div key={i} style={styles.failureItem}>
                  <div style={styles.failureHeader}>
                    <span style={styles.failureTaskId}>Task: {f.task_id.slice(0, 8)}</span>
                    <span style={styles.failureErrorType}>{f.error_type}</span>
                  </div>
                  <p style={styles.failureMsg}>{f.error_message}</p>
                  <span style={styles.failureTime}>
                    {new Date(f.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, color: '#e5e5e5', margin: 0 },
  statusBadge: {
    color: 'white', padding: '4px 12px', borderRadius: 12,
    fontSize: 11, fontWeight: 700,
  },
  loading: { color: '#666', fontSize: 14 },
  nav: { display: 'flex', gap: 6, marginBottom: 20 },
  navBtn: {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
    padding: '6px 14px', fontSize: 13, color: '#888', cursor: 'pointer',
  },
  navActive: {
    background: '#2563eb', border: '1px solid #2563eb', borderRadius: 4,
    padding: '6px 14px', fontSize: 13, color: 'white', cursor: 'pointer',
  },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 },
  metric: {
    background: '#1a1a1a', borderRadius: 6, padding: 14, textAlign: 'center' as const,
  },
  metricLabel: { display: 'block', color: '#666', fontSize: 12, marginBottom: 4 },
  metricValue: { display: 'block', color: '#e5e5e5', fontSize: 16, fontWeight: 600 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, color: '#888', marginBottom: 10 },
  stateCounts: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  stateItem: {
    background: '#1a1a1a', borderRadius: 4, padding: '6px 12px',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  stateLabel: { color: '#888', fontSize: 12, textTransform: 'uppercase' as const },
  stateCount: { color: '#e5e5e5', fontSize: 14, fontWeight: 600 },
  providerList: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  provider: { display: 'flex', alignItems: 'center', gap: 8 },
  healthDot: { width: 8, height: 8, borderRadius: '50%' },
  providerName: { color: '#e5e5e5', fontSize: 13 },
  providerType: { color: '#666', fontSize: 11 },
  totals: { display: 'flex', gap: 20, marginBottom: 16 },
  totalItem: { background: '#1a1a1a', borderRadius: 6, padding: 14, flex: 1 },
  totalLabel: { display: 'block', color: '#666', fontSize: 12, marginBottom: 4 },
  totalValue: { display: 'block', color: '#22c55e', fontSize: 20, fontWeight: 600 },
  empty: { color: '#666', fontSize: 13 },
  budgetList: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  budgetItem: { background: '#1a1a1a', borderRadius: 6, padding: 12 },
  budgetHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  runId: { color: '#e5e5e5', fontSize: 13, fontWeight: 600 },
  runState: { color: '#888', fontSize: 11, textTransform: 'uppercase' as const },
  prompt: { color: '#666', fontSize: 12, marginBottom: 8 },
  budgetBar: { background: '#333', borderRadius: 2, height: 6, marginBottom: 6 },
  budgetFill: { height: '100%', borderRadius: 2, transition: 'width 0.3s' },
  budgetMeta: { display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: 11 },
  failureTypes: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 16 },
  failureType: {
    background: '#7f1d1d', borderRadius: 4, padding: '6px 12px',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  failureTypeLabel: { color: '#fca5a5', fontSize: 12 },
  failureTypeCount: { color: '#fff', fontSize: 14, fontWeight: 600 },
  failureList: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  failureItem: { background: '#1a1a1a', borderRadius: 6, padding: 10, border: '1px solid #333' },
  failureHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  failureTaskId: { color: '#e5e5e5', fontSize: 12 },
  failureErrorType: {
    background: '#7f1d1d', color: '#fca5a5', padding: '2px 6px',
    borderRadius: 3, fontSize: 10,
  },
  failureMsg: { color: '#ef4444', fontSize: 11, fontFamily: 'monospace', marginBottom: 4 },
  failureTime: { color: '#666', fontSize: 10 },
};
