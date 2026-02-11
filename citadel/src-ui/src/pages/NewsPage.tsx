/**
 * CITADEL — News Feed Page
 * Live news from NewsAPI + Finnhub with FinBERT sentiment analysis.
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';

type Sentiment = 'bullish' | 'bearish' | 'neutral';

interface DisplayItem {
  id: number;
  title: string;
  source: string;
  time: string;
  timeAgo: string;
  sentiment: Sentiment;
  score: number;
  symbols: string[];
  summary: string;
  url: string;
  imageUrl: string;
  provider: string;
}

const SENT_STYLES = {
  bullish: { bg: 'bg-citadel-success/15', text: 'text-citadel-success', label: 'BULLISH', icon: '▲' },
  bearish: { bg: 'bg-citadel-danger/15', text: 'text-citadel-danger', label: 'BEARISH', icon: '▼' },
  neutral: { bg: 'bg-gray-500/15', text: 'text-gray-400', label: 'NEUTRAL', icon: '●' },
};

function timeAgo(ts: string): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function deriveSentiment(score: number, label?: string): Sentiment {
  if (label === 'bullish' || label === 'bearish' || label === 'neutral') return label;
  if (score > 0.3) return 'bullish';
  if (score < -0.3) return 'bearish';
  return 'neutral';
}

export default function NewsPage() {
  const news = useStore((s) => s.news);
  const fetchNews = useStore((s) => s.fetchNews);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);
  const [filter, setFilter] = useState<'all' | Sentiment>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(async () => {
    setLoading(true);
    await fetchNews();
    setLoading(false);
  }, [fetchNews]);

  useEffect(() => { doFetch(); }, []);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const iv = setInterval(doFetch, 120_000);
    return () => clearInterval(iv);
  }, [doFetch]);

  const items: DisplayItem[] = news.map((n, i) => ({
    id: i,
    title: n.title,
    source: n.source || 'Unknown',
    time: n.timestamp || '',
    timeAgo: timeAgo(n.timestamp),
    sentiment: deriveSentiment(n.score, n.sentiment),
    score: n.score,
    symbols: n.symbols || [],
    summary: n.summary || n.title,
    url: n.url || '',
    imageUrl: n.image_url || '',
    provider: n.provider || '',
  }));

  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  items.forEach(n => counts[n.sentiment]++);
  const filtered = filter === 'all' ? items : items.filter(n => n.sentiment === filter);

  /* ── Empty State ── */
  if (!loading && items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <Header />
        <div className="bg-citadel-card border border-citadel-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">📰</span>
          <p className="text-citadel-muted text-sm">Fetching live news from NewsAPI &amp; Finnhub…</p>
          <button onClick={doFetch}
            className="mt-4 px-4 py-2 rounded-xl bg-citadel-accent/15 text-citadel-accent text-xs font-medium hover:bg-citadel-accent/25 transition">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  /* ── Main View ── */
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Header />
        <button onClick={doFetch} disabled={loading}
          className={`text-[10px] sm:text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-citadel-accent/15 text-citadel-accent hover:bg-citadel-accent/25 ${loading ? 'animate-pulse' : ''}`}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Sentiment Summary */}
      <div className="grid grid-cols-3 gap-3">
        {(['bullish', 'bearish', 'neutral'] as const).map(s => {
          const style = SENT_STYLES[s];
          return (
            <button key={s} onClick={() => setFilter(f => f === s ? 'all' : s)}
              className={`${style.bg} rounded-xl p-3 text-center transition-all ${filter === s ? 'ring-1 ring-citadel-accent' : ''}`}>
              <div className={`text-lg sm:text-2xl font-bold font-mono ${style.text}`}>{counts[s]}</div>
              <div className="text-[10px] sm:text-xs text-citadel-muted uppercase">{s}</div>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1">
        {(['all', 'bullish', 'bearish', 'neutral'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] sm:text-xs px-3 py-1.5 rounded-lg uppercase font-medium transition-colors ${
              filter === f ? 'bg-citadel-accent text-citadel-bg' : 'text-citadel-muted hover:bg-citadel-surface'
            }`}>
            {f}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-citadel-muted">{filtered.length} articles</span>
      </div>

      {/* News list */}
      <div className="space-y-2">
        <AnimatePresence>
          {filtered.map((item, i) => {
            const style = SENT_STYLES[item.sentiment];
            const isExpanded = expandedId === item.id;
            return (
              <motion.div key={item.id}
                layout
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ delay: i * 0.02, duration: 0.25 }}
                className="bg-citadel-surface border border-citadel-border rounded-xl overflow-hidden hover:border-citadel-accent/30 transition-colors"
              >
                <div role="button" tabIndex={0} className="w-full text-left p-3 sm:p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : item.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : item.id); } }}>
                  <div className="flex items-start gap-3">
                    {/* Sentiment badge */}
                    <div className={`${style.bg} ${style.text} text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 min-w-[55px] text-center`}>
                      {style.icon} {style.label}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm sm:text-base font-medium leading-snug">{item.title}</h3>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5">
                        <span className="text-[10px] sm:text-xs text-citadel-accent/70 font-medium">{item.source}</span>
                        <span className="text-citadel-border">•</span>
                        <span className="text-[10px] sm:text-xs text-citadel-muted">{item.timeAgo}</span>
                        <span className="text-citadel-border">•</span>
                        <span className={`text-[10px] sm:text-xs font-mono ${item.score > 0 ? 'text-citadel-success' : item.score < 0 ? 'text-citadel-danger' : 'text-gray-400'}`}>
                          {item.score > 0 ? '+' : ''}{item.score.toFixed(2)}
                        </span>
                        {item.provider && (
                          <>
                            <span className="text-citadel-border">•</span>
                            <span className="text-[10px] text-citadel-muted/50 uppercase">{item.provider}</span>
                          </>
                        )}
                      </div>
                      {/* Symbols */}
                      {item.symbols.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.symbols.map(sym => (
                            <button key={sym} onClick={(e) => { e.stopPropagation(); fetchStockDetail(sym); }}
                              className="text-[9px] sm:text-[10px] font-mono bg-citadel-accent/10 text-citadel-accent px-1.5 py-0.5 rounded hover:bg-citadel-accent/20 transition-colors">
                              ${sym}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <span className={`text-citadel-muted text-xs transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="px-4 pb-4 border-t border-citadel-border/30"
                    >
                      <div className="pt-3 flex gap-4">
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt="" className="w-24 h-16 object-cover rounded-lg flex-shrink-0" loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm text-citadel-text/80 leading-relaxed">{item.summary}</p>
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noopener noreferrer"
                              className="inline-block mt-2 text-[10px] sm:text-xs text-citadel-accent hover:underline">
                              Read full article →
                            </a>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold">Market News & Sentiment</h1>
      <p className="text-xs sm:text-sm text-citadel-muted mt-1">Live news from NewsAPI &amp; Finnhub · FinBERT sentiment analysis</p>
    </div>
  );
}