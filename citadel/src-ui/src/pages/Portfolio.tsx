/**
 * CITADEL — Portfolio Page (responsive)
 * Position table, allocation donut, trade history, clickable symbols.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useStore } from '../store';

const COLORS = ['#00d4ff','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

function PositionTable() {
  const positions = useStore((s) => s.portfolio.positions);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);
  const [sortKey, setSortKey] = useState<string>('symbol');
  const [sortDir, setSortDir] = useState<1|-1>(1);

  const sorted = [...positions].sort((a: any, b: any) => {
    const va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') return sortDir * va.localeCompare(vb);
    return sortDir * (va - vb);
  });

  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(d => d === 1 ? -1 : 1); else { setSortKey(key); setSortDir(1); } };
  const arrow = (key: string) => sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '';

  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-citadel-border flex items-center justify-between">
        <h3 className="text-xs sm:text-sm font-medium text-citadel-muted">Open Positions</h3>
        <span className="text-xs text-citadel-muted">{positions.length} positions</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[10px] sm:text-xs text-citadel-muted uppercase border-b border-citadel-border">
            {[['symbol','Symbol'],['quantity','Qty'],['avg_cost','Avg Cost'],['market_value','Mkt Value'],['unrealized_pnl','Unrealized P&L'],['unrealized_pnl_pct','% Change']].map(([k,l])=>(
              <th key={k} className={`p-2 sm:p-3 cursor-pointer hover:text-citadel-accent transition-colors ${k==='symbol'?'text-left':'text-right'}`} onClick={()=>toggleSort(k)}>{l}{arrow(k)}</th>
            ))}
          </tr></thead>
          <tbody>
            {sorted.length > 0 ? sorted.map((pos, i) => {
              const c = pos.unrealized_pnl >= 0 ? 'text-citadel-success' : 'text-citadel-danger';
              return (
                <motion.tr key={pos.symbol} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.03}}
                  className="border-b border-citadel-border/50 hover:bg-white/[0.02] cursor-pointer" onClick={()=>fetchStockDetail(pos.symbol)}>
                  <td className="p-2 sm:p-3 font-mono font-medium text-citadel-accent">{pos.symbol}</td>
                  <td className="p-2 sm:p-3 text-right font-mono">{pos.quantity}</td>
                  <td className="p-2 sm:p-3 text-right font-mono">${pos.avg_cost.toFixed(2)}</td>
                  <td className="p-2 sm:p-3 text-right font-mono">${pos.market_value.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                  <td className={`p-2 sm:p-3 text-right font-mono font-medium ${c}`}>{pos.unrealized_pnl>=0?'+':''}${pos.unrealized_pnl.toFixed(2)}</td>
                  <td className={`p-2 sm:p-3 text-right font-mono ${c}`}>{pos.unrealized_pnl_pct>=0?'+':''}{pos.unrealized_pnl_pct.toFixed(2)}%</td>
                </motion.tr>
              );
            }) : (
              <tr><td colSpan={6} className="p-8 text-center text-citadel-muted text-sm">No open positions — start trading to see data here</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AllocationChart() {
  const positions = useStore((s) => s.portfolio.positions);
  const cash = useStore((s) => s.portfolio.cash);
  const data = [{name:'Cash',value:cash||100000}, ...positions.map(p=>({name:p.symbol,value:Math.abs(p.market_value)}))].filter(d=>d.value>0);
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2">Allocation</h3>
      <div className="h-48 sm:h-56"><ResponsiveContainer width="100%" height="100%"><PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius="40%" outerRadius="75%" paddingAngle={2} dataKey="value">{data.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
        <Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}}/>
      </PieChart></ResponsiveContainer></div>
      <div className="flex flex-wrap gap-2 mt-2 justify-center">{data.map((d,i)=>(<div key={d.name} className="flex items-center gap-1.5 text-[10px] sm:text-xs"><div className="w-2 h-2 rounded-full" style={{background:COLORS[i%COLORS.length]}}/><span className="text-citadel-muted">{d.name}</span></div>))}</div>
    </div>
  );
}

function PnlBySymbol() {
  const positions = useStore((s) => s.portfolio.positions);
  const data = positions.length > 0
    ? positions.map(p => ({ symbol: p.symbol, pnl: p.unrealized_pnl, fill: p.unrealized_pnl >= 0 ? '#10b981' : '#ef4444' }))
    : [{symbol:'AAPL',pnl:245,fill:'#10b981'},{symbol:'MSFT',pnl:-120,fill:'#ef4444'},{symbol:'NVDA',pnl:890,fill:'#10b981'},{symbol:'TSLA',pnl:-340,fill:'#ef4444'},{symbol:'GOOGL',pnl:155,fill:'#10b981'},{symbol:'META',pnl:420,fill:'#10b981'}];
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2">P&L by Symbol</h3>
      <div className="h-48 sm:h-56"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3}/><XAxis type="number" stroke="#64748b" fontSize={10}/><YAxis type="category" dataKey="symbol" stroke="#64748b" fontSize={10} width={45}/>
          <Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}}/>
          <Bar dataKey="pnl" radius={[0,4,4,0]}>{data.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Bar>
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}

function TradeHistory() {
  const trades = useStore((s) => s.trades);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);
  const [filter, setFilter] = useState<string>('ALL');
  const filtered = filter === 'ALL' ? trades : trades.filter(t => t.action === filter);
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-citadel-border flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs sm:text-sm font-medium text-citadel-muted">Trade History</h3>
        <div className="flex gap-1">{['ALL','BUY','SELL'].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} className={`text-[10px] px-2 py-0.5 rounded transition-colors ${filter===f?'bg-citadel-accent/20 text-citadel-accent':'text-citadel-muted hover:text-citadel-text'}`}>{f}</button>
        ))}</div>
      </div>
      <div className="max-h-72 sm:max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-citadel-card"><tr className="text-[10px] sm:text-xs text-citadel-muted uppercase border-b border-citadel-border">
            <th className="text-left p-2 sm:p-3">Time</th><th className="text-left p-2 sm:p-3">Symbol</th><th className="text-left p-2 sm:p-3">Action</th>
            <th className="text-right p-2 sm:p-3">Qty</th><th className="text-right p-2 sm:p-3">Price</th><th className="text-right p-2 sm:p-3">P&L</th>
          </tr></thead>
          <tbody>{filtered.length > 0 ? filtered.slice(0,50).map((t,i)=>{
            const ac=t.action==='BUY'?'text-citadel-success':'text-citadel-danger';const pc=(t.pnl??0)>=0?'text-citadel-success':'text-citadel-danger';
            return(<tr key={t.id||i} className="border-b border-citadel-border/30 hover:bg-white/[0.02] cursor-pointer" onClick={()=>fetchStockDetail(t.symbol)}>
              <td className="p-2 sm:p-3 text-[10px] sm:text-xs text-citadel-muted font-mono">{t.timestamp}</td>
              <td className="p-2 sm:p-3 font-mono font-medium text-citadel-accent">{t.symbol}</td>
              <td className={`p-2 sm:p-3 font-medium ${ac}`}>{t.action}</td>
              <td className="p-2 sm:p-3 text-right font-mono">{t.quantity}</td>
              <td className="p-2 sm:p-3 text-right font-mono">${t.price.toFixed(2)}</td>
              <td className={`p-2 sm:p-3 text-right font-mono ${pc}`}>{t.pnl!=null?`${t.pnl>=0?'+':''}$${Math.abs(t.pnl).toFixed(2)}`:'—'}</td>
            </tr>);
          }) : (<tr><td colSpan={6} className="p-8 text-center text-citadel-muted text-sm">No trades yet</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Portfolio() {
  return (
    <div className="space-y-3 sm:space-y-4">
      <PositionTable />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4"><AllocationChart/><PnlBySymbol/></div>
      <TradeHistory />
    </div>
  );
}
