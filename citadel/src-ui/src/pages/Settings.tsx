/**
 * CITADEL — Settings Page
 * System preferences, theme, notifications, API config, data management.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, type SystemSettings } from '../store';

type SettingsSection = 'general' | 'trading' | 'notifications' | 'data' | 'about';

const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: 'general',       label: 'General',       icon: '⚙️' },
  { id: 'trading',       label: 'Trading',       icon: '💹' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
  { id: 'data',          label: 'Data & Export',  icon: '💾' },
  { id: 'about',         label: 'About',         icon: 'ℹ️' },
];

const THEMES = [
  { id: 'dark', label: 'Dark', preview: 'bg-gray-900' },
  { id: 'midnight', label: 'Midnight', preview: 'bg-indigo-950' },
  { id: 'cyberpunk', label: 'Cyberpunk', preview: 'bg-fuchsia-950' },
  { id: 'light', label: 'Light', preview: 'bg-gray-100' },
];

const TIMEZONES = ['UTC', 'US/Eastern', 'US/Central', 'US/Pacific', 'Europe/London', 'Asia/Tokyo', 'Asia/Shanghai'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm text-citadel-text">{label}</span>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? 'bg-citadel-accent' : 'bg-citadel-border'
        }`}
      >
        <motion.div
          animate={{ x: enabled ? 20 : 2 }}
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md"
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </label>
  );
}

function SelectInput({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-citadel-text">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-citadel-bg border border-citadel-border rounded-lg px-3 py-1.5 text-sm text-citadel-text outline-none focus:border-citadel-accent"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function NumberInput({ value, onChange, label, min, max, step = 1, suffix = '' }: { value: number; onChange: (v: number) => void; label: string; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-citadel-text">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          className="bg-citadel-bg border border-citadel-border rounded-lg px-3 py-1.5 text-sm text-citadel-text outline-none focus:border-citadel-accent w-24 text-right"
        />
        {suffix && <span className="text-xs text-citadel-muted">{suffix}</span>}
      </div>
    </div>
  );
}

export default function Settings() {
  const [section, setSection] = useState<SettingsSection>('general');
  const settings = useStore((s) => s.systemSettings);
  const fetchSettings = useStore((s) => s.fetchSettings);
  const updateSettings = useStore((s) => s.updateSettings);
  const addToast = useStore((s) => s.addToast);
  const [local, setLocal] = useState<SystemSettings>(settings);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { setLocal(settings); setDirty(false); }, [settings]);

  const update = (patch: Partial<SystemSettings>) => {
    setLocal(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const save = () => {
    updateSettings(local);
    setDirty(false);
  };

  const resetDefaults = () => {
    const defaults: SystemSettings = {
      theme: 'dark', notification_sound: true, auto_refresh_interval: 5,
      default_order_size_pct: 5.0, show_pnl_in_header: true, compact_mode: false,
      timezone: 'UTC', currency: 'USD',
    };
    setLocal(defaults);
    updateSettings(defaults);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-citadel-text">Settings</h1>
          <p className="text-xs text-citadel-muted mt-1">Configure your CITADEL trading platform</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetDefaults} className="px-3 py-1.5 text-xs rounded-lg border border-citadel-border text-citadel-muted hover:text-citadel-text hover:bg-citadel-surface transition-colors">
            Reset Defaults
          </button>
          {dirty && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={save}
              className="px-4 py-1.5 text-xs rounded-lg bg-citadel-accent text-white font-semibold hover:bg-citadel-accent/80 transition-colors"
            >
              Save Changes
            </motion.button>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0">
          <nav className="space-y-1">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  section === s.id
                    ? 'bg-citadel-accent/10 text-citadel-accent font-medium'
                    : 'text-citadel-muted hover:text-citadel-text hover:bg-citadel-surface'
                }`}
              >
                <span className="text-xs">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <motion.div
            key={section}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-citadel-card rounded-2xl border border-citadel-border p-6 space-y-5"
          >
            {section === 'general' && (
              <>
                <h2 className="text-sm font-semibold text-citadel-text mb-4">General Settings</h2>

                {/* Theme */}
                <div>
                  <label className="text-sm text-citadel-text mb-2 block">Theme</label>
                  <div className="grid grid-cols-4 gap-2">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => update({ theme: t.id })}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                          local.theme === t.id
                            ? 'border-citadel-accent bg-citadel-accent/5'
                            : 'border-citadel-border hover:border-citadel-accent/30'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg ${t.preview} border border-white/10`} />
                        <span className="text-xs text-citadel-muted">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <SelectInput label="Timezone" value={local.timezone} options={TIMEZONES} onChange={v => update({ timezone: v })} />
                <SelectInput label="Currency" value={local.currency} options={CURRENCIES} onChange={v => update({ currency: v })} />
                <Toggle label="Compact Mode" enabled={local.compact_mode} onChange={v => update({ compact_mode: v })} />
                <Toggle label="Show P&L in Header" enabled={local.show_pnl_in_header} onChange={v => update({ show_pnl_in_header: v })} />
                <NumberInput label="Auto Refresh Interval" value={local.auto_refresh_interval} min={0} max={60} suffix="sec" onChange={v => update({ auto_refresh_interval: v })} />
              </>
            )}

            {section === 'trading' && (
              <>
                <h2 className="text-sm font-semibold text-citadel-text mb-4">Trading Defaults</h2>
                <NumberInput label="Default Order Size" value={local.default_order_size_pct} min={0.1} max={100} step={0.5} suffix="%" onChange={v => update({ default_order_size_pct: v })} />

                {/* Portfolio settings shortcut */}
                <div className="mt-6 p-4 bg-citadel-surface rounded-xl border border-citadel-border">
                  <h3 className="text-xs font-semibold text-citadel-muted mb-2">Portfolio Risk Limits</h3>
                  <p className="text-xs text-citadel-muted">
                    Configure risk limits, stop-loss defaults, and position sizing on the{' '}
                    <button onClick={() => useStore.getState().setTab('portfolio')} className="text-citadel-accent hover:underline">
                      Portfolio page
                    </button>.
                  </p>
                </div>

                <div className="mt-4 p-4 bg-citadel-surface rounded-xl border border-citadel-border">
                  <h3 className="text-xs font-semibold text-citadel-muted mb-2">Daily Investment Limits</h3>
                  <p className="text-xs text-citadel-muted">
                    Set daily limits on the{' '}
                    <button onClick={() => useStore.getState().setTab('trading')} className="text-citadel-accent hover:underline">
                      Trading page
                    </button>.
                  </p>
                </div>
              </>
            )}

            {section === 'notifications' && (
              <>
                <h2 className="text-sm font-semibold text-citadel-text mb-4">Notification Preferences</h2>
                <Toggle label="Notification Sounds" enabled={local.notification_sound} onChange={v => update({ notification_sound: v })} />

                <div className="mt-6 space-y-3">
                  <h3 className="text-xs font-semibold text-citadel-muted">Alert Types</h3>
                  <div className="space-y-2.5">
                    {[
                      { label: 'Trade Executions', desc: 'Notify when orders are filled' },
                      { label: 'Price Alerts', desc: 'Notify when price conditions are met' },
                      { label: 'P&L Thresholds', desc: 'Notify on profit/loss milestones' },
                      { label: 'Agent Actions', desc: 'Notify when agents make decisions' },
                      { label: 'System Events', desc: 'Notify on kill switch, errors, etc.' },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between p-3 bg-citadel-surface rounded-lg border border-citadel-border">
                        <div>
                          <p className="text-sm text-citadel-text">{item.label}</p>
                          <p className="text-[10px] text-citadel-muted">{item.desc}</p>
                        </div>
                        <div className="w-10 h-5 rounded-full bg-citadel-accent relative">
                          <div className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-md" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {section === 'data' && (
              <>
                <h2 className="text-sm font-semibold text-citadel-text mb-4">Data & Export</h2>

                <div className="space-y-3">
                  <button
                    onClick={() => addToast({ type: 'info', title: 'Export Started', message: 'Preparing portfolio data...' })}
                    className="w-full flex items-center gap-3 p-4 bg-citadel-surface rounded-xl border border-citadel-border hover:border-citadel-accent/30 transition-colors group"
                  >
                    <span className="text-lg">📊</span>
                    <div className="text-left flex-1">
                      <p className="text-sm text-citadel-text group-hover:text-citadel-accent transition-colors">Export Portfolio Data</p>
                      <p className="text-[10px] text-citadel-muted">Download positions, trades, P&L as CSV</p>
                    </div>
                    <span className="text-citadel-muted text-xs">CSV</span>
                  </button>

                  <button
                    onClick={() => addToast({ type: 'info', title: 'Export Started', message: 'Preparing trade history...' })}
                    className="w-full flex items-center gap-3 p-4 bg-citadel-surface rounded-xl border border-citadel-border hover:border-citadel-accent/30 transition-colors group"
                  >
                    <span className="text-lg">📈</span>
                    <div className="text-left flex-1">
                      <p className="text-sm text-citadel-text group-hover:text-citadel-accent transition-colors">Export Trade History</p>
                      <p className="text-[10px] text-citadel-muted">Download all trade records</p>
                    </div>
                    <span className="text-citadel-muted text-xs">CSV</span>
                  </button>

                  <button
                    onClick={() => addToast({ type: 'info', title: 'Backup Started', message: 'Creating system backup...' })}
                    className="w-full flex items-center gap-3 p-4 bg-citadel-surface rounded-xl border border-citadel-border hover:border-citadel-accent/30 transition-colors group"
                  >
                    <span className="text-lg">💾</span>
                    <div className="text-left flex-1">
                      <p className="text-sm text-citadel-text group-hover:text-citadel-accent transition-colors">Full System Backup</p>
                      <p className="text-[10px] text-citadel-muted">Export all settings, positions, alerts, and agent configs</p>
                    </div>
                    <span className="text-citadel-muted text-xs">JSON</span>
                  </button>
                </div>

                <div className="mt-6 p-4 bg-red-500/5 rounded-xl border border-red-500/20">
                  <h3 className="text-sm font-semibold text-red-400 mb-1">Danger Zone</h3>
                  <p className="text-xs text-citadel-muted mb-3">These actions cannot be undone.</p>
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
                      Clear Trade History
                    </button>
                    <button className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
                      Reset All Settings
                    </button>
                  </div>
                </div>
              </>
            )}

            {section === 'about' && (
              <>
                <h2 className="text-sm font-semibold text-citadel-text mb-4">About CITADEL</h2>

                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-citadel-accent to-blue-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-citadel-accent/30">
                      C
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-citadel-text">CITADEL</h3>
                      <p className="text-xs text-citadel-muted">Multi-Agent Trading System</p>
                      <p className="text-xs text-citadel-accent font-mono mt-1">v2.0.0</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4">
                    {[
                      { label: 'Framework', value: 'React 19 + FastAPI' },
                      { label: 'State', value: 'Zustand 5' },
                      { label: 'UI Framework', value: 'Tailwind CSS 3' },
                      { label: 'Animations', value: 'Framer Motion 11' },
                      { label: 'Charts', value: 'Recharts 2' },
                      { label: 'Desktop', value: 'Tauri 2' },
                    ].map(item => (
                      <div key={item.label} className="p-3 bg-citadel-surface rounded-lg border border-citadel-border">
                        <p className="text-[10px] text-citadel-muted">{item.label}</p>
                        <p className="text-sm text-citadel-text font-medium">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 p-4 bg-citadel-surface rounded-xl border border-citadel-border">
                    <h3 className="text-xs font-semibold text-citadel-muted mb-2">Agents</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-2"><span>🛡️</span><span className="text-citadel-text">Sentinel — Risk Management</span></div>
                      <div className="flex items-center gap-2"><span>📚</span><span className="text-citadel-text">Librarian — Data & Research</span></div>
                      <div className="flex items-center gap-2"><span>⚔️</span><span className="text-citadel-text">Tactician — Strategy Execution</span></div>
                      <div className="flex items-center gap-2"><span>🎓</span><span className="text-citadel-text">Student — Adaptive Learning</span></div>
                    </div>
                  </div>

                  <p className="text-[10px] text-citadel-muted text-center mt-4">
                    Built with enterprise-grade architecture. Powered by multi-agent AI.
                  </p>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
