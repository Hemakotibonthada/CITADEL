/**
 * CITADEL — Dashboard Page
 * Responsive overview: equity curve, P&L waterfall, position grid, risk, agents, sectors.
 */
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie,
  ComposedChart, Line,
} from 'recharts';
import { useStore, type MarketOverview, type ActivityEvent } from '../store';

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
const s = (n: number) => (n >= 0 ? '+' : '');

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: string }) {
  return (
    <motion.div whileHover={{ scale: 1.02, y: -2 }} className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-base sm:text-lg">{icon}</span>}
        <span className="text-[10px] sm:text-xs text-citadel-muted uppercase tracking-wider truncate">{label}</span>
      </div>
      <div className={`text-lg sm:text-2xl font-mono font-bold truncate ${color || 'text-citadel-text'}`}>{value}</div>
      {sub && <div className="text-[10px] sm:text-xs text-citadel-muted mt-0.5 truncate">{sub}</div>}
    </motion.div>
  );
}

function EquityCurve() {
  const pnlHistory = useStore((s) => s.pnlHistory);
  if (pnlHistory.length === 0) {
    return (
      <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4 h-64 sm:h-72 lg:h-80 flex items-center justify-center">
        <div className="text-center text-citadel-muted">
          <span className="text-3xl block mb-2">📈</span>
          <span className="text-xs">No equity data yet. Start trading to see your curve.</span>
        </div>
      </div>
    );
  }
  const data = pnlHistory;
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4 h-64 sm:h-72 lg:h-80">
      <div className="flex items-center justify-between mb-2"><h3 className="text-xs sm:text-sm font-medium text-citadel-muted">Equity Curve</h3>
        <div className="flex gap-1">{['1W','1M','3M','YTD'].map(p=><button key={p} className="text-[10px] px-1.5 py-0.5 rounded text-citadel-muted hover:text-citadel-accent hover:bg-citadel-accent/10 transition-colors">{p}</button>)}</div>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <ComposedChart data={data}>
          <defs><linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00d4ff" stopOpacity={0.3}/><stop offset="100%" stopColor="#00d4ff" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3}/>
          <XAxis dataKey="date" stroke="#64748b" fontSize={10} interval="preserveStartEnd"/>
          <YAxis stroke="#64748b" fontSize={10} tickFormatter={fmtK} domain={['auto','auto']}/>
          <Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}} formatter={(v:number)=>['$'+fmt(v)]}/>
          <Area type="monotone" dataKey="equity" stroke="#00d4ff" strokeWidth={2} fill="url(#eqG)" name="Equity"/>
          <Line type="monotone" dataKey="cumulative" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Cum. P&L"/>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PnlWaterfall() {
  const pnlHistory = useStore((s) => s.pnlHistory);
  const data = pnlHistory.length > 0
    ? pnlHistory.slice(-14).map(d => ({ ...d, fill: d.pnl >= 0 ? '#10b981' : '#ef4444' }))
    : [];
  if (data.length === 0) {
    return (
      <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4 h-64 sm:h-72 lg:h-80 flex items-center justify-center">
        <div className="text-center text-citadel-muted">
          <span className="text-3xl block mb-2">📊</span>
          <span className="text-xs">No P&L data yet</span>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4 h-64 sm:h-72 lg:h-80">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2">Daily P&L</h3>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3}/><XAxis dataKey="date" stroke="#64748b" fontSize={10} interval="preserveStartEnd"/><YAxis stroke="#64748b" fontSize={10} tickFormatter={fmtK}/>
          <Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}} formatter={(v:number)=>['$'+fmt(v)]}/>
          <Bar dataKey="pnl" radius={[4,4,0,0]} name="P&L">{data.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PositionGrid() {
  const positions = useStore((s) => s.portfolio.positions);
  const fetchStockDetail = useStore((s) => s.fetchStockDetail);
  const items = positions;
  if (items.length === 0) {
    return (
      <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
        <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2 sm:mb-3">Positions</h3>
        <div className="text-center text-citadel-muted py-8">
          <span className="text-3xl block mb-2">💼</span>
          <span className="text-xs">No positions yet. Go to Trading to place orders.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2 sm:mb-3">Positions <span className="text-citadel-accent">(click for chart)</span></h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {items.map((pos,i) => {
          const g = pos.unrealized_pnl >= 0;
          return (
            <motion.button key={pos.symbol} onClick={()=>fetchStockDetail(pos.symbol)} whileHover={{scale:1.04}} whileTap={{scale:0.97}}
              initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}}
              className={`relative p-3 rounded-lg border text-left cursor-pointer transition-colors ${g?'border-citadel-success/30 bg-citadel-success/5 hover:bg-citadel-success/10':'border-citadel-danger/30 bg-citadel-danger/5 hover:bg-citadel-danger/10'}`}>
              <div className="font-mono font-bold text-sm">{pos.symbol}</div>
              <div className={`text-xs font-mono font-medium ${g?'text-citadel-success':'text-citadel-danger'}`}>{s(pos.unrealized_pnl)}${Math.abs(pos.unrealized_pnl).toFixed(2)}</div>
              <div className={`text-[10px] font-mono ${g?'text-citadel-success/70':'text-citadel-danger/70'}`}>{s(pos.unrealized_pnl_pct)}{pos.unrealized_pnl_pct.toFixed(2)}%</div>
              <div className="text-[10px] text-citadel-muted mt-0.5">{pos.quantity} shares</div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function AgentCards() {
  const agents = useStore((s) => s.agents);
  const list = Object.entries(agents).length > 0 ? Object.entries(agents)
    : [];
  if (list.length === 0) {
    return (
      <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
        <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2 sm:mb-3">Agent Swarm</h3>
        <div className="text-center text-citadel-muted py-6"><span className="text-2xl block mb-1">🤖</span><span className="text-xs">No agents active</span></div>
      </div>
    );
  }
  const icons: Record<string,string> = {Sentinel:'🛡️',Librarian:'📚',Tactician:'🎯',Student:'🧠'};
  const sc: Record<string,string> = {ACTIVE:'bg-citadel-success',IDLE:'bg-citadel-muted',ERROR:'bg-citadel-danger',PROCESSING:'bg-citadel-warning'};
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2 sm:mb-3">Agent Swarm</h3>
      <div className="grid grid-cols-2 gap-2">
        {list.map(([name,agent])=>(
          <motion.div key={name} whileHover={{x:3}} className="flex items-center gap-2 p-2.5 rounded-lg bg-citadel-bg/50 border border-citadel-border/50">
            <span className="text-lg">{icons[name]||'🤖'}</span>
            <div className="flex-1 min-w-0"><div className="text-xs sm:text-sm font-medium truncate">{name}</div>
              <div className="flex items-center gap-1.5"><div className={`w-1.5 h-1.5 rounded-full ${sc[(agent as unknown as Record<string,string>).status]||sc.IDLE}`}/><span className="text-[10px] text-citadel-muted uppercase">{(agent as unknown as Record<string,string>).status||'idle'}</span></div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function RiskGauges() {
  const risk = useStore((s) => s.risk);
  const gauges = [
    {label:'Sharpe',value:risk.sharpe.toFixed(2),max:3,cur:risk.sharpe,icon:'📈'},
    {label:'Win Rate',value:`${(risk.win_rate*100).toFixed(0)}%`,max:1,cur:risk.win_rate,icon:'🎯'},
    {label:'Max DD',value:`${(risk.max_drawdown*100).toFixed(1)}%`,max:0.2,cur:risk.max_drawdown,icon:'📉',inv:true},
    {label:'VaR 95%',value:`$${fmtK(risk.var_95)}`,max:5000,cur:risk.var_95,icon:'⚠️',inv:true},
    {label:'Leverage',value:`${risk.leverage.toFixed(2)}x`,max:2,cur:risk.leverage,icon:'⚡',inv:true},
    {label:'Kill Switch',value:risk.kill_switch_level,max:1,cur:risk.kill_switch_level==='NONE'?0:1,icon:'🔴',inv:true},
  ];
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2 sm:mb-3">Risk Metrics</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {gauges.map(g=>{const pct=Math.min(100,(g.cur/g.max)*100);const bc=g.inv?(pct>70?'bg-citadel-danger':pct>40?'bg-citadel-warning':'bg-citadel-success'):(pct>60?'bg-citadel-success':pct>30?'bg-citadel-warning':'bg-citadel-danger');
          return(<div key={g.label} className="p-2 bg-citadel-bg/30 rounded-lg"><div className="flex items-center gap-1 mb-1"><span className="text-xs">{g.icon}</span><span className="text-[10px] sm:text-xs text-citadel-muted truncate">{g.label}</span></div>
            <div className="text-sm sm:text-base font-mono font-semibold mb-1">{g.value}</div>
            <div className="h-1 bg-citadel-bg rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pct}%`}} transition={{duration:0.8}} className={`h-full rounded-full ${bc}`}/></div></div>);})}
      </div>
    </div>
  );
}

function SectorAllocation() {
  const positions = useStore((s) => s.portfolio.positions);
  const cash = useStore((s) => s.portfolio.cash);
  const sectors: Record<string,string> = {AAPL:'Tech',MSFT:'Tech',GOOGL:'Tech',META:'Tech',AMZN:'Consumer',TSLA:'Auto',NVDA:'Semis',SPY:'Index',QQQ:'Index',IWM:'Index'};
  const sectorColors: Record<string,string> = {Tech:'#00d4ff',Consumer:'#10b981',Auto:'#f59e0b',Semis:'#8b5cf6',Index:'#ec4899',Cash:'#64748b',Other:'#94a3b8'};
  const sm = new Map<string,number>();sm.set('Cash',cash||0);
  for(const p of positions){const sec=sectors[p.symbol]||'Other';sm.set(sec,(sm.get(sec)||0)+Math.abs(p.market_value));}
  const data=Array.from(sm.entries()).map(([name,value])=>({name,value})).filter(d=>d.value>0);
  const COLORS=data.map(d=>sectorColors[d.name]||'#64748b');
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-medium text-citadel-muted mb-2">Sector Allocation</h3>
      <div className="h-40 sm:h-48"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} cx="50%" cy="50%" innerRadius="45%" outerRadius="78%" paddingAngle={2} dataKey="value">{data.map((_,i)=><Cell key={i} fill={COLORS[i]}/>)}</Pie>
        <Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}} formatter={(v:number)=>['$'+fmtK(v)]}/></PieChart></ResponsiveContainer></div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 justify-center">{data.map((d,i)=>(<div key={d.name} className="flex items-center gap-1 text-[10px] sm:text-xs"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:COLORS[i]}}/><span className="text-citadel-muted">{d.name}</span></div>))}</div>
    </div>
  );
}

function MarketOverviewBar({ overview, onRefresh }: { overview: MarketOverview | null; onRefresh: () => void }) {
  useEffect(() => { onRefresh(); }, [onRefresh]);
  if (!overview) return null;
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl px-3 py-2 flex items-center gap-4 overflow-x-auto no-scrollbar">
      <span className="text-xs text-citadel-muted flex-shrink-0 font-semibold">🌍 Markets</span>
      {overview.indices.map(idx => (
        <div key={idx.symbol} className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-citadel-muted font-mono">{idx.symbol}</span>
          <span className="text-xs text-citadel-text font-mono">${idx.price.toFixed(2)}</span>
          <span className={`text-[10px] font-mono font-semibold ${idx.change_pct >= 0 ? 'text-citadel-success' : 'text-citadel-danger'}`}>
            {idx.change_pct >= 0 ? '+' : ''}{idx.change_pct.toFixed(2)}%
          </span>
        </div>
      ))}
      <div className="ml-auto flex-shrink-0 border-l border-citadel-border pl-3 flex items-center gap-2">
        {overview.sectors.slice(0, 3).map(sec => (
          <div key={sec.name} className="flex items-center gap-1">
            <span className="text-[10px] text-citadel-muted">{sec.name}</span>
            <span className={`text-[10px] font-mono ${sec.change_pct >= 0 ? 'text-citadel-success' : 'text-citadel-danger'}`}>
              {sec.change_pct >= 0 ? '+' : ''}{sec.change_pct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const EVENT_ICONS: Record<string, string> = {
  trade: '💹', alert_created: '🔔', alert_deleted: '🔕', settings_updated: '⚙️',
  order_placed: '📝', order_cancelled: '❌', position_added: '➕', position_removed: '➖',
};

function ActivityFeed({ events, onRefresh }: { events: ActivityEvent[]; onRefresh: (limit?: number) => void }) {
  useEffect(() => { onRefresh(10); }, [onRefresh]);
  if (events.length === 0) return null;
  return (
    <div className="bg-citadel-card border border-citadel-border rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs sm:text-sm font-medium text-citadel-muted">Recent Activity</h3>
        <button onClick={() => onRefresh(20)} className="text-[10px] text-citadel-muted hover:text-citadel-accent transition-colors">Show More</button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
        {events.map(evt => (
          <div key={evt.id} className="flex items-start gap-2 text-xs">
            <span className="text-sm flex-shrink-0">{EVENT_ICONS[evt.type] || '📌'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-citadel-text truncate">{evt.message}</p>
              <p className="text-[10px] text-citadel-muted font-mono">{new Date(evt.timestamp).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const p = useStore((s) => s.portfolio);
  const fetchMarketOverview = useStore((s) => s.fetchMarketOverview);
  const fetchActivity = useStore((s) => s.fetchActivity);
  const marketOverview = useStore((s) => s.marketOverview);
  const activityLog = useStore((s) => s.activityLog);

  const pc = p.daily_pnl >= 0 ? 'text-citadel-success' : 'text-citadel-danger';
  const tc = p.total_pnl >= 0 ? 'text-citadel-success' : 'text-citadel-danger';
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        <StatCard icon="💰" label="Total Equity" value={`$${fmt(p.total_equity)}`}/>
        <StatCard icon="💵" label="Cash" value={`$${fmt(p.cash)}`}/>
        <StatCard icon="📊" label="Daily P&L" value={`${s(p.daily_pnl)}$${fmt(Math.abs(p.daily_pnl))}`} color={pc}/>
        <StatCard icon="📈" label="Total P&L" value={`${s(p.total_pnl)}$${fmt(Math.abs(p.total_pnl))}`} color={tc}/>
        <StatCard icon="⚡" label="Leverage" value={`${p.leverage.toFixed(2)}x`} color={p.leverage>1.5?'text-citadel-danger':undefined}/>
      </div>

      {/* Market Overview Ticker */}
      <MarketOverviewBar overview={marketOverview} onRefresh={fetchMarketOverview}/>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4"><EquityCurve/><PnlWaterfall/></div>
      <PositionGrid/>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"><AgentCards/><RiskGauges/><SectorAllocation/></div>

      {/* Activity Feed */}
      <ActivityFeed events={activityLog} onRefresh={fetchActivity}/>
    </div>
  );
}
