/**
 * CITADEL — Model Learning & Training Visualization
 * Training loss curves, accuracy, learning rate schedule, model status cards.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area, BarChart, Bar,
} from 'recharts';
import { useStore, type ModelInfo } from '../store';

const STATUS_COLORS: Record<string, string> = {
  ready: 'bg-citadel-success', training: 'bg-yellow-400', error: 'bg-citadel-danger', loading: 'bg-blue-400',
};

function ModelCard({ model, selected, onClick }: { model: ModelInfo; selected: boolean; onClick: () => void }) {
  const last = model.training_history[model.training_history.length - 1];
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      className={`text-left w-full p-3 sm:p-4 rounded-xl border transition-all ${selected
        ? 'bg-citadel-accent/10 border-citadel-accent shadow-lg shadow-citadel-accent/10'
        : 'bg-citadel-surface border-citadel-border hover:border-citadel-accent/40'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[model.status] || 'bg-gray-500'} ${model.status === 'training' ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-mono uppercase text-citadel-muted">{model.type}</span>
      </div>
      <h3 className="font-semibold text-sm sm:text-base truncate">{model.name}</h3>
      <div className="text-[10px] sm:text-xs text-citadel-muted mt-1">{model.parameters.toLocaleString()} params</div>
      <div className="grid grid-cols-3 gap-1 mt-3">
        <div>
          <div className="text-[9px] text-citadel-muted">Loss</div>
          <div className="text-xs font-mono font-semibold text-citadel-accent">{last?.loss.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[9px] text-citadel-muted">Accuracy</div>
          <div className="text-xs font-mono font-semibold text-citadel-success">{((last?.accuracy ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[9px] text-citadel-muted">Epochs</div>
          <div className="text-xs font-mono font-semibold">{model.training_history.length}</div>
        </div>
      </div>
      {/* Mini progress bar */}
      <div className="mt-2 h-1 bg-citadel-bg rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${(last?.accuracy ?? 0) * 100}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full bg-gradient-to-r from-citadel-accent to-citadel-success rounded-full"
        />
      </div>
    </motion.button>
  );
}

function LossCurveChart({ model }: { model: ModelInfo }) {
  const data = model.training_history.map(e => ({
    epoch: e.epoch,
    loss: e.loss,
    valLoss: e.val_loss,
  }));

  return (
    <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
      <h4 className="text-xs sm:text-sm font-medium text-citadel-muted mb-3">Training & Validation Loss</h4>
      <div className="h-48 sm:h-56 lg:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis dataKey="epoch" stroke="#64748b" fontSize={9} label={{ value: 'Epoch', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: '#64748b' } }} />
            <YAxis stroke="#64748b" fontSize={9} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Line type="monotone" dataKey="loss" stroke="#00d4ff" strokeWidth={2} dot={false} name="Train Loss" />
            <Line type="monotone" dataKey="valLoss" stroke="#f59e0b" strokeWidth={2} dot={false} name="Val Loss" strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AccuracyChart({ model }: { model: ModelInfo }) {
  const data = model.training_history.map(e => ({
    epoch: e.epoch,
    accuracy: +(e.accuracy * 100).toFixed(2),
  }));

  return (
    <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
      <h4 className="text-xs sm:text-sm font-medium text-citadel-muted mb-3">Accuracy Over Epochs</h4>
      <div className="h-48 sm:h-56 lg:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis dataKey="epoch" stroke="#64748b" fontSize={9} label={{ value: 'Epoch', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: '#64748b' } }} />
            <YAxis stroke="#64748b" fontSize={9} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [`${v}%`, 'Accuracy']} />
            <Area type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} fill="url(#accGrad)" name="Accuracy" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LearningRateChart({ model }: { model: ModelInfo }) {
  const data = model.training_history.map(e => ({
    epoch: e.epoch,
    lr: e.learning_rate,
  }));

  return (
    <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
      <h4 className="text-xs sm:text-sm font-medium text-citadel-muted mb-3">Learning Rate Schedule</h4>
      <div className="h-48 sm:h-56 lg:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis dataKey="epoch" stroke="#64748b" fontSize={9} label={{ value: 'Epoch', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: '#64748b' } }} />
            <YAxis stroke="#64748b" fontSize={9} tickFormatter={(v: number) => v.toExponential(1)} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [v.toExponential(3), 'Learning Rate']} />
            <Line type="stepAfter" dataKey="lr" stroke="#a855f7" strokeWidth={2} dot={false} name="LR" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function EpochMetricsTable({ model }: { model: ModelInfo }) {
  const [showAll, setShowAll] = useState(false);
  const history = model.training_history;
  const display = showAll ? history : history.slice(-10);

  return (
    <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs sm:text-sm font-medium text-citadel-muted">Epoch Metrics</h4>
        {history.length > 10 && (
          <button onClick={() => setShowAll(!showAll)} className="text-[10px] text-citadel-accent hover:underline">
            {showAll ? 'Show Recent' : `Show All (${history.length})`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] sm:text-xs">
          <thead>
            <tr className="text-citadel-muted border-b border-citadel-border">
              <th className="text-left py-1 px-2">Epoch</th>
              <th className="text-right py-1 px-2">Loss</th>
              <th className="text-right py-1 px-2">Val Loss</th>
              <th className="text-right py-1 px-2">Accuracy</th>
              <th className="text-right py-1 px-2">LR</th>
            </tr>
          </thead>
          <tbody>
            {display.map(e => (
              <tr key={e.epoch} className="border-b border-citadel-border/30 hover:bg-citadel-accent/5">
                <td className="py-1 px-2 font-mono">{e.epoch}</td>
                <td className="py-1 px-2 font-mono text-right text-citadel-accent">{e.loss.toFixed(4)}</td>
                <td className="py-1 px-2 font-mono text-right text-yellow-400">{e.val_loss.toFixed(4)}</td>
                <td className="py-1 px-2 font-mono text-right text-citadel-success">{(e.accuracy * 100).toFixed(1)}%</td>
                <td className="py-1 px-2 font-mono text-right text-purple-400">{e.learning_rate.toExponential(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModelComparison({ models }: { models: ModelInfo[] }) {
  const data = models.map(m => {
    const last = m.training_history[m.training_history.length - 1];
    return {
      name: m.name.split('/').pop() || m.name,
      accuracy: +((last?.accuracy ?? 0) * 100).toFixed(1),
      loss: +(last?.loss ?? 0).toFixed(4),
    };
  });

  return (
    <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
      <h4 className="text-xs sm:text-sm font-medium text-citadel-muted mb-3">Model Comparison — Final Accuracy</h4>
      <div className="h-40 sm:h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 15, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={9} tickFormatter={(v: number) => `${v}%`} />
            <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={9} width={100} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [`${v}%`, 'Accuracy']} />
            <Bar dataKey="accuracy" fill="#00d4ff" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ModelLearning() {
  const models = useStore((s) => s.models);
  const fetchModels = useStore((s) => s.fetchModels);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const selected = models[selectedIdx];

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Model Training & Learning</h1>
        <p className="text-xs sm:text-sm text-citadel-muted mt-1">Visualize model convergence, loss curves, accuracy, and learning rate schedules.</p>
      </div>

      {/* Model selector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {models.map((m, i) => (
          <ModelCard key={m.name} model={m} selected={selectedIdx === i} onClick={() => setSelectedIdx(i)} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {selected && (
          <motion.div
            key={selected.name}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Model header */}
            <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold font-mono">{selected.name}</h2>
                  <div className="text-xs text-citadel-muted mt-0.5">{selected.type} • {selected.parameters.toLocaleString()} params • Status: <span className={`font-medium ${selected.status === 'ready' ? 'text-citadel-success' : selected.status === 'training' ? 'text-yellow-400' : 'text-citadel-danger'}`}>{selected.status.toUpperCase()}</span></div>
                </div>
                <div className="flex gap-4 text-center">
                  {(() => {
                    const last = selected.training_history[selected.training_history.length - 1];
                    return (
                      <>
                        <div>
                          <div className="text-[10px] text-citadel-muted">Final Loss</div>
                          <div className="text-sm font-mono font-bold text-citadel-accent">{last?.loss.toFixed(4)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-citadel-muted">Best Accuracy</div>
                          <div className="text-sm font-mono font-bold text-citadel-success">{(Math.max(...selected.training_history.map(e => e.accuracy)) * 100).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-citadel-muted">Total Epochs</div>
                          <div className="text-sm font-mono font-bold">{selected.training_history.length}</div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Charts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LossCurveChart model={selected} />
              <AccuracyChart model={selected} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LearningRateChart model={selected} />
              <EpochMetricsTable model={selected} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Model comparison */}
      {models.length > 1 && <ModelComparison models={models} />}
    </div>
  );
}
