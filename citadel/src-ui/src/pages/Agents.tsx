/**
 * CITADEL — Agents Page (Full-Featured)
 *
 * Agent swarm overview with:
 *   - Agent cards with model, version, capabilities, config, properties
 *   - Expandable metrics, uptime bars, lesson timeline
 *   - Agent detail modal with full property inspector
 *   - Strategy weights visualization
 *   - Training history per agent
 *   - Filter by status
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { useStore, type AgentStatus, type AgentDetail } from '../store';

// ── Agent metadata ────────────────────────────────────────

const AGENT_INFO: Record<string, { role: string; icon: string; color: string; gradient: string; desc: string; model: string }> = {
  Sentinel: {
    role: 'Risk Guardian', icon: '🛡️', color: 'border-citadel-danger',
    gradient: 'from-red-500/20 to-orange-500/20',
    desc: 'Monitors portfolio risk, enforces limits, triggers kill switches',
    model: 'Rule-based + Statistical',
  },
  Librarian: {
    role: 'Market Intelligence', icon: '📚', color: 'border-citadel-accent',
    gradient: 'from-cyan-500/20 to-blue-500/20',
    desc: 'Aggregates news, runs NLP sentiment, manages vector knowledge base',
    model: 'FinBERT + MiniLM-L6-v2',
  },
  Tactician: {
    role: 'Trading Logic', icon: '🎯', color: 'border-citadel-success',
    gradient: 'from-green-500/20 to-emerald-500/20',
    desc: 'Generates buy/sell signals using multi-strategy ensemble',
    model: 'Multi-Strategy Ensemble',
  },
  Student: {
    role: 'Self-Correction', icon: '🧠', color: 'border-citadel-warning',
    gradient: 'from-yellow-500/20 to-amber-500/20',
    desc: 'Learns from mistakes via LoRA fine-tuning, adapts strategy weights',
    model: 'LoRA Adapter (Rank-4)',
  },
};

const CHART_COLORS = ['#00d4ff', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];

type StatusFilter = 'ALL' | 'ACTIVE' | 'IDLE' | 'ERROR';

// ── Main Component ────────────────────────────────────────

export function Agents() {
  const agents = useStore(s => s.agents);
  const agentDetails = useStore(s => s.agentDetails);
  const fetchAgentDetails = useStore(s => s.fetchAgentDetails);
  const fetchAgents = useStore(s => s.fetchAgents);

  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [inspectAgent, setInspectAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'compare'>('overview');

  // Build entries — either real or defaults
  const entries = Object.entries(agents).length > 0
    ? Object.entries(agents)
    : Object.keys(AGENT_INFO).map(n => [n, { status: 'IDLE' }] as [string, Record<string, unknown>]);

  const filteredEntries = entries.filter(([, d]) => {
    const status = (d as Record<string, string>).status || 'IDLE';
    if (filter === 'ALL') return true;
    if (filter === 'ACTIVE') return status === 'ACTIVE' || status === 'running';
    if (filter === 'ERROR') return status === 'ERROR' || status === 'error';
    return status !== 'ACTIVE' && status !== 'running' && status !== 'ERROR' && status !== 'error';
  });

  const activeCount = entries.filter(([, d]) => {
    const s = (d as Record<string, string>).status || '';
    return s === 'ACTIVE' || s === 'running';
  }).length;

  // Fetch agent details when inspecting
  const handleInspect = useCallback((name: string) => {
    setInspectAgent(name);
    fetchAgentDetails(name);
  }, [fetchAgentDetails]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold">Agent Swarm</h2>
          <p className="text-xs text-citadel-muted mt-0.5">{activeCount} / {entries.length} active agents</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex gap-1 mr-2">
            {(['overview', 'compare'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-[10px] sm:text-xs font-medium rounded-lg transition-colors ${activeTab === t
                  ? 'bg-citadel-accent/15 text-citadel-accent'
                  : 'text-citadel-muted hover:text-citadel-text hover:bg-white/5'}`}>
                {t === 'overview' ? '📋 Overview' : '📊 Compare'}
              </button>
            ))}
          </div>
          {/* Status filter pills */}
          <div className="flex gap-1">
            {(['ALL', 'ACTIVE', 'IDLE', 'ERROR'] as StatusFilter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors ${filter === f
                  ? 'bg-citadel-accent/15 text-citadel-accent'
                  : 'text-citadel-muted hover:text-citadel-accent hover:bg-citadel-accent/10'
                }`}>{f}</button>
            ))}
          </div>
          <button onClick={() => fetchAgents()} className="text-xs text-citadel-accent hover:underline ml-1">↻</button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' ? (
          <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {filteredEntries.map(([name, data]) => (
              <AgentCard key={name} name={name} data={data as AgentStatus} onInspect={handleInspect} />
            ))}
          </motion.div>
        ) : (
          <motion.div key="compare" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
            <AgentComparisonView entries={entries} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent Detail Modal */}
      <AnimatePresence>
        {inspectAgent && (
          <AgentDetailModal
            name={inspectAgent}
            detail={agentDetails[inspectAgent] || null}
            onClose={() => setInspectAgent(null)}
            onRetry={fetchAgentDetails}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Agent Card ────────────────────────────────────────────

function AgentCard({ name, data, onInspect }: { name: string; data: AgentStatus | Record<string, unknown>; onInspect: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const info = AGENT_INFO[name] || { role: 'Agent', icon: '🤖', color: 'border-citadel-border', gradient: 'from-gray-500/20 to-gray-500/20', desc: '', model: 'Unknown' };
  const status = (data as Record<string, string>).status || 'IDLE';
  const uptime = (data as AgentStatus).uptime;
  const metrics = (data as AgentStatus).metrics;
  const analysis = (data as AgentStatus).analysis;
  const lessons = (data as AgentStatus).lessons;

  return (
    <motion.div layout className={`bg-citadel-card border-l-4 ${info.color} border border-citadel-border rounded-xl overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center">
        <button onClick={() => setExpanded(!expanded)} className="flex-1 p-3 sm:p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="text-xl sm:text-2xl">{info.icon}</span>
            <div className="text-left min-w-0">
              <div className="font-medium text-sm sm:text-base">{name}</div>
              <div className="text-[10px] sm:text-xs text-citadel-muted truncate">{info.role} • {info.model}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${status === 'ACTIVE' || status === 'running'
              ? 'bg-citadel-success/20 text-citadel-success'
              : status === 'ERROR' || status === 'error'
                ? 'bg-citadel-danger/20 text-citadel-danger'
                : 'bg-citadel-muted/20 text-citadel-muted'
            }`}>{status}</div>
            <span className="text-citadel-muted text-sm">{expanded ? '▲' : '▼'}</span>
          </div>
        </button>
        <button onClick={() => onInspect(name)}
          className="px-3 py-2 text-[10px] text-citadel-accent hover:bg-citadel-accent/10 border-l border-citadel-border/50 transition-colors flex-shrink-0"
          title="Inspect agent details"
        >🔍 Details</button>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="p-3 sm:p-4 pt-0 border-t border-citadel-border/50 space-y-3">
              {/* Description */}
              <p className="text-xs text-citadel-muted">{info.desc}</p>

              {/* Model & Version row */}
              <div className={`rounded-lg bg-gradient-to-r ${info.gradient} p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center`}>
                <div>
                  <div className="text-[8px] text-citadel-muted uppercase">Model</div>
                  <div className="text-[10px] sm:text-xs font-mono font-medium">{info.model}</div>
                </div>
                <div>
                  <div className="text-[8px] text-citadel-muted uppercase">Version</div>
                  <div className="text-[10px] sm:text-xs font-mono font-medium">v2.0.0</div>
                </div>
                <div>
                  <div className="text-[8px] text-citadel-muted uppercase">Status</div>
                  <div className={`text-[10px] sm:text-xs font-medium ${status === 'ACTIVE' ? 'text-citadel-success' : status === 'ERROR' ? 'text-citadel-danger' : 'text-citadel-muted'}`}>{status}</div>
                </div>
                <div>
                  <div className="text-[8px] text-citadel-muted uppercase">Uptime</div>
                  <div className="text-[10px] sm:text-xs font-mono font-medium">{uptime ? formatUptime(uptime) : '0s'}</div>
                </div>
              </div>

              {/* Uptime bar */}
              {uptime != null && (
                <div>
                  <div className="text-[10px] text-citadel-muted uppercase mb-1">Uptime (24h)</div>
                  <UptimeBar uptime={uptime} />
                </div>
              )}

              {/* Metrics */}
              {!!metrics && Object.keys(metrics).length > 0 && (
                <div>
                  <div className="text-[10px] text-citadel-muted uppercase mb-1">Performance Metrics</div>
                  <MetricsGrid metrics={metrics} />
                </div>
              )}

              {/* Analysis */}
              {!!analysis && Object.keys(analysis).length > 0 && (
                <div>
                  <div className="text-[10px] text-citadel-muted uppercase mb-1">Analysis Summary</div>
                  <pre className="text-[10px] sm:text-xs font-mono bg-citadel-bg/50 rounded p-2 sm:p-3 overflow-x-auto max-h-40">
                    {JSON.stringify(analysis, null, 2)}
                  </pre>
                </div>
              )}

              {/* Lessons */}
              {!!(lessons && lessons.length > 0) && (
                <div>
                  <div className="text-[10px] text-citadel-muted uppercase mb-1">Lessons Learned ({lessons.length})</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {lessons.map((lesson, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px] sm:text-xs bg-citadel-bg/50 rounded p-2">
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${lesson.severity === 'CRITICAL' ? 'bg-citadel-danger' : lesson.severity === 'WARNING' ? 'bg-citadel-warning' : 'bg-citadel-success'}`} />
                        <span className="text-citadel-muted">{lesson.lesson as string}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Agent Detail Modal ────────────────────────────────────

function AgentDetailModal({ name, detail, onClose, onRetry }: { name: string; detail: AgentDetail | null; onClose: () => void; onRetry: (name: string) => void }) {
  const info = AGENT_INFO[name] || { role: 'Agent', icon: '🤖', color: '', gradient: '', desc: '', model: 'Unknown' };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-citadel-card border border-citadel-border rounded-2xl p-5 sm:p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{info.icon}</span>
            <div>
              <h3 className="text-lg font-bold">{name}</h3>
              <p className="text-xs text-citadel-muted">{info.role}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-citadel-muted hover:text-citadel-text text-lg">✕</button>
        </div>

        {!detail ? (
          <div className="text-center py-10 text-citadel-muted">
            <div className="inline-block w-6 h-6 border-2 border-citadel-accent/30 border-t-citadel-accent rounded-full animate-spin mb-3" />
            <div className="text-sm">Loading agent details...</div>
            <button onClick={() => onRetry(name)} className="mt-3 text-xs text-citadel-accent hover:underline">Retry</button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Core properties */}
            <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
              <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Agent Properties</h4>
              <table className="w-full text-xs sm:text-sm">
                <tbody>
                  {([
                    ['Name', detail.name],
                    ['Role', detail.role],
                    ['Model', detail.model],
                    ['Version', detail.version],
                    ['Status', detail.status],
                    ['Uptime', detail.uptime ? formatUptime(detail.uptime) : '0s'],
                    ['Error Count', detail.error_count],
                    ['Last Heartbeat', detail.last_heartbeat ? new Date(detail.last_heartbeat * 1000).toLocaleString() : 'N/A'],
                  ] as [string, string | number][]).map(([k, v]) => (
                    <tr key={k} className="border-b border-citadel-border/30">
                      <td className="py-1.5 pr-4 text-citadel-muted font-medium whitespace-nowrap">{k}</td>
                      <td className="py-1.5 font-mono">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Description */}
            <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
              <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-2">Description</h4>
              <p className="text-sm text-citadel-text/80">{detail.description}</p>
            </div>

            {/* Capabilities */}
            {detail.capabilities && detail.capabilities.length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Capabilities</h4>
                <div className="flex flex-wrap gap-2">
                  {detail.capabilities.map(cap => (
                    <span key={cap} className="px-2.5 py-1 rounded-full bg-citadel-accent/10 text-citadel-accent text-[10px] sm:text-xs font-medium">{cap}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Metrics */}
            {detail.metrics && Object.keys(detail.metrics).length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Metrics</h4>
                <MetricsGrid metrics={detail.metrics} />
              </div>
            )}

            {/* Strategy Weights */}
            {detail.strategy_weights && Object.keys(detail.strategy_weights).length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Strategy Weights</h4>
                <StrategyWeightsChart weights={detail.strategy_weights} />
              </div>
            )}

            {/* Config Values */}
            {detail.config_values && Object.keys(detail.config_values).length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Configuration</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(detail.config_values).map(([k, v]) => (
                    <div key={k} className="bg-citadel-bg/50 rounded p-2">
                      <div className="text-[9px] text-citadel-muted uppercase">{k}</div>
                      <div className="text-xs font-mono">{String(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Training History */}
            {detail.training_history && detail.training_history.length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Training History</h4>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.training_history.map((tr, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] sm:text-xs bg-citadel-bg/50 rounded p-2">
                      <span className="font-mono text-citadel-muted">{(tr.timestamp as string) ? new Date(tr.timestamp as string).toLocaleString() : `Run ${i + 1}`}</span>
                      <div className="flex gap-3">
                        <span>Loss: <span className="font-mono text-citadel-accent">{Number(tr.loss).toFixed(4)}</span></span>
                        <span>Samples: <span className="font-mono">{String(tr.samples)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lessons */}
            {detail.lessons && detail.lessons.length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-3">Lessons Learned ({detail.lessons.length})</h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {detail.lessons.map((lesson, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] sm:text-xs bg-citadel-bg/50 rounded p-2">
                      <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${lesson.severity === 'CRITICAL' ? 'bg-citadel-danger' : lesson.severity === 'WARNING' ? 'bg-citadel-warning' : 'bg-citadel-success'}`} />
                      <div className="min-w-0">
                        <span className="text-citadel-muted">{lesson.lesson as string}</span>
                        <div className="text-[9px] text-citadel-muted/50 mt-0.5">{lesson.category as string} — {lesson.timestamp ? new Date(lesson.timestamp as string).toLocaleTimeString() : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis */}
            {detail.analysis && Object.keys(detail.analysis).length > 0 && (
              <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
                <h4 className="text-xs font-semibold text-citadel-muted uppercase mb-2">Analysis</h4>
                <pre className="text-[10px] font-mono bg-citadel-bg/50 rounded p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(detail.analysis, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Agent Comparison View ─────────────────────────────────

function AgentComparisonView({ entries }: { entries: [string, AgentStatus | Record<string, unknown>][] }) {
  const agentNames = entries.map(([n]) => n);
  const statusData = entries.map(([name, d]) => ({
    name,
    status: (d as Record<string, string>).status === 'ACTIVE' || (d as Record<string, string>).status === 'running' ? 1 : 0,
    uptime: (d as AgentStatus).uptime ? ((d as AgentStatus).uptime! / 3600) : 0,
  }));

  const capabilityData = agentNames.map(name => {
    const info = AGENT_INFO[name];
    return { name, capabilities: info ? 5 : 0 };
  });

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {agentNames.map(name => {
          const info = AGENT_INFO[name] || { icon: '🤖', role: 'Agent', model: 'Unknown', gradient: '' };
          const d = entries.find(([n]) => n === name)?.[1] as Record<string, string>;
          const status = d?.status || 'IDLE';
          return (
            <div key={name} className={`bg-gradient-to-br ${info.gradient || 'from-gray-500/10 to-gray-500/10'} border border-citadel-border rounded-xl p-3 sm:p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{info.icon}</span>
                <span className="text-sm font-semibold">{name}</span>
              </div>
              <div className="text-[10px] text-citadel-muted mb-1">{info.model}</div>
              <span className={`px-2 py-0.5 rounded text-[9px] font-medium ${status === 'ACTIVE' || status === 'running' ? 'bg-citadel-success/20 text-citadel-success' : status === 'ERROR' ? 'bg-citadel-danger/20 text-citadel-danger' : 'bg-citadel-muted/20 text-citadel-muted'}`}>{status}</span>
            </div>
          );
        })}
      </div>

      {/* Uptime comparison chart */}
      <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
        <h4 className="text-xs font-medium text-citadel-muted mb-3">Uptime Comparison (hours)</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusData} layout="vertical" margin={{ left: 10, right: 15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
              <XAxis type="number" stroke="#64748b" fontSize={9} />
              <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={10} width={80} />
              <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
              <Bar dataKey="uptime" fill="#00d4ff" radius={[0, 4, 4, 0]} name="Uptime (h)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent-model mapping */}
      <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
        <h4 className="text-xs font-medium text-citadel-muted mb-3">Agent → Model Mapping</h4>
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-citadel-muted border-b border-citadel-border">
              <th className="text-left py-2 px-2">Agent</th>
              <th className="text-left py-2 px-2">Role</th>
              <th className="text-left py-2 px-2">Model</th>
              <th className="text-left py-2 px-2">Version</th>
            </tr>
          </thead>
          <tbody>
            {agentNames.map(name => {
              const info = AGENT_INFO[name] || { role: '—', model: '—', icon: '🤖' };
              return (
                <tr key={name} className="border-b border-citadel-border/30 hover:bg-citadel-accent/5">
                  <td className="py-2 px-2 font-medium"><span className="mr-2">{info.icon}</span>{name}</td>
                  <td className="py-2 px-2 text-citadel-muted">{info.role}</td>
                  <td className="py-2 px-2 font-mono text-citadel-accent">{info.model}</td>
                  <td className="py-2 px-2 font-mono">v2.0.0</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shared Sub-Components ─────────────────────────────────

function UptimeBar({ uptime }: { uptime?: number }) {
  const hrs = uptime ? (uptime / 3600) : 0;
  const pct = Math.min(100, (hrs / 24) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-citadel-bg rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1 }} className="h-full bg-citadel-accent rounded-full" />
      </div>
      <span className="text-[10px] font-mono text-citadel-muted w-14 text-right">{hrs.toFixed(1)}h</span>
    </div>
  );
}

function MetricsGrid({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics);
  if (!entries.length) return null;
  const numEntries = entries.filter(([, v]) => typeof v === 'number');
  if (numEntries.length >= 3) {
    const data = numEntries.slice(0, 8).map(([k, v]) => ({ name: k, value: v as number }));
    return (
      <div className="h-36 sm:h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis dataKey="name" stroke="#64748b" fontSize={9} interval={0} angle={-20} textAnchor="end" height={35} />
            <YAxis stroke="#64748b" fontSize={9} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey="value" fill="#00d4ff" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-citadel-bg/50 rounded p-2">
          <div className="text-[10px] text-citadel-muted truncate">{k}</div>
          <div className="text-xs sm:text-sm font-mono">{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

function StrategyWeightsChart({ weights }: { weights: Record<string, number> }) {
  const data = Object.entries(weights).map(([name, value]) => ({ name, value: +(value * 100).toFixed(1) }));
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }: { name: string; value: number }) => `${name}: ${value}%`} labelLine={false}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [`${v}%`, 'Weight']} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
