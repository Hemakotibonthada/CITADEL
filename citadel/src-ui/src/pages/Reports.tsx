/**
 * CITADEL — Reports Center (Enhanced UI)
 *
 * Features:
 *  1. Report generation with progress + per-section toggles
 *  2. Library with grid/list views, trigger badges, enhanced cards
 *  3. Generation stats dashboard (pie, bar, KPIs)
 *  4. Schedule manager with cron descriptions
 *  5. History timeline with filtering & search
 *  6. Date-range + custom report builder
 *  7. Keyboard shortcut (Ctrl+G = quick generate)
 *  8. Auto/Manual trigger naming in filenames
 *  9. Responsive + animated + themed to CITADEL design system
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
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
  trigger?: string;
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

function formatTimestamp(time: string): string {
  if (!time || time.length < 6) return '';
  return `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

const TYPE_COLORS: Record<string, string> = {
  daily: '#00d4ff',
  weekly: '#10b981',
  backtest: '#a78bfa',
  risk: '#ef4444',
  agent: '#f59e0b',
};

const TYPE_ICONS: Record<string, string> = {
  daily: '📊',
  weekly: '📈',
  backtest: '🧪',
  risk: '🛡️',
  agent: '🧠',
};

/* ━━━ Sub-components ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function KPI({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon?: string; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-citadel-surface border border-citadel-border rounded-xl p-3 sm:p-4 text-center group hover:border-citadel-accent/30 transition-all duration-300 hover:shadow-lg hover:shadow-citadel-accent/5"
    >
      {icon && <div className="text-lg mb-1 group-hover:scale-110 transition-transform">{icon}</div>}
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

function TriggerBadge({ trigger }: { trigger: string }) {
  const isAuto = trigger === 'auto';
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
      isAuto
        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
        : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isAuto ? 'bg-amber-400' : 'bg-blue-400'}`} />
      {trigger}
    </span>
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
      await triggerReport(template.type, email, 'manual');
      const duration = (Date.now() - start) / 1000;
      const ts = new Date();
      const timeStr = ts.toTimeString().slice(0, 8).replace(/:/g, '');
      const dateStr = dateOverride || ts.toISOString().split('T')[0];
      const fname = `citadel_manual_${template.type}_${dateStr}_${timeStr}.pdf`;
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
        status: 'success', email, duration, trigger: 'manual',
      }, ...prev]);
      fetchSavedReports();
      fetchReportStats();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      showToast(`Generation failed — ${errMsg}`, 'error');
      setHistory(prev => [{
        id: nextId++, type: template.type, path: '', timestamp: new Date().toISOString(),
        status: 'error', error: errMsg, email, duration: (Date.now() - start) / 1000, trigger: 'manual',
      }, ...prev]);
    } finally {
      setGenerating(prev => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Date override + quick-gen hint */}
      <div className="flex items-center gap-3 flex-wrap bg-citadel-surface/50 border border-citadel-border/50 rounded-xl p-3">
        <label className="text-xs text-citadel-muted font-medium">Report Date:</label>
        <input
          type="date"
          value={dateOverride}
          onChange={(e) => setDateOverride(e.target.value)}
          className="bg-citadel-bg border border-citadel-border rounded-lg px-3 py-1.5 text-xs font-mono text-citadel-text focus:border-citadel-accent/50 focus:outline-none transition-colors"
        />
        {dateOverride && (
          <button onClick={() => setDateOverride('')} className="text-[10px] text-citadel-accent hover:underline">
            Use today
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <TriggerBadge trigger="manual" />
          <span className="text-[10px] text-citadel-muted hidden sm:inline">
            Ctrl+G to quick-generate Daily
          </span>
        </div>
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

      {/* Naming info */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="bg-gradient-to-r from-citadel-accent/5 to-blue-600/5 border border-citadel-accent/20 rounded-2xl p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-citadel-accent/10 flex items-center justify-center text-lg shrink-0">💡</div>
          <div>
            <h4 className="text-sm font-bold text-citadel-accent">Tips</h4>
            <ul className="text-xs sm:text-sm text-citadel-muted mt-1 leading-relaxed space-y-1 list-disc list-inside">
              <li>Reports are named as <code className="text-citadel-accent bg-citadel-bg px-1 py-0.5 rounded text-[10px] font-mono">citadel_manual_type_date_HHMMSS.pdf</code></li>
              <li>Auto-scheduled reports use <code className="text-citadel-accent bg-citadel-bg px-1 py-0.5 rounded text-[10px] font-mono">citadel_auto_type_date_HHMMSS.pdf</code></li>
              <li>Timestamps enable multiple reports of the same type per day</li>
              <li>View all generated files in the <strong className="text-citadel-text">Library</strong> tab</li>
              <li>Click <em>Configure ▾</em> to toggle individual sections per report</li>
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
  const [triggerFilter, setTriggerFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'size' | 'type'>('date');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  useEffect(() => { fetchSavedReports(); fetchReportStats(); }, [fetchSavedReports, fetchReportStats]);

  const filtered = useMemo(() => {
    let list = savedReports;
    if (filter !== 'all') list = list.filter(r => r.type === filter);
    if (triggerFilter !== 'all') list = list.filter(r => r.trigger === triggerFilter);
    if (search) list = list.filter(r => r.filename.toLowerCase().includes(search.toLowerCase()));
    if (sortBy === 'size') list = [...list].sort((a, b) => b.size_bytes - a.size_bytes);
    if (sortBy === 'type') list = [...list].sort((a, b) => a.type.localeCompare(b.type));
    return list;
  }, [savedReports, filter, triggerFilter, search, sortBy]);

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
      <div className="bg-citadel-surface/50 border border-citadel-border/50 rounded-xl p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-citadel-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="w-full bg-citadel-bg border border-citadel-border rounded-xl pl-9 pr-3 py-2 text-xs text-citadel-text placeholder:text-citadel-muted/50 focus:border-citadel-accent/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Type filters */}
          <div className="flex gap-1 flex-wrap">
            {['all', 'daily', 'weekly', 'backtest'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-citadel-accent text-citadel-bg shadow-sm shadow-citadel-accent/20'
                    : 'bg-citadel-bg border border-citadel-border text-citadel-muted hover:text-citadel-text hover:border-citadel-accent/20'
                }`}
              >
                {f === 'all' ? 'All Types' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Trigger filter */}
          <div className="flex gap-1">
            {['all', 'manual', 'auto'].map(t => (
              <button
                key={t}
                onClick={() => setTriggerFilter(t)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                  triggerFilter === t
                    ? t === 'auto'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : t === 'manual'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-citadel-accent/15 text-citadel-accent border border-citadel-accent/30'
                    : 'bg-citadel-bg/50 text-citadel-muted border border-transparent hover:text-citadel-text'
                }`}
              >
                {t === 'all' ? 'All Triggers' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-citadel-bg border border-citadel-border rounded-lg px-2 py-1 text-[10px] text-citadel-text focus:outline-none ml-auto"
          >
            <option value="date">Sort: Date</option>
            <option value="size">Sort: Size</option>
            <option value="type">Sort: Type</option>
          </select>

          {/* View toggle */}
          <div className="flex bg-citadel-bg rounded-lg border border-citadel-border overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-2 py-1 text-[10px] transition-colors ${viewMode === 'list' ? 'bg-citadel-accent/15 text-citadel-accent' : 'text-citadel-muted hover:text-citadel-text'}`}
              title="List view"
            >☰</button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2 py-1 text-[10px] transition-colors ${viewMode === 'grid' ? 'bg-citadel-accent/15 text-citadel-accent' : 'text-citadel-muted hover:text-citadel-text'}`}
              title="Grid view"
            >⊞</button>
          </div>

          {/* Refresh */}
          <button
            onClick={() => { fetchSavedReports(); fetchReportStats(); }}
            className="px-2 py-1 rounded-lg bg-citadel-bg border border-citadel-border text-[10px] text-citadel-muted hover:text-citadel-accent hover:border-citadel-accent/30 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-[10px] text-citadel-muted px-1">
        <span>{filtered.length} report{filtered.length !== 1 ? 's' : ''} found</span>
        {savedReports.length !== filtered.length && (
          <span>{savedReports.length - filtered.length} filtered out</span>
        )}
      </div>

      {/* File list */}
      {filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16 bg-citadel-surface/30 border border-dashed border-citadel-border rounded-2xl"
        >
          <div className="text-4xl mb-3">📂</div>
          <div className="text-sm font-medium text-citadel-text/70">No reports found</div>
          <div className="text-[11px] text-citadel-muted/60 mt-1.5 max-w-xs mx-auto">
            {savedReports.length > 0
              ? 'Try adjusting your filters to see more results'
              : 'Generate your first report from the Generate tab to get started'}
          </div>
          {savedReports.length === 0 && (
            <div className="mt-4">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-citadel-accent bg-citadel-accent/10 rounded-lg px-3 py-1.5 border border-citadel-accent/20">
                ⚡ Tip: Press Ctrl+G for a quick Daily report
              </span>
            </div>
          )}
        </motion.div>
      ) : viewMode === 'grid' ? (
        /* ── Grid View ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r: SavedReport, i: number) => {
            const typeColor = TYPE_COLORS[r.type] || '#64748b';
            const typeIcon = TYPE_ICONS[r.type] || '📄';
            return (
              <motion.div
                key={r.filename}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="bg-citadel-surface border border-citadel-border rounded-2xl overflow-hidden hover:border-citadel-accent/25 transition-all duration-300 group hover:shadow-lg hover:shadow-citadel-accent/5"
              >
                {/* Color header strip */}
                <div className="h-1.5 w-full" style={{ background: `linear-gradient(to right, ${typeColor}60, ${typeColor}20)` }} />

                <div className="p-4">
                  {/* Icon + Type */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                        style={{ background: `${typeColor}15` }}>
                        {typeIcon}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold capitalize" style={{ color: typeColor }}>{r.type}</span>
                          <TriggerBadge trigger={r.trigger || 'manual'} />
                        </div>
                        <div className="text-[10px] text-citadel-muted mt-0.5">{r.date}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-citadel-muted font-mono">{r.size_display}</div>
                      {r.time && (
                        <div className="text-[9px] text-citadel-muted/50 font-mono mt-0.5">{formatTimestamp(r.time)}</div>
                      )}
                    </div>
                  </div>

                  {/* Filename */}
                  <div className="text-[10px] font-mono text-citadel-muted/60 truncate mb-3 bg-citadel-bg/50 rounded-lg px-2 py-1 border border-citadel-border/30">
                    {r.filename}
                  </div>

                  {/* Meta */}
                  <div className="text-[9px] text-citadel-muted/50 mb-3">
                    Created {relativeTime(r.created_at)}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <a
                      href={`/api/reports/download/${r.filename}`}
                      download
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-citadel-accent/10 text-citadel-accent text-[10px] sm:text-xs font-medium hover:bg-citadel-accent/20 transition-all border border-citadel-accent/20 hover:border-citadel-accent/40"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Download
                    </a>
                    <button
                      onClick={() => handleDelete(r.filename)}
                      disabled={deleting === r.filename}
                      className="px-3 py-2 rounded-xl bg-citadel-danger/10 text-citadel-danger text-[10px] sm:text-xs font-medium hover:bg-citadel-danger/20 transition-all border border-citadel-danger/20 hover:border-citadel-danger/40 disabled:opacity-40"
                    >
                      {deleting === r.filename ? <Spinner size={12} /> : '✗ Delete'}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* ── List View ── */
        <div className="space-y-1.5">
          {filtered.map((r: SavedReport, i: number) => {
            const typeColor = TYPE_COLORS[r.type] || '#64748b';
            const typeIcon = TYPE_ICONS[r.type] || '📄';
            return (
              <motion.div
                key={r.filename}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center justify-between bg-citadel-surface border border-citadel-border rounded-xl p-3 hover:border-citadel-accent/20 transition-all duration-200 group hover:shadow-md hover:shadow-citadel-accent/3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Type color indicator */}
                  <div className="w-1 h-10 rounded-full shrink-0" style={{ background: typeColor }} />

                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
                    style={{ background: `${typeColor}15` }}>
                    {typeIcon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-medium text-citadel-text truncate">{r.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-medium capitalize"
                        style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
                      >
                        {r.type}
                      </span>
                      <TriggerBadge trigger={r.trigger || 'manual'} />
                      <span className="text-[10px] text-citadel-muted font-mono">{r.size_display}</span>
                      <span className="text-[10px] text-citadel-muted/50">{r.date}</span>
                      {r.time && <span className="text-[10px] text-citadel-muted/40 font-mono">{formatTimestamp(r.time)}</span>}
                      <span className="text-[10px] text-citadel-muted/40">{relativeTime(r.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <a
                    href={`/api/reports/download/${r.filename}`}
                    download
                    className="px-2.5 py-1.5 rounded-lg bg-citadel-accent/10 text-citadel-accent text-[10px] sm:text-xs font-medium hover:bg-citadel-accent/20 transition-colors border border-citadel-accent/20"
                  >
                    ↓ Download
                  </a>
                  <button
                    onClick={() => handleDelete(r.filename)}
                    disabled={deleting === r.filename}
                    className="px-2 py-1.5 rounded-lg bg-citadel-danger/10 text-citadel-danger text-[10px] sm:text-xs font-medium hover:bg-citadel-danger/20 transition-colors disabled:opacity-40 border border-citadel-danger/20"
                  >
                    {deleting === r.filename ? '…' : '✗'}
                  </button>
                </div>
              </motion.div>
            );
          })}
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
            Auto-scheduled reports are named with <TriggerBadge trigger="auto" /> trigger prefix
          </p>
        </div>
        <button
          onClick={() => fetchSchedules()}
          className="px-3 py-1.5 rounded-lg bg-citadel-bg border border-citadel-border text-xs text-citadel-muted hover:text-citadel-text hover:border-citadel-accent/20 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-12 bg-citadel-surface/30 border border-dashed border-citadel-border rounded-2xl">
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
              className={`bg-citadel-surface border rounded-2xl p-4 transition-all duration-300 hover:shadow-lg ${
                s.enabled ? 'border-citadel-success/20 hover:border-citadel-success/40 hover:shadow-citadel-success/5' : 'border-citadel-border opacity-60'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
                    s.enabled ? 'bg-citadel-success/10' : 'bg-citadel-muted/10'
                  }`}>
                    {s.type === 'daily' ? '📊' : s.type === 'weekly' ? '📈' : '🧪'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold capitalize">{s.type} Report</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        s.enabled
                          ? 'bg-citadel-success/15 text-citadel-success border border-citadel-success/20'
                          : 'bg-citadel-muted/15 text-citadel-muted border border-citadel-muted/20'
                      }`}>
                        {s.enabled ? 'Active' : 'Disabled'}
                      </span>
                      <TriggerBadge trigger="auto" />
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
                    <span className="text-[9px] bg-citadel-accent/10 text-citadel-accent px-1.5 py-0.5 rounded-full font-medium shrink-0 border border-citadel-accent/20">
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
      <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
        <h4 className="text-xs font-semibold text-citadel-muted mb-3 uppercase tracking-wider">Email Configuration</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'SMTP Host', value: '${SMTP_HOST}', desc: 'Set via environment variable' },
            { label: 'From Address', value: '${SMTP_USER}', desc: 'Sender email address' },
            { label: 'Recipients', value: '${REPORT_RECIPIENT}', desc: 'Comma-separated recipient list' },
            { label: 'TLS', value: 'Enabled', desc: 'Port 587 with STARTTLS' },
          ].map(item => (
            <div key={item.label} className="bg-citadel-bg rounded-xl p-2.5 border border-citadel-border/50 hover:border-citadel-accent/15 transition-colors">
              <div className="text-[10px] text-citadel-muted uppercase tracking-wider">{item.label}</div>
              <div className="text-xs font-mono text-citadel-text mt-0.5">{item.value}</div>
              <div className="text-[9px] text-citadel-muted/60 mt-0.5">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Output directory info */}
      <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
        <h4 className="text-xs font-semibold text-citadel-muted mb-2 uppercase tracking-wider">Output Configuration</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-citadel-bg rounded-xl p-2.5 border border-citadel-border/50">
            <div className="text-[10px] text-citadel-muted uppercase tracking-wider">Format</div>
            <div className="text-xs font-mono text-citadel-accent mt-0.5">PDF (matplotlib)</div>
          </div>
          <div className="bg-citadel-bg rounded-xl p-2.5 border border-citadel-border/50">
            <div className="text-[10px] text-citadel-muted uppercase tracking-wider">Output Directory</div>
            <div className="text-xs font-mono text-citadel-text mt-0.5">citadel/reports/</div>
          </div>
          <div className="bg-citadel-bg rounded-xl p-2.5 border border-citadel-border/50">
            <div className="text-[10px] text-citadel-muted uppercase tracking-wider">Naming Pattern</div>
            <div className="text-xs font-mono text-citadel-text mt-0.5">citadel_{'{trigger}_{type}_{date}_{time}'}.pdf</div>
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

  // Pie data by type
  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    savedReports.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      fill: TYPE_COLORS[name] || '#64748b',
    }));
  }, [savedReports]);

  // Pie data by trigger
  const triggerPieData = useMemo(() => {
    const counts: Record<string, number> = {};
    savedReports.forEach(r => { const t = r.trigger || 'manual'; counts[t] = (counts[t] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      fill: name === 'auto' ? '#f59e0b' : '#3b82f6',
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
      name: r.filename.replace('citadel_', '').replace('.pdf', '').replace(/_/g, ' '),
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
        <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
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

        {/* Reports by Trigger (Pie) */}
        <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
          <h4 className="text-xs font-medium text-citadel-muted mb-3">Manual vs Auto</h4>
          {triggerPieData.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={triggerPieData}
                    cx="50%" cy="50%"
                    innerRadius={40} outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="#0a0e17"
                    strokeWidth={2}
                  >
                    {triggerPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
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
        <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
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

        {/* File Sizes (Bar) */}
        <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
          <h4 className="text-xs font-medium text-citadel-muted mb-3">Report File Sizes (KB)</h4>
          {sizeData.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sizeData} margin={{ top: 2, right: 10, bottom: 2, left: 4 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.2} />
                  <XAxis type="number" stroke="#64748b" fontSize={9} tickFormatter={(v: number) => `${v}KB`} />
                  <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={8} width={100} />
                  <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(v: number) => [`${v} KB`, 'Size']}
                  />
                  <Bar dataKey="size" radius={[0, 4, 4, 0]} fill="#00d4ff" opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-citadel-muted">No saved reports</div>
          )}
        </div>
      </div>

      {/* Session History */}
      {history.length > 0 && (
        <div className="bg-citadel-surface border border-citadel-border rounded-2xl p-4">
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
                    <TriggerBadge trigger={h.trigger || 'manual'} />
                    {h.email && (
                      <span className="text-[9px] bg-citadel-accent/10 text-citadel-accent px-1.5 py-0.5 rounded-full font-medium border border-citadel-accent/20">+EMAIL</span>
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
          await triggerReport('daily', false, 'manual');
          const dur = (Date.now() - start) / 1000;
          const ts = new Date();
          const timeStr = ts.toTimeString().slice(0, 8).replace(/:/g, '');
          const fname = `citadel_manual_daily_${ts.toISOString().split('T')[0]}_${timeStr}.pdf`;
          setHistory(prev => [{
            id: nextId++, type: 'daily', path: `reports/${fname}`, filename: fname,
            timestamp: new Date().toISOString(), status: 'success', email: false, duration: dur, trigger: 'manual',
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
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-citadel-accent/20 to-blue-600/20 flex items-center justify-center text-xl border border-citadel-accent/20">
              📋
            </div>
            Reports Center
          </h1>
          <p className="text-xs sm:text-sm text-citadel-muted mt-1.5">
            Generate, manage, schedule, and analyze comprehensive PDF reports
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-citadel-muted/50 font-mono hidden sm:inline">
            {history.length > 0 ? `${history.length} generated this session` : 'Ready to generate'}
          </span>
        </div>
      </div>

      {/* ── Sub-tab navigation ── */}
      <div className="flex gap-1 bg-citadel-surface/60 backdrop-blur-sm border border-citadel-border rounded-2xl p-1.5 shadow-inner">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 ${
              subTab === t.key
                ? 'bg-citadel-bg text-citadel-accent shadow-lg border border-citadel-accent/25'
                : 'text-citadel-muted hover:text-citadel-text hover:bg-citadel-bg/40'
            }`}
          >
            <span className="text-sm">{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
            {subTab === t.key && (
              <motion.div
                layoutId="reportTabIndicator"
                className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-citadel-accent rounded-full"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
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
