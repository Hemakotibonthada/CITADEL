/**
 * CITADEL — News Feed Page
 * Enhanced news feed with sentiment analysis badges, source filters, and responsive layout.
 */
import { useState } from 'react';
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

function generateDemoNews(): NewsItem[] {
  return [
    { id: 1, title: 'Apple iPhone 16 Pre-Orders Exceed Expectations, Analysts Raise Price Targets', source: 'Reuters', time: '2 min ago', sentiment: 'bullish', score: 0.87, symbols: ['AAPL'], summary: 'Pre-order numbers for the iPhone 16 series surpassed Wall Street estimates by 12%, prompting multiple analyst upgrades. Morgan Stanley raised PT to $220.' },
    { id: 2, title: 'NVIDIA Data Center Revenue Surges 154% YoY Amid AI Demand', source: 'Bloomberg', time: '15 min ago', sentiment: 'bullish', score: 0.92, symbols: ['NVDA'], summary: 'NVIDIA reported record data center revenue driven by enterprise AI adoption. Demand for H100/H200 GPUs continues to outstrip supply.' },
    { id: 3, title: 'Federal Reserve Minutes Signal Potential Rate Cut in September', source: 'CNBC', time: '32 min ago', sentiment: 'bullish', score: 0.71, symbols: ['SPY', 'QQQ'], summary: 'Minutes from the July FOMC meeting revealed growing support for policy easing, with several members noting downside risks to employment.' },
    { id: 4, title: 'Tesla Faces Investigation Over Autopilot Safety Concerns in Europe', source: 'Financial Times', time: '1 hr ago', sentiment: 'bearish', score: -0.65, symbols: ['TSLA'], summary: 'EU regulators have opened a formal investigation into Tesla\'s Full Self-Driving software following three reported incidents in Germany and France.' },
    { id: 5, title: 'Microsoft Azure Cloud Growth Decelerates to 29% in Q3', source: 'WSJ', time: '1.5 hr ago', sentiment: 'bearish', score: -0.42, symbols: ['MSFT'], summary: 'Azure growth slowed from 31% in the prior quarter, slightly missing analyst expectations. Competition from AWS and Google Cloud intensifies.' },
    { id: 6, title: 'Crude Oil Prices Stabilize Amid OPEC+ Production Cuts', source: 'Reuters', time: '2 hr ago', sentiment: 'neutral', score: 0.12, symbols: ['USO', 'XOM', 'CVX'], summary: 'WTI crude settled at $78.50/barrel as OPEC+ voluntary production cuts offset concerns about Chinese demand weakness.' },
    { id: 7, title: 'Amazon Expands Same-Day Delivery to 30 New Metro Areas', source: 'TechCrunch', time: '2.5 hr ago', sentiment: 'bullish', score: 0.58, symbols: ['AMZN'], summary: 'Amazon announced expansion of its same-day delivery network, investing $2.1B in new fulfillment infrastructure across the US and Europe.' },
    { id: 8, title: 'Biotech Sector Rally Continues as FDA Approves Novel Gene Therapy', source: 'Stat News', time: '3 hr ago', sentiment: 'bullish', score: 0.79, symbols: ['XBI', 'IBB'], summary: 'The FDA granted full approval to a groundbreaking gene therapy for sickle cell disease, boosting sentiment across the biotech sector.' },
    { id: 9, title: 'China Manufacturing PMI Contracts for Fourth Consecutive Month', source: 'Bloomberg', time: '4 hr ago', sentiment: 'bearish', score: -0.53, symbols: ['FXI', 'EEM'], summary: 'Official manufacturing PMI came in at 49.1, below the 50 threshold, signaling ongoing contraction in China\'s industrial sector.' },
    { id: 10, title: 'Bond Yields Retreat as Investors Price In Rate Cuts', source: 'MarketWatch', time: '5 hr ago', sentiment: 'neutral', score: 0.08, symbols: ['TLT', 'AGG'], summary: 'The 10-year Treasury yield fell to 4.15%, its lowest in three weeks, as markets price in two rate cuts by year-end.' },
  ];
}

const SENT_STYLES = {
  bullish: { bg: 'bg-citadel-success/15', text: 'text-citadel-success', label: 'BULLISH' },
  bearish: { bg: 'bg-citadel-danger/15', text: 'text-citadel-danger', label: 'BEARISH' },
  neutral: { bg: 'bg-gray-500/15', text: 'text-gray-400', label: 'NEUTRAL' },
};

export default function NewsPage() {
  const news = useStore((s) => s.news);
  const [demoNews] = useState(generateDemoNews);
  const [filter, setFilter] = useState<'all' | 'bullish' | 'bearish' | 'neutral'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);

  // Use API news if available, fallback to demo
  const allNews: NewsItem[] = news.length > 0
    ? news.map((n, i) => ({
        id: i, title: n.title, source: n.source || 'Unknown', time: n.timestamp || '',
        sentiment: (n.score > 0.3 ? 'bullish' : n.score < -0.3 ? 'bearish' : 'neutral') as NewsItem['sentiment'],
        score: n.score, symbols: n.symbols || [], summary: n.title,
      }))
    : demoNews;

  const filtered = filter === 'all' ? allNews : allNews.filter(n => n.sentiment === filter);

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
