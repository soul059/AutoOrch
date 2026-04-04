import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Props {
  runId: string;
}

export function BudgetMonitor({ runId }: Props) {
  const [run, setRun] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const [r, t] = await Promise.all([api.getRun(runId), api.listTasks(runId)]);
      setRun(r);
      setTasks(t);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [runId]);

  if (!run) return null;

  const budget = run.budget_limit || { maxTokens: 100000, maxCostUsd: 10, maxLoopIterations: 50 };
  const totalTokens = tasks.reduce((sum: number, t: any) => sum + (t.token_usage?.totalTokens || 0), 0);
  const totalCost = tasks.reduce((sum: number, t: any) => sum + (t.token_usage?.costUsd || 0), 0);
  const iterations = tasks.filter((t: any) => ['SUCCEEDED', 'FAILED'].includes(t.state)).length;

  const tokenPct = Math.min((totalTokens / budget.maxTokens) * 100, 100);
  const costPct = Math.min((totalCost / budget.maxCostUsd) * 100, 100);
  const loopPct = Math.min((iterations / budget.maxLoopIterations) * 100, 100);

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Budget Monitor</h3>
      <div style={styles.meters}>
        <Meter label="Tokens" value={totalTokens} max={budget.maxTokens} pct={tokenPct} />
        <Meter label="Cost" value={`$${(totalCost ?? 0).toFixed(4)}`} max={`$${budget.maxCostUsd}`} pct={costPct} />
        <Meter label="Iterations" value={iterations} max={budget.maxLoopIterations} pct={loopPct} />
      </div>
    </div>
  );
}

function Meter({ label, value, max, pct }: { label: string; value: any; max: any; pct: number }) {
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
  return (
    <div style={styles.meter}>
      <div style={styles.meterHeader}>
        <span style={styles.meterLabel}>{label}</span>
        <span style={styles.meterValue}>{value} / {max}</span>
      </div>
      <div style={styles.bar}>
        <div style={{ ...styles.barFill, width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 16, marginBottom: 16 },
  title: { fontSize: 16, marginBottom: 12, color: '#e5e5e5' },
  meters: { display: 'flex', flexDirection: 'column', gap: 12 },
  meter: {},
  meterHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  meterLabel: { color: '#aaa', fontSize: 12 },
  meterValue: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  bar: { height: 8, background: '#222', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },
};
