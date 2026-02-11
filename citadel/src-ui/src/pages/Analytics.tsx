/**
 * CITADEL — Performance Analytics Page
 * Monthly returns heatmap, drawdown chart, win/loss streaks, advanced ratios.
 */
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import { useStore } from '../store';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Components ──────────────────────────────────────────

function MetricCard({ label, value, suffix = '', color = 'text-citadel-text', small = false }: {
  label: string; value: string | number; suffix?: string; color?: string; small?: boolean;
}) {
  return (
    <div className="bg-citadel-card rounded-xl border border-citadel-border p-4">
      <p className="text-[10px] text-citadel-muted uppercase tracking-wider mb-1">{label}</p>
      <p className={`${small ? 'text-lg' : 'text-2xl'} font-bold ${color} font-mono`}>
        {value}<span className="text-xs text-citadel-muted ml-0.5">{suffix}</span>
      </p>
    </div>
  );
}

function MonthlyReturnsHeatmap() {
  const performance = useStore((s) => s.performance);
  if (!performance) return null;

  // Group by year
  const years = useMemo(() => {
    const map: Record<number, Record<number, number>> = {};
    performance.monthly_returns.forEach(m => {
      if (!map[m.year]) map[m.year] = {};
      map[m.year][m.month] = m.return_pct;
    });
    return Object.entries(map).sort(([a], [b]) => Number(a) - Number(b));
  }, [performance]);

  const getColor = (val: number) => {
    if (val > 5) return 'bg-emerald-500';
    if (val > 3) return 'bg-emerald-500/80';
    if (val > 1) return 'bg-emerald-500/50';
    if (val > 0) return 'bg-emerald-500/25';
    if (val > -1) return 'bg-red-500/25';
    if (val > -3) return 'bg-red-500/50';
    if (val > -5) return 'bg-red-500/80';
    return 'bg-red-500';
  };

  return (
    <div className="bg-citadel-card rounded-2xl border border-citadel-border p-5">
      <h3 className="text-sm font-semibold text-citadel-text mb-4">📅 Monthly Returns Heatmap</h3>

      {/* Month headers */}
      <div className="grid gap-1" style={{ gridTemplateColumns: '56px repeat(12, 1fr)' }}>
        <div />
        {MONTH_NAMES.map(m => (
          <div key={m} className="text-[10px] text-citadel-muted text-center font-mono">{m}</div>
        ))}

        {/* Year rows */}
        {years.map(([year, months]) => (
          <div key={year} className="contents">
            <div className="text-xs text-citadel-muted font-mono flex items-center">{year}</div>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
              const val = months[month];
              const hasVal = val !== undefined;
              return (
                <div
                  key={month}
                  className={`h-9 rounded-lg flex items-center justify-center text-[10px] font-mono font-semibold transition-all hover:scale-105 ${
                    hasVal ? `${getColor(val)} text-white` : 'bg-citadel-surface text-citadel-muted/30'
                  }`}
                  title={hasVal ? `${MONTH_NAMES[month - 1]} ${year}: ${val > 0 ? '+' : ''}${val}%` : ''}
                >
                  {hasVal ? `${val > 0 ? '+' : ''}${val}` : '–'}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1 justify-center">
        <span className="text-[9px] text-citadel-muted">-5%</span>
        {['bg-red-500', 'bg-red-500/60', 'bg-red-500/25', 'bg-emerald-500/25', 'bg-emerald-500/60', 'bg-emerald-500'].map((c, i) => (
          <div key={i} className={`w-4 h-3 rounded-sm ${c}`} />
        ))}
        <span className="text-[9px] text-citadel-muted">+5%</span>
      </div>
    </div>
  );
}

function DrawdownChart() {
  const performance = useStore((s) => s.performance);
  if (!performance) return null;

  return (
    <div className="bg-citadel-card rounded-2xl border border-citadel-border p-5">
      <h3 className="text-sm font-semibold text-citadel-text mb-4">📉 Drawdown Analysis</h3>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={performance.drawdown_series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#6b7280' }}
            tickFormatter={v => v.slice(5)}
            interval={14}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#6b7280' }}
            tickFormatter={v => `${v}%`}
            width={45}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1e3a5f', borderRadius: '12px', fontSize: 11 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: number) => [`${v.toFixed(2)}%`, 'Drawdown']}
          />
          <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 3" />
          <Area type="monotone" dataKey="drawdown_pct" stroke="#ef4444" fill="url(#ddGrad)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EquityChart() {
  const performance = useStore((s) => s.performance);
  if (!performance) return null;

  return (
    <div className="bg-citadel-card rounded-2xl border border-citadel-border p-5">
      <h3 className="text-sm font-semibold text-citadel-text mb-4">💰 Equity Curve (90d)</h3>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={performance.drawdown_series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#00d4ff" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6b7280' }} tickFormatter={v => v.slice(5)} interval={14} />
          <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={50} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1e3a5f', borderRadius: '12px', fontSize: 11 }}
            formatter={(v: number) => [`$${v.toLocaleString()}`, 'Equity']}
          />
          <Area type="monotone" dataKey="equity" stroke="#00d4ff" fill="url(#eqGrad)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StreaksChart() {
  const performance = useStore((s) => s.performance);
  if (!performance) return null;

  const data = performance.streaks.map((s, i) => ({
    idx: i + 1,
    length: s.type === 'win' ? s.length : -s.length,
    pnl: s.pnl,
    type: s.type,
  }));

  return (
    <div className="bg-citadel-card rounded-2xl border border-citadel-border p-5">
      <h3 className="text-sm font-semibold text-citadel-text mb-4">🔥 Win/Loss Streaks</h3>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
          <XAxis dataKey="idx" tick={{ fontSize: 9, fill: '#6b7280' }} label={{ value: 'Streak #', position: 'insideBottom', offset: -2, fontSize: 9, fill: '#6b7280' }} />
          <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} label={{ value: 'Length', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#6b7280' }} />
          <ReferenceLine y={0} stroke="#4b5563" />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1e3a5f', borderRadius: '12px', fontSize: 11 }}
            formatter={(v: number) => [`${Math.abs(v)} trades`, 'Streak']}
          />
          <Bar dataKey="length" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.type === 'win' ? '#10b981' : '#ef4444'} opacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Streak summary */}
      <div className="mt-3 flex gap-4 justify-center">
        {(() => {
          const wins = performance.streaks.filter(s => s.type === 'win');
          const losses = performance.streaks.filter(s => s.type === 'loss');
          const maxWin = wins.length ? Math.max(...wins.map(s => s.length)) : 0;
          const maxLoss = losses.length ? Math.max(...losses.map(s => s.length)) : 0;
          return (
            <>
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-400 font-mono">{maxWin}</p>
                <p className="text-[10px] text-citadel-muted">Max Win Streak</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-red-400 font-mono">{maxLoss}</p>
                <p className="text-[10px] text-citadel-muted">Max Loss Streak</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-citadel-accent font-mono">{performance.streaks.length}</p>
                <p className="text-[10px] text-citadel-muted">Total Streaks</p>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function Analytics() {
  const fetchPerformance = useStore((s) => s.fetchPerformance);
  const performance = useStore((s) => s.performance);

  useEffect(() => { fetchPerformance(); }, [fetchPerformance]);

  if (!performance) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-citadel-text mb-4">📈 Performance Analytics</h1>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-citadel-card border border-citadel-border skeleton" />
          ))}
        </div>
      </div>
    );
  }

  const m = performance.metrics;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-citadel-text">📈 Performance Analytics</h1>
          <p className="text-xs text-citadel-muted mt-1">Advanced metrics and portfolio analysis</p>
        </div>
        <button
          onClick={fetchPerformance}
          className="px-3 py-1.5 text-xs rounded-lg border border-citadel-border text-citadel-muted hover:text-citadel-accent hover:border-citadel-accent/30 transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      {/* KPI Row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3"
      >
        <MetricCard label="Sortino Ratio"   value={m.sortino_ratio}  color={m.sortino_ratio > 1 ? 'text-emerald-400' : 'text-red-400'} />
        <MetricCard label="Calmar Ratio"    value={m.calmar_ratio}   color={m.calmar_ratio > 1 ? 'text-emerald-400' : 'text-red-400'} />
        <MetricCard label="Profit Factor"   value={m.profit_factor}  color={m.profit_factor > 1 ? 'text-emerald-400' : 'text-red-400'} />
        <MetricCard label="Win/Loss Ratio"  value={m.win_loss_ratio} color="text-citadel-accent" />
        <MetricCard label="Best Month"      value={`+${m.best_month}`} suffix="%" color="text-emerald-400" small />
        <MetricCard label="Worst Month"     value={m.worst_month}    suffix="%" color="text-red-400" small />
      </motion.div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Max Drawdown"     value={m.max_drawdown_pct}  suffix="%" color="text-red-400" small />
        <MetricCard label="Recovery Factor"  value={m.recovery_factor}   color="text-citadel-accent" small />
        <MetricCard label="Total Trades"     value={m.total_trades}      color="text-citadel-text" small />
        <MetricCard label="Winning Months"   value={m.winning_months}    color="text-emerald-400" small />
        <MetricCard label="Losing Months"    value={m.losing_months}     color="text-red-400" small />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MonthlyReturnsHeatmap />
        <DrawdownChart />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EquityChart />
        <StreaksChart />
      </div>

      {/* Win/Loss Distribution */}
      <div className="bg-citadel-card rounded-2xl border border-citadel-border p-5">
        <h3 className="text-sm font-semibold text-citadel-text mb-4">📊 Win/Loss Distribution</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex gap-0.5 h-6 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${(m.winning_months / (m.winning_months + m.losing_months)) * 100}%` }}
              />
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${(m.losing_months / (m.winning_months + m.losing_months)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-emerald-400">{m.winning_months} wins ({((m.winning_months / (m.winning_months + m.losing_months)) * 100).toFixed(0)}%)</span>
              <span className="text-red-400">{m.losing_months} losses ({((m.losing_months / (m.winning_months + m.losing_months)) * 100).toFixed(0)}%)</span>
            </div>
          </div>

          <div className="flex gap-4 ml-4">
            <div className="text-center">
              <p className="text-sm font-bold text-emerald-400 font-mono">+{m.avg_win}%</p>
              <p className="text-[10px] text-citadel-muted">Avg Win</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-red-400 font-mono">{m.avg_loss}%</p>
              <p className="text-[10px] text-citadel-muted">Avg Loss</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
