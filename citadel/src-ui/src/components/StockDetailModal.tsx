/**
 * CITADEL — Stock Detail Modal
 * Full-screen overlay with candlestick-style chart, volume bars, key stats, and trade action.
 */
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Area, BarChart, Cell,
} from 'recharts';
import { useStore } from '../store';

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Custom candlestick-style renderer using OHLC as high-low range with colored bars */
function CandlestickChart({ candles }: { candles: Array<{date:string;open:number;high:number;low:number;close:number;volume:number}> }) {
  // Transform for recharts: show close as area, high/low as range
  const data = candles.slice(-60).map((c, i) => ({
    idx: i,
    date: c.date,
    close: c.close,
    open: c.open,
    high: c.high,
    low: c.low,
    range: [c.low, c.high],
    body: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
    bullish: c.close >= c.open,
    volume: c.volume,
  }));

  return (
    <div className="space-y-2">
      {/* Price chart */}
      <div className="h-56 sm:h-72 lg:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{top:5,right:5,bottom:5,left:5}}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.2}/>
                <stop offset="100%" stopColor="#00d4ff" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3}/>
            <XAxis dataKey="date" stroke="#64748b" fontSize={9} interval={Math.max(1, Math.floor(data.length/8))} tick={{fontSize:9}}/>
            <YAxis stroke="#64748b" fontSize={9} domain={['auto','auto']} tickFormatter={(v:number)=>`$${v.toFixed(0)}`}/>
            <Tooltip
              contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}}
              formatter={(value: number, name: string) => {
                if (name === 'close') return [`$${fmt(value)}`, 'Close'];
                if (name === 'high') return [`$${fmt(value)}`, 'High'];
                if (name === 'low') return [`$${fmt(value)}`, 'Low'];
                return [value, name];
              }}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Area type="monotone" dataKey="close" stroke="#00d4ff" strokeWidth={2} fill="url(#priceGrad)" name="close" dot={false}/>
            <Line type="monotone" dataKey="high" stroke="#10b981" strokeWidth={0.5} dot={false} strokeDasharray="2 2" name="high"/>
            <Line type="monotone" dataKey="low" stroke="#ef4444" strokeWidth={0.5} dot={false} strokeDasharray="2 2" name="low"/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume chart */}
      <div className="h-20 sm:h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{top:0,right:5,bottom:0,left:5}}>
            <XAxis dataKey="date" hide/>
            <YAxis stroke="#64748b" fontSize={8} tickFormatter={(v:number)=>`${(v/1e6).toFixed(1)}M`}/>
            <Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'10px'}} formatter={(v:number)=>[`${(v/1e6).toFixed(2)}M`,'Volume']}/>
            <Bar dataKey="volume" name="Volume" radius={[2,2,0,0]}>
              {data.map((d,i)=><Cell key={i} fill={d.bullish?'#10b98140':'#ef444440'}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function StockDetailModal() {
  const stock = useStore((s) => s.selectedStock);
  const isOpen = useStore((s) => s.stockDetailOpen);
  const close = useStore((s) => s.closeStockDetail);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close]);

  return (
    <AnimatePresence>
      {isOpen && stock && (
        <motion.div
          ref={overlayRef}
          initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6"
          onClick={(e)=>{if(e.target===overlayRef.current) close();}}
        >
          <motion.div
            initial={{scale:0.9,opacity:0,y:20}} animate={{scale:1,opacity:1,y:0}} exit={{scale:0.9,opacity:0,y:20}}
            transition={{type:'spring',stiffness:300,damping:25}}
            className="bg-citadel-surface border border-citadel-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            {/* Header */}
            <div className="p-4 sm:p-6 border-b border-citadel-border flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <h2 className="text-xl sm:text-2xl font-bold font-mono">{stock.symbol}</h2>
                  <span className={`text-xs sm:text-sm font-medium px-2 py-0.5 rounded ${stock.change>=0?'bg-citadel-success/20 text-citadel-success':'bg-citadel-danger/20 text-citadel-danger'}`}>
                    {stock.change>=0?'+':''}{stock.changePct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-xs sm:text-sm text-citadel-muted mt-0.5">{stock.name}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl sm:text-3xl font-mono font-bold">${fmt(stock.price)}</div>
                <div className={`text-xs sm:text-sm font-mono ${stock.change>=0?'text-citadel-success':'text-citadel-danger'}`}>
                  {stock.change>=0?'+':''}{fmt(stock.change)}
                </div>
              </div>
            </div>

            {/* Key Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:px-6 border-b border-citadel-border/50">
              {[
                {label:'52W High',value:`$${fmt(stock.high52w)}`},
                {label:'52W Low',value:`$${fmt(stock.low52w)}`},
                {label:'Market Cap',value:stock.marketCap},
                {label:'P/E Ratio',value:stock.pe.toFixed(1)},
              ].map(s=>(
                <div key={s.label} className="text-center">
                  <div className="text-[10px] sm:text-xs text-citadel-muted uppercase">{s.label}</div>
                  <div className="text-sm sm:text-base font-mono font-semibold">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="p-4 sm:px-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs sm:text-sm font-medium text-citadel-muted">Price Chart (60-Day)</h3>
                <div className="flex gap-1">{['1W','1M','3M','6M','1Y'].map(p=>(
                  <button key={p} className="text-[10px] px-1.5 py-0.5 rounded text-citadel-muted hover:text-citadel-accent hover:bg-citadel-accent/10 transition-colors">{p}</button>
                ))}</div>
              </div>
              <CandlestickChart candles={stock.candles}/>
            </div>

            {/* Performance Stats */}
            <div className="p-4 sm:px-6 border-t border-citadel-border/50">
              <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-3">Performance</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {(() => {
                  const c = stock.candles;
                  if (c.length < 2) return null;
                  const last = c[c.length-1].close;
                  const periods = [
                    {label:'1D',idx:c.length-2},{label:'1W',idx:Math.max(0,c.length-6)},{label:'1M',idx:Math.max(0,c.length-22)},
                    {label:'3M',idx:Math.max(0,c.length-66)},{label:'6M',idx:Math.max(0,c.length-132)},{label:'YTD',idx:0},
                  ];
                  return periods.map(p=>{
                    const prev=c[p.idx]?.close||last;const pct=((last-prev)/prev)*100;const g=pct>=0;
                    return(<div key={p.label} className="text-center p-2 bg-citadel-bg/30 rounded-lg">
                      <div className="text-[10px] text-citadel-muted">{p.label}</div>
                      <div className={`text-xs sm:text-sm font-mono font-medium ${g?'text-citadel-success':'text-citadel-danger'}`}>{g?'+':''}{pct.toFixed(2)}%</div>
                    </div>);
                  });
                })()}
              </div>
            </div>

            {/* Close button */}
            <div className="p-4 sm:px-6 border-t border-citadel-border flex justify-end">
              <button onClick={close} className="px-4 py-2 text-sm bg-citadel-accent/10 text-citadel-accent rounded-lg hover:bg-citadel-accent/20 transition-colors">Close</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
