/**
 * CITADEL — Command Palette (Ctrl+K)
 * Keyboard-driven fuzzy search for navigating pages, running actions, and finding stocks.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore, type Tab } from '../store';

interface CommandItem {
  id: string;
  label: string;
  category: 'navigation' | 'action' | 'stock';
  icon: string;
  shortcut?: string;
  action: () => void;
}

const POPULAR_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'SPY', 'QQQ', 'AMD', 'NFLX', 'DIS', 'BABA', 'INTC', 'PYPL'];

export default function CommandPalette() {
  const open = useStore((s) => s.commandPaletteOpen);
  const setOpen = useStore((s) => s.setCommandPaletteOpen);
  const setTab = useStore((s) => s.setTab);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);
  const addToast = useStore((s) => s.addToast);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build command list
  const commands = useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = [
      { id: 'nav-dashboard',  label: 'Go to Dashboard',     category: 'navigation', icon: '📊', shortcut: undefined, action: () => setTab('dashboard' as Tab) },
      { id: 'nav-portfolio',  label: 'Go to Portfolio',     category: 'navigation', icon: '💼', action: () => setTab('portfolio' as Tab) },
      { id: 'nav-trading',    label: 'Go to Trading',       category: 'navigation', icon: '💹', action: () => setTab('trading' as Tab) },
      { id: 'nav-agents',     label: 'Go to Agents',        category: 'navigation', icon: '🤖', action: () => setTab('agents' as Tab) },
      { id: 'nav-models',     label: 'Go to Models',        category: 'navigation', icon: '🧠', action: () => setTab('models' as Tab) },
      { id: 'nav-brain',      label: 'Go to Brain (CoT)',   category: 'navigation', icon: '⚡', action: () => setTab('brain' as Tab) },
      { id: 'nav-news',       label: 'Go to News',          category: 'navigation', icon: '📰', action: () => setTab('news' as Tab) },
      { id: 'nav-reports',    label: 'Go to Reports',       category: 'navigation', icon: '📋', action: () => setTab('reports' as Tab) },
      { id: 'nav-analytics',  label: 'Go to Analytics',     category: 'navigation', icon: '📈', action: () => setTab('analytics' as Tab) },
      { id: 'nav-settings',   label: 'Go to Settings',      category: 'navigation', icon: '⚙️', shortcut: undefined, action: () => setTab('settings' as Tab) },
    ];

    const actionItems: CommandItem[] = [
      { id: 'act-refresh', label: 'Refresh All Data', category: 'action', icon: '🔄', action: () => addToast({ type: 'info', title: 'Refreshing...', message: 'Fetching latest data' }) },
      { id: 'act-report',  label: 'Generate Report',  category: 'action', icon: '📄', action: () => { setTab('reports' as Tab); } },
      { id: 'act-train',   label: 'Start Training',   category: 'action', icon: '🎯', action: () => setTab('models' as Tab) },
    ];

    const stockItems: CommandItem[] = POPULAR_STOCKS.map(s => ({
      id: `stock-${s}`,
      label: `View ${s} Chart`,
      category: 'stock' as const,
      icon: '📉',
      action: () => fetchStockDetail(s),
    }));

    return [...navItems, ...actionItems, ...stockItems];
  }, [setTab, fetchStockDetail, addToast]);

  // Filter commands based on query
  const filtered = useMemo(() => {
    if (!query) return commands.slice(0, 12);
    const q = query.toLowerCase();
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [commands, query]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        filtered[selectedIdx].action();
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }, [filtered, selectedIdx, setOpen]);

  // Global Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // Keep selectedIdx in bounds
  useEffect(() => {
    setSelectedIdx(i => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered]);

  const categoryLabels: Record<string, string> = {
    navigation: 'Pages',
    action: 'Actions',
    stock: 'Stocks',
  };

  // Group filtered by category
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filtered.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }, [filtered]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]"
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-[91] rounded-2xl border border-citadel-border bg-citadel-surface/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-citadel-border">
              <span className="text-citadel-muted text-sm">🔍</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
                onKeyDown={handleKeyDown}
                placeholder="Search pages, actions, stocks..."
                className="flex-1 bg-transparent text-citadel-text text-sm outline-none placeholder:text-citadel-muted/50"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="text-[10px] text-citadel-muted bg-citadel-bg px-1.5 py-0.5 rounded border border-citadel-border font-mono">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-citadel-muted text-sm">
                  No results for "{query}"
                </div>
              ) : (
                <>
                  {Object.entries(grouped).map(([category, items]) => (
                    <div key={category}>
                      <div className="px-4 py-1 text-[10px] font-semibold text-citadel-muted uppercase tracking-wider">
                        {categoryLabels[category] || category}
                      </div>
                      {items.map((item) => {
                        const globalIdx = filtered.indexOf(item);
                        const selected = globalIdx === selectedIdx;
                        return (
                          <button
                            key={item.id}
                            onClick={() => { item.action(); setOpen(false); }}
                            onMouseEnter={() => setSelectedIdx(globalIdx)}
                            className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                              selected
                                ? 'bg-citadel-accent/10 text-citadel-accent'
                                : 'text-citadel-text hover:bg-citadel-surface'
                            }`}
                          >
                            <span className="text-xs w-5 text-center">{item.icon}</span>
                            <span className="flex-1 text-left">{item.label}</span>
                            {item.shortcut && (
                              <kbd className="text-[10px] text-citadel-muted bg-citadel-bg px-1.5 py-0.5 rounded border border-citadel-border font-mono">
                                {item.shortcut}
                              </kbd>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-citadel-border text-[10px] text-citadel-muted">
              <span>↑↓ Navigate • Enter Select • Esc Close</span>
              <span className="font-mono">Ctrl+K</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
