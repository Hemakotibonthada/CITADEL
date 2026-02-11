/**
 * CITADEL — Dashboard Page
 * Responsive overview: equity curve, P&L waterfall, position grid, risk, agents, sectors.
 */
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie,
  ComposedChart, Line,
} from 'recharts';
import { useStore } from '../store';

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
  const data = pnlHistory.length > 0 ? pnlHistory : [
    { date: 'Jan 6', equity: 100000, pnl: 0, cumulative: 0 }, { date: 'Jan 7', equity: 100500, pnl: 500, cumulative: 500 },
    { date: 'Jan 8', equity: 101200, pnl: 700, cumulative: 1200 }, { date: 'Jan 9', equity: 100800, pnl: -400, cumulative: 800 },
    { date: 'Jan 10', equity: 102100, pnl: 1300, cumulative: 2100 }, { date: 'Jan 13', equity: 101900, pnl: -200, cumulative: 1900 },
    { date: 'Jan 14', equity: 103200, pnl: 1300, cumulative: 3200 }, { date: 'Jan 15', equity: 103800, pnl: 600, cumulative: 3800 },
    { date: 'Jan 16', equity: 102900, pnl: -900, cumulative: 2900 }, { date: 'Jan 17', equity: 104500, pnl: 1600, cumulative: 4500 },
  ];
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
    : [{ date:'Mon',pnl:500,fill:'#10b981'},{ date:'Tue',pnl:700,fill:'#10b981'},{ date:'Wed',pnl:-400,fill:'#ef4444'},{ date:'Thu',pnl:1300,fill:'#10b981'},{ date:'Fri',pnl:-200,fill:'#ef4444'},{ date:'Mon2',pnl:850,fill:'#10b981'},{ date:'Tue2',pnl:-150,fill:'#ef4444'},{ date:'Wed2',pnl:920,fill:'#10b981'}];
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
  const items = positions.length > 0 ? positions : [
    {symbol:'AAPL',quantity:100,unrealized_pnl:245.50,unrealized_pnl_pct:1.26},{symbol:'MSFT',quantity:50,unrealized_pnl:-120.30,unrealized_pnl_pct:-0.57},
    {symbol:'NVDA',quantity:25,unrealized_pnl:890.00,unrealized_pnl_pct:4.45},{symbol:'TSLA',quantity:40,unrealized_pnl:-340.20,unrealized_pnl_pct:-1.36},
    {symbol:'GOOGL',quantity:60,unrealized_pnl:155.80,unrealized_pnl_pct:0.89},{symbol:'META',quantity:30,unrealized_pnl:420.10,unrealized_pnl_pct:2.55},
    {symbol:'SPY',quantity:200,unrealized_pnl:180.00,unrealized_pnl_pct:0.35},{symbol:'AMZN',quantity:45,unrealized_pnl:-85.60,unrealized_pnl_pct:-0.43},
  ] as Array<{symbol:string;quantity:number;unrealized_pnl:number;unrealized_pnl_pct:number}>;
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
    : [['Sentinel',{status:'ACTIVE'}],['Librarian',{status:'ACTIVE'}],['Tactician',{status:'ACTIVE'}],['Student',{status:'IDLE'}]] as [string,Record<string,string>][];
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
              <div className="flex items-center gap-1.5"><div className={`w-1.5 h-1.5 rounded-full ${sc[(agent as Record<string,string>).status]||sc.IDLE}`}/><span className="text-[10px] text-citadel-muted uppercase">{(agent as Record<string,string>).status||'idle'}</span></div>
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
  const sm = new Map<string,number>();sm.set('Cash',cash||100000);
  for(const p of positions){const sec=sectors[p.symbol]||'Other';sm.set(sec,(sm.get(sec)||0)+Math.abs(p.market_value));}
  if(!positions.length){sm.set('Tech',42000);sm.set('Semis',18000);sm.set('Consumer',12000);sm.set('Index',28000);}
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

export function Dashboard() {
  const p = useStore((s) => s.portfolio);
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4"><EquityCurve/><PnlWaterfall/></div>
      <PositionGrid/>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"><AgentCards/><RiskGauges/><SectorAllocation/></div>
    </div>
  );
}
