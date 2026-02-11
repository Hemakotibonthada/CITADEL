/**
 * CITADEL — News Feed Page
 * Enhanced news feed with sentiment analysis badges, source filters, and responsive layout.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';

interface NewsItem {
  id: number;
  title: string;
  source: string;
  time: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;
  symbols: string[];
  summary: string;
}

const SENT_STYLES = {
  bullish: { bg: 'bg-citadel-success/15', text: 'text-citadel-success', label: 'BULLISH' },
  bearish: { bg: 'bg-citadel-danger/15', text: 'text-citadel-danger', label: 'BEARISH' },
  neutral: { bg: 'bg-gray-500/15', text: 'text-gray-400', label: 'NEUTRAL' },
};

export default function NewsPage() {
  const news = useStore((s) => s.news);
  const fetchNews = useStore((s) => s.fetchNews);
  const [filter, setFilter] = useState<'all' | 'bullish' | 'bearish' | 'neutral'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);

  useEffect(() => { fetchNews(); }, []);

  const allNews: NewsItem[] = news.map((n, i) => ({
    id: i, title: n.title, source: n.source || 'Unknown', time: n.timestamp || '',
    sentiment: (n.score > 0.3 ? 'bullish' : n.score < -0.3 ? 'bearish' : 'neutral') as NewsItem['sentiment'],
    score: n.score, symbols: n.symbols || [], summary: n.title,
  }));

  const filtered = filter === 'all' ? allNews : allNews.filter(n => n.sentiment === filter);

  if (allNews.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Market News & Sentiment</h1>
          <p className="text-xs sm:text-sm text-citadel-muted mt-1">AI-analyzed news with FinBERT sentiment scoring.</p>
        </div>
        <div className="bg-citadel-card border border-citadel-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">📰</span>
          <p className="text-citadel-muted text-sm">No news available yet. News will appear when the system is live.</p>
          <button onClick={() => fetchNews()} className="mt-4 px-4 py-2 rounded-xl bg-citadel-accent/15 text-citadel-accent text-xs font-medium hover:bg-citadel-accent/25 transition">Refresh</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Market News & Sentiment</h1>
        <p className="text-xs sm:text-sm text-citadel-muted mt-1">AI-analyzed news with FinBERT sentiment scoring.</p>
      </div>

      {/* Sentiment summary */}
      <div className="grid grid-cols-3 gap-3">
        {(['bullish', 'bearish', 'neutral'] as const).map(s => {
          const count = allNews.filter(n => n.sentiment === s).length;
          const style = SENT_STYLES[s];
          return (
            <div key={s} className={`${style.bg} rounded-xl p-3 text-center`}>
              <div className={`text-lg sm:text-2xl font-bold font-mono ${style.text}`}>{count}</div>
              <div className="text-[10px] sm:text-xs text-citadel-muted uppercase">{s}</div>
            </div>
          );
        })}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-1">
        {(['all', 'bullish', 'bearish', 'neutral'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] sm:text-xs px-3 py-1.5 rounded-lg uppercase font-medium transition-colors ${
              filter === f ? 'bg-citadel-accent text-citadel-bg' : 'text-citadel-muted hover:bg-citadel-surface'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* News list */}
      <div className="space-y-2">
        {filtered.map((item, i) => {
          const style = SENT_STYLES[item.sentiment];
          const isExpanded = expandedId === item.id;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="bg-citadel-surface border border-citadel-border rounded-xl overflow-hidden hover:border-citadel-accent/30 transition-colors"
            >
              <button
                className="w-full text-left p-3 sm:p-4"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Sentiment badge */}
                  <div className={`${style.bg} ${style.text} text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 min-w-[55px] text-center`}>
                    {style.label}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-medium leading-snug">{item.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-[10px] sm:text-xs text-citadel-muted">{item.source}</span>
                      <span className="text-citadel-border">•</span>
                      <span className="text-[10px] sm:text-xs text-citadel-muted">{item.time}</span>
                      <span className="text-citadel-border">•</span>
                      <span className={`text-[10px] sm:text-xs font-mono ${item.score > 0 ? 'text-citadel-success' : item.score < 0 ? 'text-citadel-danger' : 'text-gray-400'}`}>
                        Score: {item.score > 0 ? '+' : ''}{item.score.toFixed(2)}
                      </span>
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

                  {/* Expand indicator */}
                  <span className={`text-citadel-muted text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                </div>
              </button>

              {/* Expanded summary */}
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  className="px-4 pb-4 border-t border-citadel-border/30"
                >
                  <p className="text-xs sm:text-sm text-citadel-text/80 leading-relaxed pt-3">{item.summary}</p>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
