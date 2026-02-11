/**
 * CITADEL — Stocks to Invest
 * Comprehensive investment planning page with AI-driven analysis,
 * P/L estimates, market data, and execution controls.
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, type InvestmentPlan } from '../store';

// ── Helpers ──────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : fmt(n);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const SCORE_COLORS: Record<string, string> = {
  STRONG_BUY: 'text-emerald-400',
  BUY: 'text-green-400',
  HOLD: 'text-yellow-400',
  WATCH: 'text-orange-400',
  AVOID: 'text-red-400',
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-green-400',
  MEDIUM: 'text-yellow-400',
  HIGH: 'text-red-400',
  UNKNOWN: 'text-citadel-muted',
};

const SENTIMENT_ICONS: Record<string, string> = {
  Bullish: '🟢',
  Bearish: '🔴',
  Neutral: '⚪',
};

// ── Add Stock Modal ──────────────────────────────────────

function AddStockModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addInvestmentPlan = useStore((s) => s.addInvestmentPlan);
  const [symbol, setSymbol] = useState('');
  const [reason, setReason] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [autoInvest, setAutoInvest] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!symbol.trim()) return;
    setLoading(true);
    await addInvestmentPlan(
      symbol.trim().toUpperCase(),
      reason.trim(),
      maxAmount ? parseFloat(maxAmount) : null,
      autoInvest,
    );
    setLoading(false);
    setSymbol('');
    setReason('');
    setMaxAmount('');
    setAutoInvest(false);
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="bg-citadel-card border border-citadel-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-bold text-citadel-text mb-4">📌 Add Stock to Investment Plan</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-citadel-muted mb-1 block">Stock Symbol *</label>
              <input
                value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. AAPL, NVDA, TSLA"
                className="w-full bg-citadel-bg border border-citadel-border rounded-lg px-3 py-2 text-sm text-citadel-text focus:ring-2 focus:ring-citadel-accent focus:border-transparent outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-citadel-muted mb-1 block">Reason for investing</label>
              <textarea
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Strong earnings, AI growth catalysts..."
                rows={2}
                className="w-full bg-citadel-bg border border-citadel-border rounded-lg px-3 py-2 text-sm text-citadel-text focus:ring-2 focus:ring-citadel-accent focus:border-transparent outline-none resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-citadel-muted mb-1 block">Max investment amount ($)</label>
              <input
                type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="e.g. 5000 (leave blank for no limit)"
                className="w-full bg-citadel-bg border border-citadel-border rounded-lg px-3 py-2 text-sm text-citadel-text focus:ring-2 focus:ring-citadel-accent focus:border-transparent outline-none"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={autoInvest} onChange={(e) => setAutoInvest(e.target.checked)}
                className="w-4 h-4 rounded border-citadel-border text-citadel-accent focus:ring-citadel-accent bg-citadel-bg"
              />
              <span className="text-sm text-citadel-text">Auto-invest when agent recommends BUY</span>
            </label>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-lg border border-citadel-border text-citadel-muted hover:bg-citadel-bg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit} disabled={!symbol.trim() || loading}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-citadel-accent text-white font-semibold hover:bg-citadel-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Analyzing...' : 'Add & Analyze'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Score Gauge ──────────────────────────────────────────

function ScoreGauge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const radius = size === 'sm' ? 28 : 40;
  const stroke = size === 'sm' ? 4 : 6;
  const center = radius + stroke;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color = score >= 70 ? '#34d399' : score >= 55 ? '#22c55e' : score >= 40 ? '#facc15' : score >= 25 ? '#f97316' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center" style={{ width: center * 2, height: center * 2 }}>
      <svg className="transform -rotate-90" width={center * 2} height={center * 2}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        <circle
          cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={circumference - filled}
          strokeLinecap="round" className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`font-bold ${size === 'sm' ? 'text-sm' : 'text-xl'}`} style={{ color }}>{score}</span>
        <span className={`text-citadel-muted ${size === 'sm' ? 'text-[8px]' : 'text-[10px]'}`}>/100</span>
      </div>
    </div>
  );
}

// ── P/L Bar ──────────────────────────────────────────────

function PLBar({ label, pct: pctVal, amount }: { label: string; pct: number; amount: number }) {
  const isPositive = amount >= 0;
  const barWidth = Math.min(Math.abs(pctVal) * 8, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-citadel-muted w-20 text-right">{label}</span>
      <div className="flex-1 h-3 bg-citadel-bg rounded-full overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-700 ${isPositive ? 'bg-green-500/60' : 'bg-red-500/60'}`}
          style={{ width: `${barWidth}%`, marginLeft: isPositive ? '50%' : `${50 - barWidth}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-px h-full bg-citadel-border" />
        </div>
      </div>
      <span className={`w-24 text-right font-mono ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
        {isPositive ? '+' : ''}{fmt(amount)} ({pct(pctVal)})
      </span>
    </div>
  );
}

// ── Stock Investment Card ────────────────────────────────

function InvestCard({ plan, onExecute, onRefresh, onRemove }: {
  plan: InvestmentPlan;
  onExecute: (symbol: string) => void;
  onRefresh: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const a = plan.analysis;
  const m = plan.market_data;
  const ip = plan.investment_plan;
  const pl = plan.pl_estimates;

  return (
    <motion.div
      layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
      className="bg-citadel-card border border-citadel-border rounded-2xl overflow-hidden hover:border-citadel-accent/30 transition-colors"
    >
      {/* Top Row: Symbol, Price, Score */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Symbol & Price */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-xl font-bold text-citadel-text">{plan.symbol}</h3>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                a.recommendation === 'STRONG_BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                a.recommendation === 'BUY' ? 'bg-green-500/20 text-green-400' :
                a.recommendation === 'HOLD' ? 'bg-yellow-500/20 text-yellow-400' :
                a.recommendation === 'WATCH' ? 'bg-orange-500/20 text-orange-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {a.recommendation}
              </span>
              {plan.already_invested && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-semibold">INVESTED</span>
              )}
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold text-citadel-text font-mono">${fmt(m.current_price)}</span>
              <span className={`text-sm font-mono font-semibold ${m.change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {pct(m.change_pct)}
              </span>
              <span className={`text-xs font-mono ${m.change >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                ({m.change >= 0 ? '+' : ''}{fmt(m.change)})
              </span>
            </div>

            {plan.user_reason && (
              <p className="text-xs text-citadel-muted mt-2 italic">"{ plan.user_reason }"</p>
            )}
          </div>

          {/* Right: Score Gauge */}
          <ScoreGauge score={a.composite_score} />
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <MetricBox label="Sentiment" value={`${SENTIMENT_ICONS[a.sentiment_label] || '⚪'} ${a.sentiment_label}`}
            sub={`Score: ${a.sentiment_score >= 0 ? '+' : ''}${a.sentiment_score.toFixed(2)}`} />
          <MetricBox label="Momentum" value={pct(a.momentum)}
            valueColor={a.momentum >= 0 ? 'text-green-400' : 'text-red-400'}
            sub={a.momentum > 0.5 ? 'Uptrend' : a.momentum < -0.5 ? 'Downtrend' : 'Flat'} />
          <MetricBox label="Risk Level" value={a.risk_level}
            valueColor={RISK_COLORS[a.risk_level] || 'text-citadel-muted'}
            sub={`${plan.mention_count} news mention${plan.mention_count !== 1 ? 's' : ''}`} />
          <MetricBox label="Day Range" value={m.day_range}
            sub={`Open: $${fmt(m.open)}`} />
        </div>

        {/* Investment Plan Summary */}
        <div className="mt-4 p-3 bg-citadel-bg/50 rounded-xl border border-citadel-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-citadel-muted uppercase tracking-wider">Investment Plan</span>
            {ip.auto_invest && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-citadel-accent/20 text-citadel-accent font-semibold">AUTO-INVEST</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-[10px] text-citadel-muted block">Est. Investment</span>
              <span className="text-sm font-bold text-citadel-text font-mono">${fmtK(ip.estimated_investment)}</span>
            </div>
            <div>
              <span className="text-[10px] text-citadel-muted block">Est. Shares</span>
              <span className="text-sm font-bold text-citadel-text font-mono">{ip.estimated_shares}</span>
            </div>
            <div>
              <span className="text-[10px] text-citadel-muted block">Portfolio %</span>
              <span className="text-sm font-bold text-citadel-text font-mono">{ip.portfolio_allocation_pct}%</span>
            </div>
            <div>
              <span className="text-[10px] text-citadel-muted block">Max Amount</span>
              <span className="text-sm font-bold text-citadel-text font-mono">
                {ip.max_invest_amount ? `$${fmtK(ip.max_invest_amount)}` : 'No limit'}
              </span>
            </div>
          </div>
        </div>

        {/* P/L Estimates */}
        <div className="mt-4 space-y-1.5">
          <span className="text-xs font-semibold text-citadel-muted uppercase tracking-wider">Estimated P/L Scenarios</span>
          <PLBar label={pl.bull_case.label} pct={pl.bull_case.pct} amount={pl.bull_case.amount} />
          <PLBar label={pl.base_case.label} pct={pl.base_case.pct} amount={pl.base_case.amount} />
          <PLBar label={pl.bear_case.label} pct={pl.bear_case.pct} amount={pl.bear_case.amount} />
        </div>

        {/* Existing Position */}
        {plan.existing_position && (
          <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider block mb-2">Current Position</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-citadel-muted block">Shares</span>
                <span className="text-citadel-text font-mono font-bold">{plan.existing_position.quantity}</span>
              </div>
              <div>
                <span className="text-citadel-muted block">Avg Cost</span>
                <span className="text-citadel-text font-mono font-bold">${fmt(plan.existing_position.avg_cost)}</span>
              </div>
              <div>
                <span className="text-citadel-muted block">Current Value</span>
                <span className="text-citadel-text font-mono font-bold">${fmtK(plan.existing_position.current_value)}</span>
              </div>
              <div>
                <span className="text-citadel-muted block">Unrealized P/L</span>
                <span className={`font-mono font-bold ${plan.existing_position.unrealized_pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {plan.existing_position.unrealized_pl >= 0 ? '+' : ''}{fmt(plan.existing_position.unrealized_pl)}
                  <span className="text-[10px] ml-1">({pct(plan.existing_position.unrealized_pl_pct)})</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Expand Toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-4 py-2 text-xs text-citadel-muted hover:text-citadel-accent transition-colors flex items-center justify-center gap-1"
        >
          {expanded ? '▲ Hide Details' : '▼ Show AI Reasoning, News & Signals'}
        </button>

        {/* Expanded Section */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {/* AI Reasoning */}
              <div className="mt-2 space-y-1">
                <span className="text-xs font-semibold text-citadel-muted uppercase tracking-wider">AI Reasoning</span>
                {a.reasoning.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-citadel-text">
                    <span className="text-citadel-accent mt-0.5">→</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>

              {/* Agent Signals */}
              {plan.agent_signals.length > 0 && (
                <div className="mt-4 space-y-1">
                  <span className="text-xs font-semibold text-citadel-muted uppercase tracking-wider">Agent Signals</span>
                  {plan.agent_signals.map((sig, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 bg-citadel-bg/50 rounded-lg">
                      <span className="text-yellow-400 font-semibold flex-shrink-0">{sig.agent}</span>
                      <span className="text-citadel-text flex-1">{sig.text}</span>
                      {sig.confidence != null && (
                        <span className="text-citadel-muted font-mono flex-shrink-0">{(sig.confidence * 100).toFixed(0)}%</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Related News */}
              {plan.news.length > 0 && (
                <div className="mt-4 space-y-1">
                  <span className="text-xs font-semibold text-citadel-muted uppercase tracking-wider">Related News</span>
                  {plan.news.map((n, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 bg-citadel-bg/50 rounded-lg">
                      <span className="flex-shrink-0">
                        {n.sentiment === 'bullish' ? '🟢' : n.sentiment === 'bearish' ? '🔴' : '⚪'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-citadel-text truncate">{n.title}</p>
                        <p className="text-citadel-muted mt-0.5">{n.source} · {n.score !== 0 ? `Sentiment: ${n.score > 0 ? '+' : ''}${n.score.toFixed(2)}` : 'Neutral'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-4">
          {!plan.already_invested && a.should_invest && (
            <button
              onClick={() => onExecute(plan.symbol)}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-green-600 text-white font-semibold hover:bg-green-500 transition-colors"
            >
              ⚡ Execute Investment
            </button>
          )}
          <button
            onClick={() => onRefresh(plan.symbol)}
            className="px-4 py-2 text-sm rounded-lg border border-citadel-border text-citadel-muted hover:text-citadel-accent hover:border-citadel-accent/50 transition-colors"
          >
            🔄 Refresh
          </button>
          <button
            onClick={() => onRemove(plan.symbol)}
            className="px-4 py-2 text-sm rounded-lg border border-citadel-border text-citadel-muted hover:text-red-400 hover:border-red-400/50 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Metric Box ───────────────────────────────────────────

function MetricBox({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-citadel-bg/50 rounded-lg p-2.5">
      <span className="text-[10px] text-citadel-muted block">{label}</span>
      <span className={`text-sm font-bold ${valueColor || 'text-citadel-text'}`}>{value}</span>
      {sub && <span className="text-[10px] text-citadel-muted block mt-0.5">{sub}</span>}
    </div>
  );
}

// ── Summary Cards ────────────────────────────────────────

function SummaryBar({ plans }: { plans: InvestmentPlansResponse }) {
  const s = plans.summary;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <SummaryCard icon="📊" label="Total Plans" value={String(plans.total)} />
      <SummaryCard icon="💰" label="Planned Investment" value={`$${fmtK(s.total_planned_investment)}`} />
      <SummaryCard icon="✅" label="Buy Signals" value={String(s.buy_signals)} color="text-green-400" />
      <SummaryCard icon="⏸️" label="Hold Signals" value={String(s.hold_signals)} color="text-yellow-400" />
      <SummaryCard icon="💵" label="Available Cash" value={`$${fmtK(s.available_cash)}`} />
      <SummaryCard icon="📅" label="Daily Budget Left" value={`$${fmtK(s.remaining_daily_budget)}`} />
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] text-citadel-muted uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-lg font-bold font-mono ${color || 'text-citadel-text'}`}>{value}</span>
    </div>
  );
}

// ── Import types ─────────────────────────────────────────

import type { InvestmentPlansResponse } from '../store';

// ── Main Page ────────────────────────────────────────────

export default function Invest() {
  const investmentPlans = useStore((s) => s.investmentPlans);
  const fetchInvestmentPlans = useStore((s) => s.fetchInvestmentPlans);
  const executeInvestment = useStore((s) => s.executeInvestment);
  const refreshSuggestion = useStore((s) => s.refreshSuggestion);
  const removeSuggestion = useStore((s) => s.removeSuggestion);
  const addToast = useStore((s) => s.addToast);

  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'buy' | 'hold' | 'invested'>('all');

  useEffect(() => {
    fetchInvestmentPlans();
    const interval = setInterval(fetchInvestmentPlans, 60_000); // refresh every 60s
    return () => clearInterval(interval);
  }, [fetchInvestmentPlans]);

  const handleExecute = useCallback(async (symbol: string) => {
    await executeInvestment(symbol);
    addToast({ type: 'success', title: 'Investment Executed', message: `Successfully invested in ${symbol}` });
  }, [executeInvestment, addToast]);

  const handleRefresh = useCallback(async (symbol: string) => {
    await refreshSuggestion(symbol);
    await fetchInvestmentPlans();
    addToast({ type: 'info', title: 'Refreshed', message: `Re-analyzed ${symbol}` });
  }, [refreshSuggestion, fetchInvestmentPlans, addToast]);

  const handleRemove = useCallback(async (symbol: string) => {
    await removeSuggestion(symbol);
    await fetchInvestmentPlans();
    addToast({ type: 'info', title: 'Removed', message: `Removed ${symbol} from investment plans` });
  }, [removeSuggestion, fetchInvestmentPlans, addToast]);

  const plans = investmentPlans?.plans || [];
  const filtered = plans.filter((p) => {
    if (filter === 'buy') return p.analysis.should_invest;
    if (filter === 'hold') return !p.analysis.should_invest;
    if (filter === 'invested') return p.already_invested;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-citadel-text">📌 Stocks to Invest</h1>
          <p className="text-xs sm:text-sm text-citadel-muted mt-1">
            AI-powered investment planning with real-time analysis, sentiment, and P/L estimates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchInvestmentPlans}
            className="px-3 py-2 text-xs rounded-lg border border-citadel-border text-citadel-muted hover:text-citadel-accent hover:border-citadel-accent/50 transition-colors"
          >
            🔄 Refresh All
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 text-xs rounded-lg bg-citadel-accent text-white font-semibold hover:bg-citadel-accent/80 transition-colors"
          >
            + Add Stock
          </button>
        </div>
      </div>

      {/* Summary */}
      {investmentPlans && investmentPlans.total > 0 && <SummaryBar plans={investmentPlans} />}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {(['all', 'buy', 'hold', 'invested'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              filter === f
                ? 'bg-citadel-accent text-white font-semibold'
                : 'border border-citadel-border text-citadel-muted hover:text-citadel-text'
            }`}
          >
            {f === 'all' ? 'All Plans' : f === 'buy' ? '✅ Buy Signals' : f === 'hold' ? '⏸️ Hold/Watch' : '💼 Invested'}
            {f !== 'all' && (
              <span className="ml-1.5 text-[10px] opacity-70">
                ({plans.filter(p =>
                  f === 'buy' ? p.analysis.should_invest :
                  f === 'hold' ? !p.analysis.should_invest :
                  p.already_invested
                ).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Plans Grid */}
      {filtered.length === 0 ? (
        <div className="bg-citadel-card border border-citadel-border rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">📌</div>
          <h2 className="text-lg font-semibold text-citadel-text mb-2">No investment plans yet</h2>
          <p className="text-sm text-citadel-muted mb-6 max-w-md mx-auto">
            Add stocks you're interested in and let the AI agents analyze them with real-time market data, sentiment analysis, and risk assessment.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="px-6 py-2.5 rounded-lg bg-citadel-accent text-white text-sm font-semibold hover:bg-citadel-accent/80 transition-colors"
          >
            + Add Your First Stock
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((plan) => (
              <InvestCard
                key={plan.symbol}
                plan={plan}
                onExecute={handleExecute}
                onRefresh={handleRefresh}
                onRemove={handleRemove}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add Stock Modal */}
      <AddStockModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
