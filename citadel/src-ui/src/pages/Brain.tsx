/**
 * CITADEL — Brain (Chain-of-Thought Terminal)
 * Enhanced CoT terminal with syntax highlighting, reasoning steps, and confidence gauges.
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';

interface ThoughtStep {
  id: number;
  type: 'observation' | 'reasoning' | 'decision' | 'action' | 'error';
  agent: string;
  text: string;
  confidence?: number;
  timestamp: string;
}

const TYPE_STYLES: Record<string, { color: string; label: string; icon: string }> = {
  observation: { color: 'text-blue-400', label: 'OBS', icon: '👁' },
  reasoning:   { color: 'text-yellow-400', label: 'REASON', icon: '🧠' },
  decision:    { color: 'text-citadel-accent', label: 'DECIDE', icon: '⚡' },
  action:      { color: 'text-citadel-success', label: 'ACT', icon: '🎯' },
  error:       { color: 'text-citadel-danger', label: 'ERR', icon: '⚠️' },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = value * 100;
  const color = pct >= 85 ? 'bg-citadel-success' : pct >= 70 ? 'bg-yellow-400' : 'bg-citadel-danger';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-citadel-bg rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`h-full ${color} rounded-full`}
        />
      </div>
      <span className="text-[9px] font-mono text-citadel-muted">{pct.toFixed(0)}%</span>
    </div>
  );
}

export default function Brain() {
  const cotStream = useStore((s) => s.cotStream);
  const [filter, setFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Map real CoT entries to ThoughtStep format
  const allThoughts: ThoughtStep[] = cotStream.map((entry: string, i: number) => {
    // Try to parse structured entries like "[AGENT] type: message"
    const match = entry.match(/^\[([^\]]+)\]\s*(\w+):\s*(.+)$/);
    return {
      id: i,
      type: (match?.[2]?.toLowerCase() || 'reasoning') as ThoughtStep['type'],
      agent: match?.[1] || 'System',
      text: match?.[3] || entry,
      timestamp: new Date().toISOString(),
    };
  });

  const filtered = filter === 'all' ? allThoughts : allThoughts.filter(t => t.type === filter);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const agentStats = allThoughts.reduce((acc, t) => {
    acc[t.agent] = (acc[t.agent] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Chain-of-Thought Terminal</h1>
          <p className="text-xs sm:text-sm text-citadel-muted">Real-time reasoning trace from all agents.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-citadel-muted cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="rounded border-citadel-border bg-citadel-bg" />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Agent stats */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(agentStats).map(([agent, count]) => (
          <span key={agent} className="text-[10px] sm:text-xs bg-citadel-surface border border-citadel-border rounded-lg px-2 py-1 font-mono">
            {agent}: <span className="text-citadel-accent">{String(count)}</span>
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1">
        {['all', 'observation', 'reasoning', 'decision', 'action', 'error'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] sm:text-xs px-2 py-1 rounded-lg transition-colors uppercase font-mono ${
              filter === f ? 'bg-citadel-accent text-citadel-bg font-bold' : 'text-citadel-muted hover:text-citadel-text hover:bg-citadel-surface'
            }`}>
            {f === 'all' ? `ALL (${allThoughts.length})` : `${TYPE_STYLES[f]?.icon || ''} ${f} (${allThoughts.filter(t => t.type === f).length})`}
          </button>
        ))}
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="bg-citadel-bg border border-citadel-border rounded-xl p-3 sm:p-4 min-h-[400px] max-h-[65vh] overflow-y-auto font-mono text-xs sm:text-sm space-y-2"
      >
        <AnimatePresence>
          {filtered.map(t => {
            const style = TYPE_STYLES[t.type] || TYPE_STYLES.reasoning;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex gap-2 sm:gap-3 group hover:bg-citadel-surface/30 rounded-lg p-1.5 sm:p-2 transition-colors"
              >
                {/* Timestamp */}
                <div className="text-[9px] sm:text-[10px] text-citadel-muted min-w-[50px] sm:min-w-[60px] pt-0.5">
                  {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>

                {/* Type badge */}
                <span className={`text-[9px] sm:text-[10px] font-bold ${style.color} min-w-[50px] sm:min-w-[55px] pt-0.5`}>
                  [{style.label}]
                </span>

                {/* Agent */}
                <span className="text-purple-400 text-[10px] sm:text-xs min-w-[60px] sm:min-w-[70px] pt-0.5 font-semibold">
                  {t.agent}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-citadel-text/90 leading-relaxed break-words">{t.text}</p>
                  {'confidence' in t && t.confidence != null && (
                    <div className="mt-1">
                      <ConfidenceBar value={(t as ThoughtStep).confidence!} />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Cursor blink */}
        <div className="flex items-center gap-2 text-citadel-muted">
          <span className="animate-pulse">▌</span>
          <span className="text-[10px]">Awaiting next reasoning step...</span>
        </div>
      </div>
    </div>
  );
}
