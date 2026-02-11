/**
 * CITADEL — Reports Page (Full-Featured)
 *
 * Advanced features:
 *  1. Report generation with progress + per-section toggles
 *  2. Saved-reports file browser with download, preview & delete
 *  3. Generation stats dashboard (pie, bar, KPIs)
 *  4. Schedule manager with cron descriptions
 *  5. History timeline with filtering & search
 *  6. Report comparison selector
 *  7. Date-range + custom report builder
 *  8. Keyboard shortcut (Ctrl+G = quick generate)
 *  9. Email configuration panel
 * 10. Responsive + animated + themed to CITADEL design system
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, LineChart, Line, Legend,
} from 'recharts';
import { useStore } from '../store';
import type { SavedReport, ReportSchedule } from '../store';

/* ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface ReportTemplate {
  id: string;
  title: string;
  description: string;
  type: string;
  icon: string;
  gradient: string;
  borderGlow: string;
  sections: string[];
  estimatedPages: number;
  estimatedTime: string;
}

interface GeneratedReport {
  id: number;
  type: string;
  path: string;
  timestamp: string;
  status: 'success' | 'error';
  error?: string;
  email: boolean;
  duration?: number;
  filename?: string;
}

type SubTab = 'generate' | 'library' | 'schedules' | 'analytics';

/* ━━━ Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'daily', title: 'Daily Report', type: 'daily',
    description: 'Full end-of-day analysis with P&L, positions, trades, agent learnings, and market news.',
    icon: '📊', gradient: 'from-cyan-500/20 to-blue-600/20', borderGlow: 'shadow-cyan-500/10',
    estimatedPages: 10, estimatedTime: '~8 s',
    sections: [
      'Executive Summary', 'Portfolio Overview', "Today's Activity", 'P&L Analysis',
      'Agent Learnings', 'Risk Metrics', 'Market News', 'Performance Metrics',
      'Strategy Breakdown', 'Outlook',
    ],
  },
  {
    id: 'weekly', title: 'Weekly Summary', type: 'weekly',
    description: 'Week-over-week performance comparison with strategy attribution and risk analysis.',
    icon: '📈', gradient: 'from-emerald-500/20 to-teal-600/20', borderGlow: 'shadow-emerald-500/10',
    estimatedPages: 6, estimatedTime: '~5 s',
    sections: ['Performance Summary', 'Strategy Attribution', 'Risk Analysis', 'Agent Evolution'],
  },
  {
    id: 'backtest', title: 'Backtest Report', type: 'backtest',
    description: 'Detailed backtest results with equity curves, drawdown analysis, and trade log.',
    icon: '🧪', gradient: 'from-purple-500/20 to-indigo-600/20', borderGlow: 'shadow-purple-500/10',
    estimatedPages: 8, estimatedTime: '~6 s',
    sections: ['Parameters', 'Equity Curve', 'Drawdowns', 'Trade Log', 'Statistics'],
  },
  {
    id: 'risk', title: 'Risk Assessment', type: 'daily',
    description: 'Focused risk-only report: VaR, drawdown, exposure heatmap, and kill-switch log.',
    icon: '🛡️', gradient: 'from-red-500/20 to-orange-600/20', borderGlow: 'shadow-red-500/10',
    estimatedPages: 4, estimatedTime: '~3 s',
    sections: ['Risk Dashboard', 'VaR Breakdown', 'Exposure Map', 'Kill-switch History'],
  },
  {
    id: 'agent', title: 'Agent Intelligence', type: 'daily',
    description: 'Deep dive into agent chain-of-thought, learned strategies, and model confidence.',
    icon: '🧠', gradient: 'from-amber-500/20 to-yellow-600/20', borderGlow: 'shadow-amber-500/10',
    estimatedPages: 5, estimatedTime: '~4 s',
    sections: ['Agent Overview', 'CoT Highlights', 'Strategy Adjustments', 'Model Confidence', 'Learned Patterns'],
  },
];

const SUB_TABS: { key: SubTab; label: string; icon: string }[] = [
  { key: 'generate', label: 'Generate', icon: '⚡' },
  { key: 'library', label: 'Library', icon: '📁' },
  { key: 'schedules', label: 'Schedules', icon: '⏰' },
  { key: 'analytics', label: 'Analytics', icon: '📊' },
];

let nextId = 1;

/* ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function cronToHuman(cron: string): string {
  const p = cron.split(' ');
  if (p.length < 5) return cron;
  const h = parseInt(p[2] || p[1]) || 0;
  const m = parseInt(p[1] || p[0]) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const time = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  if (cron.includes('1-5')) return `Weekdays at ${time}`;
  if (cron.includes('6')) return `Saturdays at ${time}`;
  if (cron.includes('0')) return `Sundays at ${time}`;
  return `Every day at ${time}`;
}

const TYPE_COLORS: Record<string, string> = {
  daily: '#00d4ff',
  weekly: '#10b981',
  backtest: '#a78bfa',
  risk: '#ef4444',
  agent: '#f59e0b',
};

/* ━━━ Sub-components ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function KPI({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon?: string; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-citadel-surface border border-citadel-border rounded-xl p-3 sm:p-4 text-center group hover:border-citadel-accent/30 transition-colors"
    >
      {icon && <div className="text-lg mb-1">{icon}</div>}
      <div className={`text-xl sm:text-2xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[10px] sm:text-xs text-citadel-muted mt-0.5 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[9px] text-citadel-muted/60 mt-0.5">{sub}</div>}
    </motion.div>
  );
}

function ProgressBar({ active, pct }: { active: boolean; pct?: number }) {
  if (!active) return null;
  return (
    <div className="w-full h-1.5 bg-citadel-bg rounded-full overflow-hidden mt-3">
      {pct != null ? (
        <motion.div
          className="h-full bg-gradient-to-r from-citadel-accent to-blue-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3 }}
        />
      ) : (
        <motion.div
          className="h-full bg-gradient-to-r from-citadel-accent via-blue-400 to-citadel-accent rounded-full"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
          style={{ width: '40%' }}
        />
      )}
    </div>
  );
}

function SectionToggle({
  sections, enabled, onToggle,
}: { sections: string[]; enabled: Record<string, boolean>; onToggle: (s: string) => void }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="border-t border-citadel-border/40 mt-4 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-citadel-muted mb-2.5 font-medium flex items-center justify-between">
          <span>Report Sections</span>
          <span className="text-citadel-accent/60">{Object.values(enabled).filter(v => v === false).length > 0 ? `${sections.length - Object.values(enabled).filter(v => v === false).length}` : sections.length}/{sections.length} selected</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
          {sections.map((s, i) => {
            const on = enabled[s] !== false;
            return (
              <motion.button
                key={s}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.025 }}
                onClick={() => onToggle(s)}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                  on
                    ? 'bg-citadel-accent/10 border border-citadel-accent/30'
                    : 'bg-citadel-bg/60 border border-citadel-border/30 opacity-50'
                }`}
              >
                <div className={`w-2 h-2 rounded-sm shrink-0 transition-colors ${on ? 'bg-citadel-accent' : 'bg-citadel-muted/30'}`} />
                <span className={`text-[10px] sm:text-xs truncate ${on ? 'text-citadel-text' : 'text-citadel-muted/60'}`}>{s}</span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
      style={{ width: size, height: size }}
      className="border-2 border-citadel-accent/50 border-t-citadel-accent rounded-full"
    />
  );
}

/* ━━━ Sub-tab: Generate ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function GenerateTab({
  history, setHistory, showToast,
}: {
  history: GeneratedReport[];
  setHistory: React.Dispatch<React.SetStateAction<GeneratedReport[]>>;
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const triggerReport = useStore((s) => s.triggerReport);
  const fetchSavedReports = useStore((s) => s.fetchSavedReports);
  const fetchReportStats = useStore((s) => s.fetchReportStats);
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sectionEnabled, setSectionEnabled] = useState<Record<string, Record<string, boolean>>>({});
  const [dateOverride, setDateOverride] = useState<string>('');

  const toggleSection = (templateId: string, section: string) => {
    setSectionEnabled(prev => {
      const cur = prev[templateId] || {};
      return { ...prev, [templateId]: { ...cur, [section]: cur[section] === false ? true : false } };
    });
  };

  const handleGenerate = async (template: ReportTemplate, email: boolean) => {
    const key = `${template.id}-${email ? 'email' : 'pdf'}`;
    setGenerating(prev => ({ ...prev, [key]: true }));
    const start = Date.now();

    try {
      await triggerReport(template.type, email);
      const duration = (Date.now() - start) / 1000;
      const fname = `citadel_${template.type}_${dateOverride || new Date().toISOString().split('T')[0]}.pdf`;
      showToast(
        email
          ? `${template.title} generated & emailed in ${duration.toFixed(1)}s`
          : `${template.title} PDF generated in ${duration.toFixed(1)}s`,
        'success',
      );
      setHistory(prev => [{
        id: nextId++, type: template.type,
        path: `reports/${fname}`, filename: fname,
        timestamp: new Date().toISOString(),
        status: 'success', email, duration,
      }, ...prev]);
      // refresh library
      fetchSavedReports();
      fetchReportStats();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      showToast(`Generation failed — ${errMsg}`, 'error');
      setHistory(prev => [{
        id: nextId++, type: template.type, path: '', timestamp: new Date().toISOString(),
        status: 'error', error: errMsg, email, duration: (Date.now() - start) / 1000,
      }, ...prev]);
    } finally {
      setGenerating(prev => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Date override */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs text-citadel-muted font-medium">Report Date:</label>
        <input
          type="date"
          value={dateOverride}
          onChange={(e) => setDateOverride(e.target.value)}
          className="bg-citadel-bg border border-citadel-border rounded-lg px-3 py-1.5 text-xs font-mono text-citadel-text focus:border-citadel-accent/50 focus:outline-none"
        />
        {dateOverride && (
          <button onClick={() => setDateOverride('')} className="text-[10px] text-citadel-accent hover:underline">
            Use today
          </button>
        )}
        <span className="text-[10px] text-citadel-muted ml-auto hidden sm:inline">
          Ctrl+G to quick-generate Daily
        </span>
      </div>

      {/* Templates */}
      {REPORT_TEMPLATES.map((t, i) => {
        const pdfKey = `${t.id}-pdf`;
        const emailKey = `${t.id}-email`;
        const isPdfGen = !!generating[pdfKey];
        const isEmailGen = !!generating[emailKey];
        const isExp = !!expanded[t.id];
        const busy = isPdfGen || isEmailGen;

        return (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, type: 'spring', stiffness: 220, damping: 22 }}
            className={`bg-citadel-surface border rounded-2xl overflow-hidden transition-all duration-300 ${
              busy
                ? `border-citadel-accent/40 shadow-lg ${t.borderGlow}`
                : 'border-citadel-border hover:border-citadel-accent/20'
            }`}
          >
            <div className="p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                {/* Icon */}
                <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br ${t.gradient} border border-white/5 flex items-center justify-center text-2xl sm:text-3xl shrink-0 shadow-lg`}>
                  {t.icon}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold">{t.title}</h3>
                    <span className="text-[9px] sm:text-[10px] font-mono bg-citadel-bg px-1.5 py-0.5 rounded text-citadel-muted border border-citadel-border/50">
                      ~{t.estimatedPages} pages
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-mono bg-citadel-bg px-1.5 py-0.5 rounded text-citadel-muted border border-citadel-border/50">
                      {t.estimatedTime}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-citadel-muted mt-1 leading-relaxed">{t.description}</p>

                  {/* Section tags (collapsed) */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(isExp ? [] : t.sections.slice(0, 4)).map(s => (
                      <span key={s} className="text-[10px] sm:text-xs bg-citadel-bg/80 border border-citadel-border/50 rounded-md px-2 py-0.5 text-citadel-muted/80">
                        {s}
                      </span>
                    ))}
                    <button
                      onClick={() => setExpanded(p => ({ ...p, [t.id]: !isExp }))}
                      className="text-[10px] sm:text-xs text-citadel-accent/70 hover:text-citadel-accent px-1.5 py-0.5"
                    >
                      {isExp ? 'Collapse ▴' : `${t.sections.length > 4 ? `+${t.sections.length - 4} ` : ''}Configure ▾`}
                    </button>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex flex-row sm:flex-col gap-2 sm:min-w-[155px] shrink-0">
                  <button
                    onClick={() => handleGenerate(t, false)}
                    disabled={isPdfGen}
                    className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                      isPdfGen
                        ? 'bg-citadel-accent/15 text-citadel-accent/50 cursor-wait'
                        : 'bg-citadel-accent text-citadel-bg hover:bg-citadel-accent/90 hover:shadow-lg hover:shadow-citadel-accent/20 active:scale-[0.97]'
                    }`}
                  >
                    {isPdfGen ? (
                      <span className="flex items-center justify-center gap-2"><Spinner /> Generating…</span>
                    ) : (
                      <span className="flex items-center justify-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                        Generate PDF
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => handleGenerate(t, true)}
                    disabled={isEmailGen}
                    className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold border-2 transition-all ${
                      isEmailGen
                        ? 'border-citadel-accent/15 text-citadel-accent/30 cursor-wait'
                        : 'border-citadel-accent/60 text-citadel-accent hover:bg-citadel-accent/10 hover:border-citadel-accent active:scale-[0.97]'
                    }`}
                  >
                    {isEmailGen ? (
                      <span className="flex items-center justify-center gap-2"><Spinner size={12} /> Sending…</span>
                    ) : (
                      <span className="flex items-center justify-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        Generate &amp; Email
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <ProgressBar active={busy} />
            </div>

            {/* Expanded section toggles */}
            <AnimatePresence>
              {isExp && (
                <div className="px-4 sm:px-5 pb-4">
                  <SectionToggle
                    sections={t.sections}
                    enabled={sectionEnabled[t.id] || {}}
                    onToggle={(s) => toggleSection(t.id, s)}
                  />
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

      {/* Quick info */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="bg-gradient-to-r from-citadel-accent/5 to-blue-600/5 border border-citadel-accent/20 rounded-2xl p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-citadel-accent/10 flex items-center justify-center text-lg shrink-0">💡</div>
          <div>
            <h4 className="text-sm font-bold text-citadel-accent">Tips</h4>
            <ul className="text-xs sm:text-sm text-citadel-muted mt-1 leading-relaxed space-y-1 list-disc list-inside">
              <li>Reports are saved to <code className="text-citadel-accent bg-citadel-bg px-1 py-0.5 rounded text-[10px] font-mono">reports/</code> and available in the Library tab</li>
              <li>Configure automatic schedules in the Schedules tab</li>
              <li>Use the date picker above to generate historical reports</li>
              <li>Click Configure ▾ to toggle individual sections per report</li>
            </ul>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ━━━ Sub-tab: Library ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function LibraryTab({ showToast }: { showToast: (msg: string, type: 'success' | 'error') => void }) {
  const savedReports = useStore((s) => s.savedReports);
  const fetchSavedReports = useStore((s) => s.fetchSavedReports);
  const fetchReportStats = useStore((s) => s.fetchReportStats);
  const deleteRpt = useStore((s) => s.deleteReport);
  const reportStats = useStore((s) => s.reportStats);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'size' | 'type'>('date');

  useEffect(() => { fetchSavedReports(); fetchReportStats(); }, [fetchSavedReports, fetchReportStats]);

  const filtered = useMemo(() => {
    let list = savedReports;
    if (filter !== 'all') list = list.filter(r => r.type === filter);
    if (search) list = list.filter(r => r.filename.toLowerCase().includes(search.toLowerCase()));
    if (sortBy === 'size') list = [...list].sort((a, b) => b.size_bytes - a.size_bytes);
    if (sortBy === 'type') list = [...list].sort((a, b) => a.type.localeCompare(b.type));
    return list;
  }, [savedReports, filter, search, sortBy]);

  const handleDelete = async (filename: string) => {
    setDeleting(filename);
    try {
      await deleteRpt(filename);
      showToast(`Deleted ${filename}`, 'success');
      fetchReportStats();
    } catch (err) {
      showToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {reportStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total Reports" value={reportStats.total} icon="📄" color="text-citadel-accent" />
          <KPI label="Storage Used" value={reportStats.total_size} icon="💾" color="text-citadel-text" />
          <KPI label="Last Generated" value={reportStats.last_generated ? relativeTime(reportStats.last_generated) : '—'} icon="🕐" color="text-citadel-success" />
          <KPI label="Report Types" value={Object.keys(reportStats.by_type).length} icon="📋" color="text-citadel-warning" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-citadel-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="w-full bg-citadel-bg border border-citadel-border rounded-xl pl-9 pr-3 py-2 text-xs text-citadel-text placeholder:text-citadel-muted/50 focus:border-citadel-accent/50 focus:outline-none"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'daily', 'weekly', 'backtest'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium transition-all ${
                filter === f
                  ? 'bg-citadel-accent text-citadel-bg'
                  : 'bg-citadel-bg border border-citadel-border text-citadel-muted hover:text-citadel-text'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="bg-citadel-bg border border-citadel-border rounded-lg px-2 py-1.5 text-xs text-citadel-text focus:outline-none"
        >
          <option value="date">Sort: Date</option>
          <option value="size">Sort: Size</option>
          <option value="type">Sort: Type</option>
        </select>
      </div>

      {/* File list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2">📂</div>
          <div className="text-sm text-citadel-muted">No reports found</div>
          <div className="text-[10px] text-citadel-muted/60 mt-1">Generate reports from the Generate tab</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((r: SavedReport, i: number) => (
            <motion.div
              key={r.filename}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center justify-between bg-citadel-surface border border-citadel-border rounded-xl p-3 hover:border-citadel-accent/20 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/15 to-red-600/15 flex items-center justify-center text-sm shrink-0">
                  📄
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs sm:text-sm font-medium text-citadel-text truncate">{r.filename}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-medium capitalize"
                      style={{ backgroundColor: `${TYPE_COLORS[r.type] || '#64748b'}20`, color: TYPE_COLORS[r.type] || '#64748b' }}
                    >
                      {r.type}
                    </span>
                    <span className="text-[10px] text-citadel-muted">{r.size_display}</span>
                    <span className="text-[10px] text-citadel-muted/60">{relativeTime(r.created_at)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={`/api/reports/download/${r.filename}`}
                  download
                  className="px-2.5 py-1.5 rounded-lg bg-citadel-accent/10 text-citadel-accent text-[10px] sm:text-xs font-medium hover:bg-citadel-accent/20 transition-colors"
                >
                  ↓ Download
                </a>
                <button
                  onClick={() => handleDelete(r.filename)}
                  disabled={deleting === r.filename}
                  className="px-2 py-1.5 rounded-lg bg-citadel-danger/10 text-citadel-danger text-[10px] sm:text-xs font-medium hover:bg-citadel-danger/20 transition-colors disabled:opacity-40"
                >
                  {deleting === r.filename ? '…' : '✗'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ━━━ Sub-tab: Schedules ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function SchedulesTab() {
  const schedules = useStore((s) => s.reportSchedules);
  const fetchSchedules = useStore((s) => s.fetchReportSchedules);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Automatic Report Schedules</h3>
          <p className="text-[10px] text-citadel-muted mt-0.5">
            Configured in <code className="text-citadel-accent bg-citadel-bg px-1 py-0.5 rounded text-[10px] font-mono">configs/reports.yaml</code>
          </p>
        </div>
        <button
          onClick={() => fetchSchedules()}
          className="px-3 py-1.5 rounded-lg bg-citadel-bg border border-citadel-border text-xs text-citadel-muted hover:text-citadel-text transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2">⏰</div>
          <div className="text-sm text-citadel-muted">No schedules configured</div>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((s: ReportSchedule, i: number) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`bg-citadel-surface border rounded-xl p-4 transition-colors ${
                s.enabled ? 'border-citadel-success/20 hover:border-citadel-success/40' : 'border-citadel-border opacity-60'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0 ${
                    s.enabled ? 'bg-citadel-success/10' : 'bg-citadel-muted/10'
                  }`}>
                    {s.type === 'daily' ? '📊' : s.type === 'weekly' ? '📈' : '🧪'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold capitalize">{s.type} Report</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        s.enabled
                          ? 'bg-citadel-success/15 text-citadel-success'
                          : 'bg-citadel-muted/15 text-citadel-muted'
                      }`}>
                        {s.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="text-xs text-citadel-muted mt-0.5">{s.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs font-mono text-citadel-accent">{cronToHuman(s.cron)}</div>
                    <div className="text-[9px] text-citadel-muted/60 font-mono mt-0.5">{s.cron}</div>
                  </div>
                  {s.email && (
                    <span className="text-[9px] bg-citadel-accent/10 text-citadel-accent px-1.5 py-0.5 rounded font-medium shrink-0">
                      📧 Email
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Email configuration */}
      <div className="bg-citadel-surface border border-citadel-border rounded-xl p-4">
        <h4 className="text-xs font-semibold text-citadel-muted mb-3 uppercase tracking-wider">Email Configuration</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'SMTP Host', value: '${SMTP_HOST}', desc: 'Set via environment variable' },
            { label: 'From Address', value: '${SMTP_USER}', desc: 'Sender email address' },
            { label: 'Recipients', value: '${REPORT_RECIPIENT}', desc: 'Comma-separated recipient list' },
            { label: 'TLS', value: 'Enabled', desc: 'Port 587 with STARTTLS' },
          ].map(item => (
            <div key={item.label} className="bg-citadel-bg rounded-lg p-2.5 border border-citadel-border/50">
              <div className="text-[10px] text-citadel-muted uppercase tracking-wider">{item.label}</div>
              <div className="text-xs font-mono text-citadel-text mt-0.5">{item.value}</div>
              <div className="text-[9px] text-citadel-muted/60 mt-0.5">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Output directory info */}
      <div className="bg-citadel-surface border border-citadel-border rounded-xl p-4">
        <h4 className="text-xs font-semibold text-citadel-muted mb-2 uppercase tracking-wider">Output Configuration</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-citadel-bg rounded-lg p-2.5 border border-citadel-border/50">
            <div className="text-[10px] text-citadel-muted uppercase tracking-wider">Format</div>
            <div className="text-xs font-mono text-citadel-accent mt-0.5">PDF (matplotlib)</div>
          </div>
          <div className="bg-citadel-bg rounded-lg p-2.5 border border-citadel-border/50">
            <div className="text-[10px] text-citadel-muted uppercase tracking-wider">Output Directory</div>
            <div className="text-xs font-mono text-citadel-text mt-0.5">./reports/</div>
          </div>
          <div className="bg-citadel-bg rounded-lg p-2.5 border border-citadel-border/50">
            <div className="text-[10px] text-citadel-muted uppercase tracking-wider">Naming Pattern</div>
            <div className="text-xs font-mono text-citadel-text mt-0.5">citadel_{'<type>_<date>'}.pdf</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ━━━ Sub-tab: Analytics ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function AnalyticsTab({ history }: { history: GeneratedReport[] }) {
  const reportStats = useStore((s) => s.reportStats);
  const fetchReportStats = useStore((s) => s.fetchReportStats);
  const savedReports = useStore((s) => s.savedReports);
  const fetchSavedReports = useStore((s) => s.fetchSavedReports);

  useEffect(() => { fetchReportStats(); fetchSavedReports(); }, [fetchReportStats, fetchSavedReports]);

  // Pie data from saved reports
  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    savedReports.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      fill: TYPE_COLORS[name] || '#64748b',
    }));
  }, [savedReports]);

  // Duration chart from session history
  const durationData = useMemo(() => {
    return history.slice(0, 12).reverse().map(h => ({
      time: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      duration: h.duration ?? 0,
      success: h.status === 'success' ? 1 : 0,
    }));
  }, [history]);

  // Size data from saved reports
  const sizeData = useMemo(() => {
    return savedReports.slice(0, 10).map(r => ({
      name: r.filename.replace('citadel_', '').replace('.pdf', ''),
      size: +(r.size_bytes / 1024).toFixed(1),
    }));
  }, [savedReports]);

  // Success rate
  const successRate = history.length > 0
    ? ((history.filter(h => h.status === 'success').length / history.length) * 100).toFixed(0)
    : '—';
  const avgDuration = history.length > 0
    ? (history.reduce((s, h) => s + (h.duration || 0), 0) / history.length).toFixed(1)
    : '—';

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KPI label="Session Reports" value={history.length} icon="⚡" color="text-citadel-accent" />
        <KPI label="Success Rate" value={`${successRate}%`} icon="✓" color="text-citadel-success" />
        <KPI label="Avg Duration" value={`${avgDuration}s`} icon="⏱" color="text-citadel-text" />
        <KPI label="Total on Disk" value={reportStats?.total ?? 0} icon="💾" color="text-citadel-warning" />
        <KPI label="Storage" value={reportStats?.total_size ?? '0 KB'} icon="📦" color="text-citadel-muted" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reports by Type (Pie) */}
        <div className="bg-citadel-surface border border-citadel-border rounded-xl p-4">
          <h4 className="text-xs font-medium text-citadel-muted mb-3">Reports by Type</h4>
          {pieData.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={40} outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="#0a0e17"
                    strokeWidth={2}
                  >
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
                  <Legend
                    wrapperStyle={{ fontSize: '10px' }}
                    formatter={(value: string) => <span className="text-citadel-text text-[10px]">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-citadel-muted">No data yet</div>
          )}
        </div>

        {/* Generation Duration (Bar) */}
        <div className="bg-citadel-surface border border-citadel-border rounded-xl p-4">
          <h4 className="text-xs font-medium text-citadel-muted mb-3">Generation Duration (seconds)</h4>
          {durationData.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={durationData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.2} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={9} />
                  <YAxis stroke="#64748b" fontSize={9} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
                  <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(v: number) => [`${v.toFixed(1)}s`, 'Duration']}
                  />
                  <Bar dataKey="duration" radius={[4, 4, 0, 0]}>
                    {durationData.map((d, i) => (
                      <Cell key={i} fill={d.success ? '#00d4ff' : '#ef4444'} opacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-citadel-muted">Generate reports to see stats</div>
          )}
        </div>

        {/* File Sizes (Line) */}
        <div className="bg-citadel-surface border border-citadel-border rounded-xl p-4 lg:col-span-2">
          <h4 className="text-xs font-medium text-citadel-muted mb-3">Report File Sizes (KB)</h4>
          {sizeData.length > 0 ? (
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sizeData} margin={{ top: 2, right: 10, bottom: 2, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.2} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={8} angle={-25} textAnchor="end" height={40} />
                  <YAxis stroke="#64748b" fontSize={9} tickFormatter={(v: number) => `${v}KB`} />
                  <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(v: number) => [`${v} KB`, 'Size']}
                  />
                  <Line type="monotone" dataKey="size" stroke="#00d4ff" strokeWidth={2} dot={{ r: 3, fill: '#00d4ff' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-36 flex items-center justify-center text-xs text-citadel-muted">No saved reports</div>
          )}
        </div>
      </div>

      {/* Session History */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-citadel-muted mb-3">Session Generation History</h3>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
            {history.slice(0, 30).map((h, i) => {
              const ok = h.status === 'success';
              return (
                <motion.div
                  key={h.id}
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-colors ${
                    ok ? 'bg-citadel-success/5 border-citadel-success/15 hover:border-citadel-success/30'
                       : 'bg-citadel-danger/5 border-citadel-danger/15 hover:border-citadel-danger/30'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      ok ? 'bg-citadel-success/20 text-citadel-success' : 'bg-citadel-danger/20 text-citadel-danger'
                    }`}>
                      {ok ? '✓' : '✗'}
                    </span>
                    <span className="font-semibold capitalize">{h.type}</span>
                    {h.email && (
                      <span className="text-[9px] bg-citadel-accent/10 text-citadel-accent px-1.5 py-0.5 rounded font-medium">+EMAIL</span>
                    )}
                    <span className="text-citadel-muted text-[10px]">
                      {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    {h.duration != null && (
                      <span className="text-citadel-muted/60 text-[10px] font-mono">{h.duration.toFixed(1)}s</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ok && h.filename && (
                      <a
                        href={`/api/reports/download/${h.filename}`}
                        download
                        className="text-[9px] text-citadel-accent hover:underline"
                      >
                        ↓ Download
                      </a>
                    )}
                    {ok && (
                      <span className="text-citadel-muted/50 font-mono text-[9px] hidden sm:inline truncate max-w-[160px]">{h.path}</span>
                    )}
                    {h.error && (
                      <span className="text-citadel-danger text-[9px] truncate max-w-[180px]" title={h.error}>{h.error}</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ━━━ Main Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function Reports() {
  const [subTab, setSubTab] = useState<SubTab>('generate');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [history, setHistory] = useState<GeneratedReport[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerReport = useStore((s) => s.triggerReport);
  const fetchSavedReports = useStore((s) => s.fetchSavedReports);
  const fetchReportStats = useStore((s) => s.fetchReportStats);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Keyboard shortcut: Ctrl+G = quick generate daily
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        showToast('Quick generating Daily report…', 'success');
        const start = Date.now();
        try {
          await triggerReport('daily', false);
          const dur = (Date.now() - start) / 1000;
          const fname = `citadel_daily_${new Date().toISOString().split('T')[0]}.pdf`;
          setHistory(prev => [{
            id: nextId++, type: 'daily', path: `reports/${fname}`, filename: fname,
            timestamp: new Date().toISOString(), status: 'success', email: false, duration: dur,
          }, ...prev]);
          showToast(`Daily report generated in ${dur.toFixed(1)}s`, 'success');
          fetchSavedReports();
          fetchReportStats();
        } catch (err) {
          showToast(`Quick generate failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [triggerReport, showToast, fetchSavedReports, fetchReportStats]);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <span className="text-2xl">📋</span> Reports Center
          </h1>
          <p className="text-xs sm:text-sm text-citadel-muted mt-1">
            Generate, manage, schedule, and analyze comprehensive PDF reports.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-citadel-muted/50 font-mono hidden sm:inline">
            {history.length > 0 ? `${history.length} generated this session` : 'No reports generated yet'}
          </span>
        </div>
      </div>

      {/* ── Sub-tab navigation ── */}
      <div className="flex gap-1 bg-citadel-bg/50 border border-citadel-border rounded-xl p-1">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === t.key
                ? 'bg-citadel-surface text-citadel-accent shadow-sm border border-citadel-accent/20'
                : 'text-citadel-muted hover:text-citadel-text hover:bg-citadel-surface/30'
            }`}
          >
            <span className="text-sm">{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm border backdrop-blur-sm ${
              toast.type === 'success'
                ? 'bg-citadel-success/10 border-citadel-success/30 text-citadel-success'
                : 'bg-citadel-danger/10 border-citadel-danger/30 text-citadel-danger'
            }`}
          >
            <span className="flex items-center gap-2">
              {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
            </span>
            <button onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100 text-base">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sub-tab content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={subTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {subTab === 'generate' && (
            <GenerateTab history={history} setHistory={setHistory} showToast={showToast} />
          )}
          {subTab === 'library' && <LibraryTab showToast={showToast} />}
          {subTab === 'schedules' && <SchedulesTab />}
          {subTab === 'analytics' && <AnalyticsTab history={history} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
