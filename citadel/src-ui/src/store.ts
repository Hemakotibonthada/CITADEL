/**
 * CITADEL — Zustand Store
 * 
 * Central state management with WebSocket real-time updates.
 */

import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────

export interface Position {
  symbol: string;
  quantity: number;
  avg_cost: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  side: string;
}

export interface PortfolioState {
  total_equity: number;
  cash: number;
  positions: Position[];
  daily_pnl: number;
  total_pnl: number;
  leverage: number;
}

export interface AgentStatus {
  name: string;
  status: string;
  uptime?: number;
  metrics?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  lessons?: Array<Record<string, unknown>>;
  cot?: string[];
}

export interface Trade {
  id: string;
  symbol: string;
  action: string;
  quantity: number;
  price: number;
  pnl?: number;
  timestamp: string;
}

export interface NewsItem {
  title: string;
  source: string;
  sentiment: string;
  score: number;
  symbols: string[];
  timestamp: string;
  url?: string;
}

export interface PnlDataPoint {
  date: string;
  pnl: number;
  cumulative: number;
  equity: number;
}

export interface RiskMetrics {
  var_95: number;
  sharpe: number;
  max_drawdown: number;
  win_rate: number;
  leverage: number;
  kill_switch_level: string;
}

export interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockDetail {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  high52w: number;
  low52w: number;
  marketCap: string;
  pe: number;
  candles: CandleData[];
  volumeHistory: { date: string; volume: number }[];
}

export interface TrainingEpoch {
  epoch: number;
  loss: number;
  val_loss: number;
  accuracy: number;
  learning_rate: number;
  timestamp: string;
}

export interface ModelInfo {
  name: string;
  type: string;
  status: string;
  total_epochs: number;
  current_epoch: number;
  best_loss: number;
  training_history: TrainingEpoch[];
  last_trained: string;
  parameters: number;
  checkpoint_path: string;
  // Extended properties
  version?: string;
  architecture?: string;
  hidden_size?: number;
  num_layers?: number;
  vocab_size?: number;
  max_seq_length?: number;
  model_size_bytes?: number;
  model_size_display?: string;
  framework?: string;
  device?: string;
  quantized?: boolean;
  config?: Record<string, unknown>;
}

export interface TrainingRun {
  id: string;
  model_name: string;
  status: string; // running, completed, stopped, failed
  epochs_total: number;
  epochs_completed: number;
  current_loss: number;
  current_val_loss: number;
  current_accuracy: number;
  current_lr: number;
  best_loss: number;
  started_at: string;
  finished_at?: string;
  elapsed_s: number;
  epoch_history: TrainingEpoch[];
  config: {
    epochs: number;
    learning_rate: number;
    batch_size: number;
    rank: number;
    data_source: string;
    samples: number;
  };
  error?: string;
}

export interface AgentDetail {
  name: string;
  role: string;
  description: string;
  model: string;
  version: string;
  status: string;
  uptime: number;
  capabilities: string[];
  config_keys: string[];
  config_values: Record<string, unknown>;
  metrics: Record<string, unknown>;
  error_count: number;
  last_heartbeat: number | null;
  lessons?: Array<Record<string, unknown>>;
  strategy_weights?: Record<string, number>;
  training_history?: Array<Record<string, unknown>>;
  analysis?: Record<string, unknown>;
}

export interface SavedReport {
  filename: string;
  path: string;
  type: string;
  trigger: string;
  date: string;
  time: string;
  size_bytes: number;
  size_display: string;
  created_at: string;
  modified_at: string;
}

export interface ReportStats {
  total: number;
  total_size: string;
  total_size_bytes: number;
  by_type: Record<string, number>;
  last_generated: string | null;
  last_filename: string | null;
}

export interface ReportSchedule {
  id: string;
  type: string;
  cron: string;
  email: boolean;
  enabled: boolean;
  description: string;
}

export interface ReportConfig {
  available_types: string[];
  available_sections: Record<string, string[]>;
  output_dir: string;
  email_configured: boolean;
  formats: string[];
}

export type SystemState = 'IDLE' | 'LIVE' | 'PAPER' | 'BACKTEST' | 'HALTED' | 'ERROR';
export type Tab = 'dashboard' | 'portfolio' | 'agents' | 'models' | 'news' | 'reports' | 'brain';

export interface CitadelStore {
  // System
  systemState: SystemState;
  connected: boolean;
  uptime: number;
  activeTab: Tab;
  
  // Portfolio
  portfolio: PortfolioState;
  pnlHistory: PnlDataPoint[];
  trades: Trade[];
  
  // Agents
  agents: Record<string, AgentStatus>;
  cotStream: string[];
  
  // Market
  news: NewsItem[];
  risk: RiskMetrics;
  
  // Stock detail modal
  selectedStock: StockDetail | null;
  stockDetailOpen: boolean;
  
  // Model learning
  models: ModelInfo[];

  // Training
  activeTraining: TrainingRun | null;
  trainingHistory: TrainingRun[];
  agentDetails: Record<string, AgentDetail>;

  // Reports
  savedReports: SavedReport[];
  reportStats: ReportStats | null;
  reportSchedules: ReportSchedule[];
  reportConfig: ReportConfig | null;
  
  // Actions
  setTab: (tab: Tab) => void;
  setSystemState: (state: SystemState) => void;
  setConnected: (connected: boolean) => void;
  updatePortfolio: (portfolio: Partial<PortfolioState>) => void;
  updateAgents: (agents: Record<string, AgentStatus>) => void;
  addTrade: (trade: Trade) => void;
  setTrades: (trades: Trade[]) => void;
  setPnlHistory: (data: PnlDataPoint[]) => void;
  setNews: (news: NewsItem[]) => void;
  setRisk: (risk: RiskMetrics) => void;
  setCotStream: (cot: string[]) => void;
  openStockDetail: (stock: StockDetail) => void;
  closeStockDetail: () => void;
  setModels: (models: ModelInfo[]) => void;
  setActiveTraining: (t: TrainingRun | null) => void;
  setTrainingHistory: (h: TrainingRun[]) => void;
  setAgentDetails: (name: string, d: AgentDetail) => void;
  setSavedReports: (r: SavedReport[]) => void;
  setReportStats: (s: ReportStats) => void;
  setReportSchedules: (s: ReportSchedule[]) => void;
  setReportConfig: (c: ReportConfig) => void;
  
  // API
  fetchPortfolio: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchTrades: () => Promise<void>;
  fetchPnl: () => Promise<void>;
  fetchNews: () => Promise<void>;
  fetchRisk: () => Promise<void>;
  fetchStockDetail: (symbol: string) => Promise<void>;
  fetchModels: () => Promise<void>;
  startTraining: (config: { model_name?: string; epochs?: number; learning_rate?: number; batch_size?: number; rank?: number; data_source?: string; samples?: number }) => Promise<void>;
  stopTraining: () => Promise<void>;
  fetchTrainingStatus: () => Promise<void>;
  fetchTrainingHistory: () => Promise<void>;
  fetchAgentDetails: (name: string) => Promise<void>;
  submitTrade: (symbol: string, action: string, sizePct: number) => Promise<void>;
  triggerReport: (type: string, email: boolean, trigger?: string) => Promise<void>;
  fetchSavedReports: () => Promise<void>;
  fetchReportStats: () => Promise<void>;
  fetchReportSchedules: () => Promise<void>;
  fetchReportConfig: () => Promise<void>;
  deleteReport: (filename: string) => Promise<void>;
  toggleKillSwitch: (action: string, level?: string) => Promise<void>;
}

const API_BASE = '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Demo data generators
function generateDemoCandles(symbol: string, days: number = 90): CandleData[] {
  const basePrices: Record<string, number> = {
    AAPL: 195, MSFT: 420, GOOGL: 175, AMZN: 200, NVDA: 800,
    TSLA: 250, META: 550, SPY: 520, QQQ: 445, IWM: 210,
  };
  let price = basePrices[symbol] || 100;
  const candles: CandleData[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const change = price * (Math.random() - 0.48) * 0.03;
    const open = price;
    price = Math.max(1, price + change);
    const high = Math.max(open, price) * (1 + Math.random() * 0.01);
    const low = Math.min(open, price) * (1 - Math.random() * 0.01);
    candles.push({
      date: d.toISOString().slice(0, 10),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +price.toFixed(2),
      volume: Math.round(1e6 + Math.random() * 5e6),
    });
  }
  return candles;
}

function generateDemoStockDetail(symbol: string): StockDetail {
  const candles = generateDemoCandles(symbol);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last.close - prev.close;
  const names: Record<string, string> = {
    AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', GOOGL: 'Alphabet Inc.',
    AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.', TSLA: 'Tesla Inc.',
    META: 'Meta Platforms Inc.', SPY: 'SPDR S&P 500 ETF', QQQ: 'Invesco QQQ Trust', IWM: 'iShares Russell 2000',
  };
  return {
    symbol,
    name: names[symbol] || symbol,
    price: last.close,
    change,
    changePct: (change / prev.close) * 100,
    high52w: Math.max(...candles.map(c => c.high)),
    low52w: Math.min(...candles.map(c => c.low)),
    marketCap: '$' + (last.close * (1e9 + Math.random() * 2e9) / 1e9).toFixed(0) + 'B',
    pe: +(15 + Math.random() * 25).toFixed(1),
    candles,
    volumeHistory: candles.map(c => ({ date: c.date, volume: c.volume })),
  };
}

function generateDemoModels(): ModelInfo[] {
  const makeHistory = (epochs: number, startLoss: number): TrainingEpoch[] => {
    const history: TrainingEpoch[] = [];
    let loss = startLoss;
    let valLoss = startLoss * 1.1;
    let lr = 0.001;
    for (let i = 1; i <= epochs; i++) {
      loss *= (0.92 + Math.random() * 0.06);
      valLoss *= (0.93 + Math.random() * 0.07);
      if (i % 10 === 0) lr *= 0.5;
      history.push({
        epoch: i,
        loss: +loss.toFixed(6),
        val_loss: +valLoss.toFixed(6),
        accuracy: +Math.min(0.98, 0.5 + (i / epochs) * 0.45 + Math.random() * 0.03).toFixed(4),
        learning_rate: lr,
        timestamp: new Date(Date.now() - (epochs - i) * 60000).toISOString(),
      });
    }
    return history;
  };

  return [
    {
      name: 'FinBERT Sentiment',
      type: 'Transformer (BERT)',
      status: 'trained',
      total_epochs: 30,
      current_epoch: 30,
      best_loss: 0.0412,
      training_history: makeHistory(30, 0.85),
      last_trained: new Date(Date.now() - 3600000).toISOString(),
      parameters: 110_000_000,
      checkpoint_path: 'models/finbert/checkpoint-best.pt',
    },
    {
      name: 'MiniLM Embeddings',
      type: 'Sentence Transformer',
      status: 'trained',
      total_epochs: 20,
      current_epoch: 20,
      best_loss: 0.0289,
      training_history: makeHistory(20, 0.65),
      last_trained: new Date(Date.now() - 7200000).toISOString(),
      parameters: 22_700_000,
      checkpoint_path: 'models/minilm/checkpoint-best.pt',
    },
    {
      name: 'LoRA Adapter (Strategy)',
      type: 'LoRA Fine-tune',
      status: 'training',
      total_epochs: 50,
      current_epoch: 35,
      best_loss: 0.0567,
      training_history: makeHistory(35, 1.2),
      last_trained: new Date().toISOString(),
      parameters: 294_912,
      checkpoint_path: 'models/lora/checkpoint-ep35.npz',
    },
    {
      name: 'Signal Predictor',
      type: 'MLP + Attention',
      status: 'queued',
      total_epochs: 100,
      current_epoch: 0,
      best_loss: 0,
      training_history: [],
      last_trained: '',
      parameters: 1_850_000,
      checkpoint_path: '',
    },
  ];
}

export const useStore = create<CitadelStore>((set, get) => ({
  // Defaults
  systemState: 'IDLE',
  connected: false,
  uptime: 0,
  activeTab: 'dashboard',

  portfolio: {
    total_equity: 100000,
    cash: 100000,
    positions: [],
    daily_pnl: 0,
    total_pnl: 0,
    leverage: 0,
  },
  pnlHistory: [],
  trades: [],

  agents: {},
  cotStream: [],

  news: [],
  risk: {
    var_95: 0,
    sharpe: 0,
    max_drawdown: 0,
    win_rate: 0,
    leverage: 0,
    kill_switch_level: 'NONE',
  },

  selectedStock: null,
  stockDetailOpen: false,
  models: [],

  activeTraining: null,
  trainingHistory: [],
  agentDetails: {},

  savedReports: [],
  reportStats: null,
  reportSchedules: [],
  reportConfig: null,

  // Actions
  setTab: (tab) => set({ activeTab: tab }),
  setSystemState: (state) => set({ systemState: state }),
  setConnected: (connected) => set({ connected }),
  updatePortfolio: (portfolio) => set((s) => ({
    portfolio: { ...s.portfolio, ...portfolio },
  })),
  updateAgents: (agents) => set({ agents }),
  addTrade: (trade) => set((s) => ({ trades: [trade, ...s.trades].slice(0, 200) })),
  setTrades: (trades) => set({ trades }),
  setPnlHistory: (data) => set({ pnlHistory: data }),
  setNews: (news) => set({ news }),
  setRisk: (risk) => set({ risk }),
  setCotStream: (cot) => set({ cotStream: cot }),
  openStockDetail: (stock) => set({ selectedStock: stock, stockDetailOpen: true }),
  closeStockDetail: () => set({ stockDetailOpen: false, selectedStock: null }),
  setModels: (models) => set({ models }),
  setActiveTraining: (activeTraining) => set({ activeTraining }),
  setTrainingHistory: (trainingHistory) => set({ trainingHistory }),
  setAgentDetails: (name, detail) => set((s) => ({ agentDetails: { ...s.agentDetails, [name]: detail } })),
  setSavedReports: (savedReports) => set({ savedReports }),
  setReportStats: (reportStats) => set({ reportStats }),
  setReportSchedules: (reportSchedules) => set({ reportSchedules }),
  setReportConfig: (reportConfig) => set({ reportConfig }),

  // API calls
  fetchPortfolio: async () => {
    try {
      const data = await apiFetch<PortfolioState>('/portfolio');
      set({ portfolio: data });
    } catch { /* offline */ }
  },
  fetchAgents: async () => {
    try {
      const data = await apiFetch<Record<string, AgentStatus>>('/agents');
      set({ agents: data });
    } catch { /* offline */ }
  },
  fetchTrades: async () => {
    try {
      const data = await apiFetch<Trade[]>('/history/trades');
      set({ trades: data });
    } catch { /* offline */ }
  },
  fetchPnl: async () => {
    try {
      const data = await apiFetch<PnlDataPoint[]>('/history/pnl');
      set({ pnlHistory: data });
    } catch { /* offline */ }
  },
  fetchNews: async () => {
    try {
      const data = await apiFetch<NewsItem[]>('/news');
      set({ news: data });
    } catch { /* offline */ }
  },
  fetchRisk: async () => {
    try {
      const data = await apiFetch<RiskMetrics>('/risk');
      set({ risk: data });
    } catch { /* offline */ }
  },
  fetchStockDetail: async (symbol: string) => {
    try {
      const data = await apiFetch<StockDetail>(`/stock/${symbol}`);
      set({ selectedStock: data, stockDetailOpen: true });
    } catch {
      // Fallback to demo data
      set({ selectedStock: generateDemoStockDetail(symbol), stockDetailOpen: true });
    }
  },
  fetchModels: async () => {
    try {
      const data = await apiFetch<ModelInfo[]>('/models');
      set({ models: data });
    } catch {
      set({ models: generateDemoModels() });
    }
  },
  startTraining: async (config) => {
    const data = await apiFetch<{ run_id: string }>('/models/train', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    // Immediately poll for status
    try {
      const status = await apiFetch<TrainingRun>('/models/training/status');
      if (status.id) set({ activeTraining: status });
    } catch { /* will be polled */ }
  },
  stopTraining: async () => {
    await apiFetch('/models/training/stop', { method: 'POST' });
  },
  fetchTrainingStatus: async () => {
    try {
      const data = await apiFetch<TrainingRun & { active: boolean }>('/models/training/status');
      if (data.active) {
        set({ activeTraining: data });
      } else {
        set({ activeTraining: null });
      }
    } catch { /* offline */ }
  },
  fetchTrainingHistory: async () => {
    try {
      const data = await apiFetch<TrainingRun[]>('/models/training/history');
      set({ trainingHistory: data });
    } catch { /* offline */ }
  },
  fetchAgentDetails: async (name) => {
    try {
      const data = await apiFetch<AgentDetail>(`/agents/${name}/details`);
      set((s) => ({ agentDetails: { ...s.agentDetails, [name]: data } }));
    } catch { /* offline */ }
  },
  submitTrade: async (symbol, action, sizePct) => {
    await apiFetch('/trade', {
      method: 'POST',
      body: JSON.stringify({ symbol, action, size_pct: sizePct }),
    });
  },
  triggerReport: async (type, email, trigger = 'manual') => {
    await apiFetch('/report', {
      method: 'POST',
      body: JSON.stringify({ report_type: type, email, trigger }),
    });
  },
  fetchSavedReports: async () => {
    try {
      const data = await apiFetch<SavedReport[]>('/reports');
      set({ savedReports: data });
    } catch { /* offline */ }
  },
  fetchReportStats: async () => {
    try {
      const data = await apiFetch<ReportStats>('/reports/stats');
      set({ reportStats: data });
    } catch { /* offline */ }
  },
  fetchReportSchedules: async () => {
    try {
      const data = await apiFetch<ReportSchedule[]>('/reports/schedules');
      set({ reportSchedules: data });
    } catch { /* offline */ }
  },
  fetchReportConfig: async () => {
    try {
      const data = await apiFetch<ReportConfig>('/reports/config');
      set({ reportConfig: data });
    } catch { /* offline */ }
  },
  deleteReport: async (filename) => {
    await apiFetch(`/reports/${filename}`, { method: 'DELETE' });
    set((s) => ({ savedReports: s.savedReports.filter(r => r.filename !== filename) }));
  },
  toggleKillSwitch: async (action, level) => {
    await apiFetch('/killswitch', {
      method: 'POST',
      body: JSON.stringify({ action, level }),
    });
  },
}));
