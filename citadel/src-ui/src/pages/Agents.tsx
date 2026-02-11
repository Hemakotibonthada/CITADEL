/**
 * CITADEL — Agents Page (responsive)
 * Agent cards with expandable metrics, uptime bars, lesson timeline.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { useStore, type AgentStatus } from '../store';

const AGENT_INFO: Record<string,{role:string;icon:string;color:string;desc:string}> = {
  Sentinel:{role:'Risk Guardian',icon:'🛡️',color:'border-citadel-danger',desc:'Monitors portfolio risk, enforces limits, triggers kill switches'},
  Librarian:{role:'Market Intelligence',icon:'📚',color:'border-citadel-accent',desc:'Aggregates news, runs NLP sentiment, manages vector knowledge base'},
  Tactician:{role:'Trading Logic',icon:'🎯',color:'border-citadel-success',desc:'Generates buy/sell signals using multi-strategy ensemble'},
  Student:{role:'Self-Correction',icon:'🧠',color:'border-citadel-warning',desc:'Learns from mistakes via LoRA fine-tuning, adapts strategy weights'},
};

function UptimeBar({uptime}:{uptime?:number}) {
  const hrs = uptime ? (uptime / 3600) : 0;
  const pct = Math.min(100, (hrs / 24) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-citadel-bg rounded-full overflow-hidden">
        <motion.div initial={{width:0}} animate={{width:`${pct}%`}} transition={{duration:1}} className="h-full bg-citadel-accent rounded-full"/>
      </div>
      <span className="text-[10px] font-mono text-citadel-muted w-12 text-right">{hrs.toFixed(1)}h</span>
    </div>
  );
}

function MetricsGrid({metrics}:{metrics:Record<string,unknown>}) {
  const entries = Object.entries(metrics);
  if (!entries.length) return null;
  // Try to make a bar chart if all values are numeric
  const numEntries = entries.filter(([,v]) => typeof v === 'number');
  if (numEntries.length >= 3) {
    const data = numEntries.slice(0,8).map(([k,v])=>({name:k,value:v as number}));
    return (
      <div className="h-32 sm:h-40"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3}/>
          <XAxis dataKey="name" stroke="#64748b" fontSize={9} interval={0} angle={-20} textAnchor="end" height={35}/>
          <YAxis stroke="#64748b" fontSize={9}/><Tooltip contentStyle={{background:'#1a2332',border:'1px solid #1e3a5f',borderRadius:'8px',fontSize:'11px'}}/>
          <Bar dataKey="value" fill="#00d4ff" radius={[3,3,0,0]}/>
        </BarChart>
      </ResponsiveContainer></div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map(([k,v])=>(<div key={k} className="bg-citadel-bg/50 rounded p-2"><div className="text-[10px] text-citadel-muted truncate">{k}</div><div className="text-xs sm:text-sm font-mono">{String(v)}</div></div>))}
    </div>
  );
}

function AgentDetail({name, data}:{name:string; data:AgentStatus|Record<string,unknown>}) {
  const [expanded, setExpanded] = useState(false);
  const info = AGENT_INFO[name] || {role:'Agent',icon:'🤖',color:'border-citadel-border',desc:''};
  const status = (data as Record<string,string>).status || 'IDLE';
  const uptime = (data as AgentStatus).uptime;
  const metrics = (data as AgentStatus).metrics;
  const analysis = (data as AgentStatus).analysis;
  const lessons = (data as AgentStatus).lessons;

  return (
    <motion.div layout className={`bg-citadel-card border-l-4 ${info.color} border border-citadel-border rounded-xl overflow-hidden`}>
      <button onClick={()=>setExpanded(!expanded)} className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-xl sm:text-2xl">{info.icon}</span>
          <div className="text-left min-w-0">
            <div className="font-medium text-sm sm:text-base">{name}</div>
            <div className="text-[10px] sm:text-xs text-citadel-muted truncate">{info.role}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${status==='ACTIVE'?'bg-citadel-success/20 text-citadel-success':status==='ERROR'?'bg-citadel-danger/20 text-citadel-danger':'bg-citadel-muted/20 text-citadel-muted'}`}>{status}</div>
          <span className="text-citadel-muted text-sm">{expanded?'▲':'▼'}</span>
        </div>
      </button>
      <AnimatePresence>{expanded && (
        <motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} transition={{duration:0.2}} className="overflow-hidden">
          <div className="p-3 sm:p-4 pt-0 border-t border-citadel-border/50 space-y-3">
            {/* Description */}
            <p className="text-xs text-citadel-muted">{info.desc}</p>
            {/* Uptime */}
            {uptime != null && <div><div className="text-[10px] text-citadel-muted uppercase mb-1">Uptime</div><UptimeBar uptime={uptime}/></div>}
            {/* Metrics */}
            {!!metrics && Object.keys(metrics).length > 0 && <div><div className="text-[10px] text-citadel-muted uppercase mb-1">Metrics</div><MetricsGrid metrics={metrics}/></div>}
            {/* Analysis */}
            {!!analysis && <div><div className="text-[10px] text-citadel-muted uppercase mb-1">Analysis</div><pre className="text-[10px] sm:text-xs font-mono bg-citadel-bg/50 rounded p-2 sm:p-3 overflow-x-auto max-h-40">{JSON.stringify(analysis,null,2)}</pre></div>}
            {/* Lessons */}
            {!!(lessons && lessons.length > 0) && (
              <div><div className="text-[10px] text-citadel-muted uppercase mb-1">Lessons Learned ({lessons.length})</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">{lessons.map((lesson,i)=>(
                  <div key={i} className="flex items-start gap-2 text-[10px] sm:text-xs bg-citadel-bg/50 rounded p-2">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${lesson.severity==='CRITICAL'?'bg-citadel-danger':lesson.severity==='WARNING'?'bg-citadel-warning':'bg-citadel-success'}`}/>
                    <span className="text-citadel-muted">{lesson.lesson as string}</span>
                  </div>
                ))}</div>
              </div>
            )}
          </div>
        </motion.div>
      )}</AnimatePresence>
    </motion.div>
  );
}

export function Agents() {
  const agents = useStore((s) => s.agents);
  const entries = Object.entries(agents).length > 0
    ? Object.entries(agents)
    : Object.keys(AGENT_INFO).map(n=>[n,{status:'IDLE'}] as [string,Record<string,unknown>]);
  const active = entries.filter(([,d])=>(d as Record<string,string>).status==='ACTIVE').length;
  return (
    <div className="max-w-4xl mx-auto space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2 sm:mb-4">
        <h2 className="text-base sm:text-lg font-semibold">Agent Swarm</h2>
        <div className="flex items-center gap-3">
          <div className="text-xs sm:text-sm text-citadel-muted">{active} / {entries.length} active</div>
          <div className="flex gap-1">{['ALL','ACTIVE','IDLE'].map(f=>(<button key={f} className="text-[10px] px-2 py-0.5 rounded text-citadel-muted hover:text-citadel-accent hover:bg-citadel-accent/10 transition-colors">{f}</button>))}</div>
        </div>
      </div>
      {entries.map(([name,data])=>(<AgentDetail key={name} name={name} data={data as AgentStatus}/>))}
    </div>
  );
}
