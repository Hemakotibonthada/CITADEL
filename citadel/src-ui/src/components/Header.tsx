/**
 * CITADEL — Responsive Header
 * Navigation bar with hamburger menu for mobile, system status, and tab switching.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, type Tab } from '../store';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'portfolio', label: 'Portfolio', icon: '💼' },
  { id: 'trading',   label: 'Trading',   icon: '💹' },
  { id: 'agents',    label: 'Agents',    icon: '🤖' },
  { id: 'models',    label: 'Models',    icon: '🧠' },
  { id: 'brain',     label: 'Brain',     icon: '⚡' },
  { id: 'news',      label: 'News',      icon: '📰' },
  { id: 'reports',   label: 'Reports',   icon: '📋' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
  { id: 'invest',    label: 'Invest',    icon: '📌' },
  { id: 'settings',  label: 'Settings',  icon: '⚙️' },
];

const STATE_COLORS: Record<string, string> = {
  LIVE: 'bg-citadel-success', PAPER: 'bg-yellow-400', IDLE: 'bg-gray-500',
  BACKTEST: 'bg-blue-400', HALTED: 'bg-orange-400', ERROR: 'bg-citadel-danger',
};

export default function Header() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setTab);
  const systemState = useStore((s) => s.systemState);
  const wsConnected = useStore((s) => s.connected);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const alerts = useStore((s) => s.alerts);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeAlertCount = alerts?.active ?? 0;

  return (
    <header className="sticky top-0 z-40 bg-citadel-bg/90 backdrop-blur-md border-b border-citadel-border">
      <div className="max-w-7xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-12 sm:h-14">
          {/* Logo / Title */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-citadel-accent to-blue-600 flex items-center justify-center text-xs sm:text-sm font-bold text-white shadow-lg shadow-citadel-accent/20">
              C
            </div>
            <div className="hidden xs:block">
              <span className="font-bold text-sm sm:text-base tracking-wide">CITADEL</span>
              <span className="text-[9px] sm:text-[10px] text-citadel-muted ml-1.5 font-mono">v2.0</span>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-2.5 lg:px-3 py-1.5 rounded-lg text-xs lg:text-sm font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'text-citadel-accent bg-citadel-accent/10'
                    : 'text-citadel-muted hover:text-citadel-text hover:bg-citadel-surface/50'
                }`}
              >
                <span className="text-xs">{tab.icon}</span>
                <span className="hidden lg:inline">{tab.label}</span>
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-citadel-accent rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </nav>

          {/* Status indicators + hamburger */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Command Palette trigger */}
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-citadel-border bg-citadel-surface/50 hover:border-citadel-accent/30 transition-colors group"
              title="Command Palette (Ctrl+K)"
            >
              <span className="text-xs text-citadel-muted group-hover:text-citadel-accent">🔍</span>
              <span className="text-[10px] text-citadel-muted hidden lg:inline">Search</span>
              <kbd className="text-[9px] text-citadel-muted bg-citadel-bg px-1 py-0.5 rounded border border-citadel-border font-mono ml-1">⌘K</kbd>
            </button>

            {/* Alert bell */}
            <button
              onClick={() => setActiveTab('trading' as Tab)}
              className="relative p-1.5 rounded-lg hover:bg-citadel-surface transition-colors"
              title={`${activeAlertCount} active alerts`}
            >
              <span className="text-sm">🔔</span>
              {activeAlertCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-citadel-accent rounded-full text-[8px] font-bold text-white flex items-center justify-center">
                  {activeAlertCount}
                </span>
              )}
            </button>

            {/* System state */}
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${STATE_COLORS[systemState] || 'bg-gray-500'} ${systemState === 'LIVE' ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] sm:text-xs font-mono text-citadel-muted hidden sm:inline">{systemState}</span>
            </div>

            {/* WS status */}
            <div className="flex items-center gap-1" title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-citadel-success' : 'bg-citadel-danger animate-pulse'}`} />
              <span className="text-[9px] font-mono text-citadel-muted hidden sm:inline">{wsConnected ? 'WS' : 'OFF'}</span>
            </div>

            {/* Hamburger menu (mobile) */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden flex flex-col gap-1 p-1.5 rounded-lg hover:bg-citadel-surface transition-colors"
              aria-label="Toggle navigation"
            >
              <motion.span animate={mobileOpen ? { rotate: 45, y: 5 } : { rotate: 0, y: 0 }} className="w-4 h-0.5 bg-citadel-text block" />
              <motion.span animate={mobileOpen ? { opacity: 0 } : { opacity: 1 }} className="w-4 h-0.5 bg-citadel-text block" />
              <motion.span animate={mobileOpen ? { rotate: -45, y: -5 } : { rotate: 0, y: 0 }} className="w-4 h-0.5 bg-citadel-text block" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden border-t border-citadel-border bg-citadel-bg/95 backdrop-blur-md"
          >
            <nav className="p-2 space-y-0.5">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setMobileOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    activeTab === tab.id
                      ? 'text-citadel-accent bg-citadel-accent/10'
                      : 'text-citadel-muted hover:text-citadel-text hover:bg-citadel-surface'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
