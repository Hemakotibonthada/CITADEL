/**
 * CITADEL — Model Training Center
 *
 * Full-featured training UI with:
 *   - On-demand training trigger with configurable hyperparameters
 *   - Real-time epoch progress with loss/accuracy/LR charts
 *   - Model property inspector (version, architecture, size, device, etc.)
 *   - Training history browser with per-run drill-down
 *   - Model comparison bar chart
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import { useStore, type ModelInfo, type TrainingRun } from '../store';

// ── Helpers & sub-components ──────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ready: 'bg-citadel-success', trained: 'bg-citadel-success', training: 'bg-yellow-400',
  running: 'bg-yellow-400', completed: 'bg-citadel-success', stopped: 'bg-orange-400',
  failed: 'bg-citadel-danger', error: 'bg-citadel-danger', loading: 'bg-blue-400',
  untrained: 'bg-gray-500', not_downloaded: 'bg-gray-500', queued: 'bg-blue-400',
  idle: 'bg-gray-500',
};

const CHART_COLORS = ['#00d4ff', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];

function KPI({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-citadel-surface border border-citadel-border rounded-xl p-3 sm:p-4 text-center">
      <div className="text-[9px] sm:text-[10px] uppercase text-citadel-muted tracking-wider">{label}</div>
      <div className={`text-lg sm:text-xl font-bold font-mono mt-1 ${accent || 'text-citadel-text'}`}>{value}</div>
      {sub && <div className="text-[9px] text-citadel-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Spinner() {
  return <span className="inline-block w-4 h-4 border-2 border-citadel-accent/30 border-t-citadel-accent rounded-full animate-spin" />;
}

function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  return (
    <div className="w-full">
      {label && <div className="flex justify-between text-[10px] text-citadel-muted mb-1"><span>{label}</span><span>{pct.toFixed(0)}%</span></div>}
      <div className="h-2 bg-citadel-bg rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, pct)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="h-full bg-gradient-to-r from-citadel-accent to-citadel-success rounded-full"
        />
      </div>
    </div>
  );
}

type SubTab = 'train' | 'models' | 'history';

// ── Main Component ────────────────────────────────────────

export default function ModelLearning() {
  const models = useStore(s => s.models);
  const fetchModels = useStore(s => s.fetchModels);
  const activeTraining = useStore(s => s.activeTraining);
  const trainingHistory = useStore(s => s.trainingHistory);
  const startTraining = useStore(s => s.startTraining);
  const stopTraining = useStore(s => s.stopTraining);
  const fetchTrainingStatus = useStore(s => s.fetchTrainingStatus);
  const fetchTrainingHistory = useStore(s => s.fetchTrainingHistory);

  const [tab, setTab] = useState<SubTab>('train');
  const [selectedModel, setSelectedModel] = useState(0);
  const [inspectModel, setInspectModel] = useState<ModelInfo | null>(null);

  // Training config form
  const [epochs, setEpochs] = useState(15);
  const [lr, setLr] = useState(0.0001);
  const [batchSize, setBatchSize] = useState(8);
  const [rank, setRank] = useState(4);
  const [dataSource, setDataSource] = useState('replay');
  const [samples, setSamples] = useState(50);

  // Polling for training progress
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchModels(); fetchTrainingHistory(); }, [fetchModels, fetchTrainingHistory]);

  useEffect(() => {
    if (activeTraining && activeTraining.status === 'running') {
      pollRef.current = setInterval(() => fetchTrainingStatus(), 2000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }, [activeTraining?.status, fetchTrainingStatus]);

  const handleStartTraining = useCallback(async () => {
    try {
      await startTraining({ model_name: 'lora_adapter', epochs, learning_rate: lr, batch_size: batchSize, rank, data_source: dataSource, samples });
      // Start polling
      await fetchTrainingStatus();
    } catch (e) { console.error('Training start failed:', e); }
  }, [startTraining, fetchTrainingStatus, epochs, lr, batchSize, rank, dataSource, samples]);

  const handleStopTraining = useCallback(async () => {
    try { await stopTraining(); } catch (e) { console.error(e); }
  }, [stopTraining]);

  // Keyboard shortcut: Ctrl+T to start training
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't' && !activeTraining) { e.preventDefault(); handleStartTraining(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTraining, handleStartTraining]);

  const selected = models[selectedModel];
  const TABS: { id: SubTab; label: string; icon: string }[] = [
    { id: 'train', label: 'Train', icon: '🚀' },
    { id: 'models', label: 'Models', icon: '🧠' },
    { id: 'history', label: 'History', icon: '📜' },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Model Training Center</h1>
          <p className="text-xs sm:text-sm text-citadel-muted mt-1">Train, monitor, inspect, and compare your AI models.</p>
        </div>
        <div className="flex gap-2">
          {activeTraining && activeTraining.status === 'running' && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-xs font-medium">
              <Spinner /> Training in progress...
            </div>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-citadel-border pb-px">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition-colors ${tab === t.id
              ? 'bg-citadel-accent/10 text-citadel-accent border-b-2 border-citadel-accent'
              : 'text-citadel-muted hover:text-citadel-text hover:bg-white/5'
            }`}
          >{t.icon} {t.label}</button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ═══════════════════════ TRAIN TAB ═══════════════════════ */}
        {tab === 'train' && (
          <motion.div key="train" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5">

            {/* Config + Launch Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Hyperparameter Config */}
              <div className="lg:col-span-1 bg-citadel-surface border border-citadel-border rounded-xl p-4 sm:p-5 space-y-4">
                <h3 className="text-sm font-semibold">Training Configuration</h3>

                <div>
                  <label className="text-[10px] uppercase text-citadel-muted">Epochs</label>
                  <input type="number" min={1} max={200} value={epochs} onChange={e => setEpochs(+e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-citadel-bg border border-citadel-border rounded-lg text-sm font-mono focus:border-citadel-accent outline-none" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-citadel-muted">Learning Rate</label>
                  <input type="number" step={0.00001} min={0.000001} max={0.1} value={lr} onChange={e => setLr(+e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-citadel-bg border border-citadel-border rounded-lg text-sm font-mono focus:border-citadel-accent outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase text-citadel-muted">Batch Size</label>
                    <select value={batchSize} onChange={e => setBatchSize(+e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-citadel-bg border border-citadel-border rounded-lg text-sm font-mono focus:border-citadel-accent outline-none">
                      {[4, 8, 16, 32, 64].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-citadel-muted">LoRA Rank</label>
                    <select value={rank} onChange={e => setRank(+e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-citadel-bg border border-citadel-border rounded-lg text-sm font-mono focus:border-citadel-accent outline-none">
                      {[2, 4, 8, 16].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-citadel-muted">Data Source</label>
                  <select value={dataSource} onChange={e => setDataSource(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-citadel-bg border border-citadel-border rounded-lg text-sm font-mono focus:border-citadel-accent outline-none">
                    <option value="replay">Decision Replay</option>
                    <option value="synthetic">Synthetic Data</option>
                    <option value="custom">Custom Dataset</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-citadel-muted">Training Samples</label>
                  <input type="number" min={10} max={1000} value={samples} onChange={e => setSamples(+e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-citadel-bg border border-citadel-border rounded-lg text-sm font-mono focus:border-citadel-accent outline-none" />
                </div>

                {/* Launch / Stop buttons */}
                <div className="flex gap-2 pt-2">
                  {(!activeTraining || activeTraining.status !== 'running') ? (
                    <button onClick={handleStartTraining}
                      className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-citadel-accent to-blue-500 text-white font-medium text-sm hover:shadow-lg hover:shadow-citadel-accent/20 transition-all flex items-center justify-center gap-2">
                      🚀 Start Training
                    </button>
                  ) : (
                    <button onClick={handleStopTraining}
                      className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium text-sm hover:shadow-lg transition-all flex items-center justify-center gap-2">
                      ⏹ Stop Training
                    </button>
                  )}
                </div>
                <p className="text-[9px] text-citadel-muted text-center">Ctrl+T to quick-start with current config</p>
              </div>

              {/* Live Training Dashboard */}
              <div className="lg:col-span-2 space-y-4">
                {activeTraining && activeTraining.status === 'running' ? (
                  <LiveTrainingPanel run={activeTraining} />
                ) : activeTraining && (activeTraining.status === 'completed' || activeTraining.status === 'stopped') ? (
                  <TrainingResultPanel run={activeTraining} />
                ) : (
                  <IdleTrainingPanel models={models} />
                )}
              </div>
            </div>

            {/* Model selector below */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {models.map((m, i) => (
                <ModelCard key={m.name} model={m} selected={selectedModel === i}
                  onClick={() => { setSelectedModel(i); setInspectModel(m); }} />
              ))}
            </div>

            {/* Selected model charts */}
            {selected && selected.training_history && selected.training_history.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <LossCurveChart data={selected.training_history} title={`${selected.name} — Loss`} />
                <AccuracyChart data={selected.training_history} title={`${selected.name} — Accuracy`} />
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════ MODELS TAB ═══════════════════════ */}
        {tab === 'models' && (
          <motion.div key="models" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5">

            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPI label="Total Models" value={String(models.length)} accent="text-citadel-accent" />
              <KPI label="Ready" value={String(models.filter(m => m.status === 'ready' || m.status === 'trained').length)} accent="text-citadel-success" />
              <KPI label="Total Parameters" value={formatParams(models.reduce((a, m) => a + m.parameters, 0))} />
              <KPI label="Storage" value={models.reduce((a, m) => a + (m.model_size_bytes || 0), 0) > 0 ? formatBytes(models.reduce((a, m) => a + (m.model_size_bytes || 0), 0)) : 'N/A'} />
            </div>

            {/* Model detail cards */}
            {models.map(m => (
              <ModelDetailCard key={m.name} model={m} />
            ))}

            {/* Model comparison chart */}
            {models.length > 1 && <ModelComparisonChart models={models} />}
          </motion.div>
        )}

        {/* ═══════════════════════ HISTORY TAB ═══════════════════════ */}
        {tab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Training Run History</h3>
              <button onClick={() => fetchTrainingHistory()} className="text-xs text-citadel-accent hover:underline">Refresh</button>
            </div>

            {trainingHistory.length === 0 ? (
              <div className="text-center py-16 text-citadel-muted">
                <div className="text-4xl mb-3">📭</div>
                <div className="text-sm">No training runs yet</div>
                <div className="text-xs mt-1">Start a training run from the Train tab</div>
              </div>
            ) : (
              <div className="space-y-3">
                {trainingHistory.slice().reverse().map((run, i) => (
                  <TrainingRunCard key={run.id || i} run={run} />
                ))}
              </div>
            )}

            {/* Aggregate charts from history */}
            {trainingHistory.length > 1 && <TrainingHistoryCharts runs={trainingHistory} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Model Inspector Modal */}
      <AnimatePresence>
        {inspectModel && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setInspectModel(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-citadel-card border border-citadel-border rounded-2xl p-5 sm:p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold">{inspectModel.name}</h3>
                <button onClick={() => setInspectModel(null)} className="text-citadel-muted hover:text-citadel-text text-lg">✕</button>
              </div>
              <ModelPropertiesTable model={inspectModel} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────

function ModelCard({ model, selected, onClick }: { model: ModelInfo; selected: boolean; onClick: () => void }) {
  return (
    <motion.button onClick={onClick} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      className={`text-left w-full p-3 sm:p-4 rounded-xl border transition-all ${selected
        ? 'bg-citadel-accent/10 border-citadel-accent shadow-lg shadow-citadel-accent/10'
        : 'bg-citadel-surface border-citadel-border hover:border-citadel-accent/40'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[model.status] || 'bg-gray-500'} ${model.status === 'training' || model.status === 'running' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-mono uppercase text-citadel-muted">{model.type}</span>
        </div>
        {model.version && <span className="text-[9px] font-mono text-citadel-muted">v{model.version}</span>}
      </div>
      <h3 className="font-semibold text-sm truncate">{model.name}</h3>
      <div className="text-[10px] text-citadel-muted mt-1">{formatParams(model.parameters)} params</div>
      <div className="grid grid-cols-3 gap-1 mt-2 text-center">
        <div>
          <div className="text-[8px] text-citadel-muted">Status</div>
          <div className={`text-[10px] font-medium ${model.status === 'ready' || model.status === 'trained' ? 'text-citadel-success' : model.status === 'training' ? 'text-yellow-400' : 'text-citadel-muted'}`}>
            {model.status.toUpperCase()}
          </div>
        </div>
        <div>
          <div className="text-[8px] text-citadel-muted">Device</div>
          <div className="text-[10px] font-mono">{model.device || 'cpu'}</div>
        </div>
        <div>
          <div className="text-[8px] text-citadel-muted">Size</div>
          <div className="text-[10px] font-mono">{model.model_size_display || 'N/A'}</div>
        </div>
      </div>
    </motion.button>
  );
}

function LiveTrainingPanel({ run }: { run: TrainingRun }) {
  const pct = (run.epochs_completed / run.epochs_total) * 100;
  const history = run.epoch_history || [];

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="bg-citadel-surface border border-yellow-400/30 rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Spinner />
            <span className="text-sm font-semibold text-yellow-400">Training in Progress</span>
          </div>
          <span className="text-xs font-mono text-citadel-muted">{run.elapsed_s.toFixed(0)}s elapsed</span>
        </div>
        <ProgressBar pct={pct} label={`Epoch ${run.epochs_completed} / ${run.epochs_total}`} />
        <div className="grid grid-cols-4 gap-3 mt-4">
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Loss</div>
            <div className="text-sm font-mono font-bold text-citadel-accent">{run.current_loss.toFixed(4)}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Val Loss</div>
            <div className="text-sm font-mono font-bold text-yellow-400">{run.current_val_loss.toFixed(4)}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Accuracy</div>
            <div className="text-sm font-mono font-bold text-citadel-success">{(run.current_accuracy * 100).toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">LR</div>
            <div className="text-sm font-mono font-bold text-purple-400">{run.current_lr.toExponential(1)}</div>
          </div>
        </div>
      </div>

      {/* Live charts */}
      {history.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LossCurveChart data={history} title="Live Loss Curve" />
          <AccuracyChart data={history} title="Live Accuracy" />
        </div>
      )}
    </div>
  );
}

function TrainingResultPanel({ run }: { run: TrainingRun }) {
  const history = run.epoch_history || [];
  return (
    <div className="space-y-4">
      <div className={`bg-citadel-surface border rounded-xl p-4 sm:p-5 ${run.status === 'completed' ? 'border-citadel-success/30' : 'border-orange-400/30'}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-sm font-semibold ${run.status === 'completed' ? 'text-citadel-success' : 'text-orange-400'}`}>
            {run.status === 'completed' ? '✓ Training Completed' : '⏹ Training Stopped'}
          </span>
          <span className="text-xs font-mono text-citadel-muted">{run.elapsed_s.toFixed(1)}s total</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Final Loss</div>
            <div className="text-sm font-mono font-bold text-citadel-accent">{run.current_loss.toFixed(4)}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Best Loss</div>
            <div className="text-sm font-mono font-bold text-citadel-success">{run.best_loss < 999 ? run.best_loss.toFixed(4) : '—'}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Accuracy</div>
            <div className="text-sm font-mono font-bold text-citadel-success">{(run.current_accuracy * 100).toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-citadel-muted">Epochs</div>
            <div className="text-sm font-mono font-bold">{run.epochs_completed}/{run.epochs_total}</div>
          </div>
        </div>
      </div>
      {history.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LossCurveChart data={history} title="Final Loss Curve" />
          <AccuracyChart data={history} title="Final Accuracy" />
        </div>
      )}
    </div>
  );
}

function IdleTrainingPanel({ models }: { models: ModelInfo[] }) {
  const readyCount = models.filter(m => m.status === 'ready' || m.status === 'trained').length;
  return (
    <div className="bg-citadel-surface border border-citadel-border rounded-xl p-6 sm:p-8 text-center">
      <div className="text-5xl mb-4">🧠</div>
      <h3 className="text-lg font-semibold mb-2">Ready to Train</h3>
      <p className="text-sm text-citadel-muted max-w-md mx-auto">
        Configure hyperparameters on the left and click <strong className="text-citadel-accent">Start Training</strong> to begin a LoRA fine-tuning session.
        Real-time loss curves and accuracy charts will appear here.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3 max-w-xs mx-auto">
        <div className="text-center">
          <div className="text-[9px] text-citadel-muted">Models</div>
          <div className="text-base font-bold font-mono">{models.length}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-citadel-muted">Ready</div>
          <div className="text-base font-bold font-mono text-citadel-success">{readyCount}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-citadel-muted">Shortcut</div>
          <div className="text-[10px] font-mono bg-citadel-bg px-2 py-1 rounded">Ctrl+T</div>
        </div>
      </div>
    </div>
  );
}

function ModelDetailCard({ model }: { model: ModelInfo }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div layout className="bg-citadel-surface border border-citadel-border rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[model.status] || 'bg-gray-500'}`} />
          <div className="text-left min-w-0">
            <div className="font-semibold text-sm sm:text-base">{model.name}</div>
            <div className="text-[10px] text-citadel-muted truncate">{model.type} • {model.architecture || model.type} • {formatParams(model.parameters)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${model.status === 'ready' || model.status === 'trained' ? 'bg-citadel-success/20 text-citadel-success' : model.status === 'training' || model.status === 'running' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-citadel-muted/20 text-citadel-muted'}`}>
            {model.status.toUpperCase()}
          </span>
          <span className="text-citadel-muted text-sm">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="p-4 sm:p-5 pt-0 border-t border-citadel-border/50">
              <ModelPropertiesTable model={model} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ModelPropertiesTable({ model }: { model: ModelInfo }) {
  const rows: [string, string | number | boolean | undefined][] = [
    ['Name', model.name],
    ['Type', model.type],
    ['Architecture', model.architecture],
    ['Version', model.version],
    ['Status', model.status],
    ['Parameters', formatParams(model.parameters)],
    ['Hidden Size', model.hidden_size],
    ['Layers', model.num_layers],
    ['Vocab Size', model.vocab_size ? model.vocab_size.toLocaleString() : undefined],
    ['Max Sequence Length', model.max_seq_length],
    ['Model Size', model.model_size_display],
    ['Framework', model.framework],
    ['Device', model.device],
    ['Quantized', model.quantized !== undefined ? (model.quantized ? 'Yes' : 'No') : undefined],
    ['Checkpoint Path', model.checkpoint_path],
    ['Last Trained', model.last_trained ? new Date(model.last_trained).toLocaleString() : 'Never'],
  ];

  return (
    <div className="space-y-3">
      <table className="w-full text-xs sm:text-sm">
        <tbody>
          {rows.filter(([, v]) => v !== undefined && v !== '' && v !== 0).map(([k, v]) => (
            <tr key={k} className="border-b border-citadel-border/30">
              <td className="py-1.5 pr-4 text-citadel-muted font-medium whitespace-nowrap">{k}</td>
              <td className="py-1.5 font-mono text-citadel-text break-all">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.config && Object.keys(model.config).length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-citadel-muted mb-1">Raw Config</div>
          <pre className="text-[10px] font-mono bg-citadel-bg/50 rounded p-2 overflow-x-auto max-h-40">
            {JSON.stringify(model.config, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function TrainingRunCard({ run }: { run: TrainingRun }) {
  const [expanded, setExpanded] = useState(false);
  const history = run.epoch_history || [];
  return (
    <div className="bg-citadel-surface border border-citadel-border rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[run.status] || 'bg-gray-500'}`} />
          <div className="text-left min-w-0">
            <div className="text-sm font-medium">{run.model_name} — {run.id}</div>
            <div className="text-[10px] text-citadel-muted">{run.started_at ? new Date(run.started_at).toLocaleString() : ''} • {run.elapsed_s.toFixed(1)}s • {run.epochs_completed}/{run.epochs_total} epochs</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-mono text-citadel-accent">Loss: {run.current_loss.toFixed(4)}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${run.status === 'completed' ? 'bg-citadel-success/20 text-citadel-success' : run.status === 'failed' ? 'bg-citadel-danger/20 text-citadel-danger' : 'bg-orange-400/20 text-orange-400'}`}>
            {run.status.toUpperCase()}
          </span>
          <span className="text-citadel-muted text-sm">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      <AnimatePresence>
        {expanded && history.length > 0 && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="p-3 sm:p-4 pt-0 border-t border-citadel-border/50 space-y-3">
              {/* Config summary */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {Object.entries(run.config || {}).map(([k, v]) => (
                  <div key={k} className="bg-citadel-bg/50 rounded p-1.5">
                    <div className="text-[8px] text-citadel-muted">{k}</div>
                    <div className="text-[10px] font-mono">{String(v)}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <LossCurveChart data={history} title="Loss" />
                <AccuracyChart data={history} title="Accuracy" />
              </div>
              <EpochTable epochs={history} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LossCurveChart({ data, title }: { data: Array<{ epoch: number; loss: number; val_loss: number }>; title: string }) {
  const chartData = data.map(e => ({ epoch: e.epoch, loss: e.loss, valLoss: e.val_loss }));
  return (
    <div className="bg-citadel-card rounded-xl border border-citadel-border p-3 sm:p-4">
      <h4 className="text-[10px] sm:text-xs font-medium text-citadel-muted mb-2">{title}</h4>
      <div className="h-44 sm:h-52"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
          <XAxis dataKey="epoch" stroke="#64748b" fontSize={9} />
          <YAxis stroke="#64748b" fontSize={9} />
          <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
          <Legend wrapperStyle={{ fontSize: '10px' }} />
          <Line type="monotone" dataKey="loss" stroke="#00d4ff" strokeWidth={2} dot={false} name="Train" />
          <Line type="monotone" dataKey="valLoss" stroke="#f59e0b" strokeWidth={2} dot={false} name="Val" strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer></div>
    </div>
  );
}

function AccuracyChart({ data, title }: { data: Array<{ epoch: number; accuracy: number }>; title: string }) {
  const chartData = data.map(e => ({ epoch: e.epoch, accuracy: +(e.accuracy * 100).toFixed(2) }));
  return (
    <div className="bg-citadel-card rounded-xl border border-citadel-border p-3 sm:p-4">
      <h4 className="text-[10px] sm:text-xs font-medium text-citadel-muted mb-2">{title}</h4>
      <div className="h-44 sm:h-52"><ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs><linearGradient id="accGradLive" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.4} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
          <XAxis dataKey="epoch" stroke="#64748b" fontSize={9} />
          <YAxis stroke="#64748b" fontSize={9} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [`${v}%`, 'Accuracy']} />
          <Area type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} fill="url(#accGradLive)" />
        </AreaChart>
      </ResponsiveContainer></div>
    </div>
  );
}

function EpochTable({ epochs }: { epochs: Array<{ epoch: number; loss: number; val_loss: number; accuracy: number; learning_rate: number }> }) {
  const [showAll, setShowAll] = useState(false);
  const display = showAll ? epochs : epochs.slice(-10);
  return (
    <div className="bg-citadel-card rounded-xl border border-citadel-border p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] sm:text-xs font-medium text-citadel-muted">Epoch Details</h4>
        {epochs.length > 10 && <button onClick={() => setShowAll(!showAll)} className="text-[10px] text-citadel-accent hover:underline">{showAll ? 'Show Recent' : `Show All (${epochs.length})`}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] sm:text-xs">
          <thead><tr className="text-citadel-muted border-b border-citadel-border">
            <th className="text-left py-1 px-2">Epoch</th>
            <th className="text-right py-1 px-2">Loss</th>
            <th className="text-right py-1 px-2">Val Loss</th>
            <th className="text-right py-1 px-2">Accuracy</th>
            <th className="text-right py-1 px-2">LR</th>
          </tr></thead>
          <tbody>{display.map(e => (
            <tr key={e.epoch} className="border-b border-citadel-border/30 hover:bg-citadel-accent/5">
              <td className="py-1 px-2 font-mono">{e.epoch}</td>
              <td className="py-1 px-2 font-mono text-right text-citadel-accent">{e.loss.toFixed(4)}</td>
              <td className="py-1 px-2 font-mono text-right text-yellow-400">{e.val_loss.toFixed(4)}</td>
              <td className="py-1 px-2 font-mono text-right text-citadel-success">{(e.accuracy * 100).toFixed(1)}%</td>
              <td className="py-1 px-2 font-mono text-right text-purple-400">{e.learning_rate.toExponential(2)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function ModelComparisonChart({ models }: { models: ModelInfo[] }) {
  const data = models.map(m => ({
    name: m.name.split('/').pop()?.split(' ')[0] || m.name,
    params: m.parameters / 1_000_000,
    size: (m.model_size_bytes || 0) / 1_048_576,
  }));
  return (
    <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
      <h4 className="text-xs sm:text-sm font-medium text-citadel-muted mb-3">Model Comparison — Size (MB) vs Parameters (M)</h4>
      <div className="h-48"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 15, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
          <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
          <YAxis stroke="#64748b" fontSize={9} />
          <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
          <Legend wrapperStyle={{ fontSize: '10px' }} />
          <Bar dataKey="params" fill="#00d4ff" radius={[3, 3, 0, 0]} name="Params (M)" />
          <Bar dataKey="size" fill="#10b981" radius={[3, 3, 0, 0]} name="Size (MB)" />
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}

function TrainingHistoryCharts({ runs }: { runs: TrainingRun[] }) {
  const lossData = runs.map((r, i) => ({
    run: `Run ${i + 1}`,
    loss: r.current_loss,
    accuracy: r.current_accuracy * 100,
    duration: r.elapsed_s,
  }));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
        <h4 className="text-xs font-medium text-citadel-muted mb-3">Final Loss Across Runs</h4>
        <div className="h-48"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={lossData}><CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis dataKey="run" stroke="#64748b" fontSize={9} /><YAxis stroke="#64748b" fontSize={9} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey="loss" fill="#00d4ff" radius={[3, 3, 0, 0]} name="Final Loss" />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
      <div className="bg-citadel-surface rounded-xl border border-citadel-border p-4">
        <h4 className="text-xs font-medium text-citadel-muted mb-3">Training Duration (seconds)</h4>
        <div className="h-48"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={lossData}><CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" opacity={0.3} />
            <XAxis dataKey="run" stroke="#64748b" fontSize={9} /><YAxis stroke="#64748b" fontSize={9} />
            <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey="duration" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Duration (s)" />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────

function formatParams(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}
