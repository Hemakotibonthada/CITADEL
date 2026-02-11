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
  source?: string;
  added_at?: string;
}

export interface PortfolioSettings {
  initial_capital: number;
  risk_per_trade_pct: number;
  max_position_pct: number;
  max_positions: number;
  stop_loss_pct: number;
  take_profit_pct: number;
}

export interface HoldingsResponse {
  cash: number;
  invested: number;
  total_equity: number;
  positions: Position[];
  manual_count: number;
  engine_count: number;
  settings: PortfolioSettings;
}

export interface Order {
  id: string;
  symbol: string;
  action: string;
  quantity: number;
  size_pct: number | null;
  order_type: string;
  limit_price: number | null;
  status: string;
  filled_price: number;
  created_at: string;
  filled_at: string | null;
}

export interface OrdersResponse {
  open: Order[];
  history: Order[];
  total_open: number;
  total_filled: number;
}

export interface StockAnalysis {
  current_price: number;
  sentiment_score: number;
  momentum: number;
  volatility: number;
  pe_ratio: number;
  volume_trend: string;
  composite_score: number;
  recommendation: string;
  should_invest: boolean;
  reasoning: string[];
}

export interface Suggestion {
  id: string;
  symbol: string;
  reason: string;
  max_invest_amount: number | null;
  auto_invest: boolean;
  status: string;
  analysis: StockAnalysis;
  tracking: boolean;
  created_at: string;
  updated_at: string;
  invested: boolean;
  invest_details: Record<string, unknown> | null;
}

export interface SuggestionsResponse {
  suggestions: Suggestion[];
  total: number;
  tracking: number;
  invested: number;
}

export interface DailyLimits {
  daily_invest_limit: number;
  daily_loss_limit: number;
  max_trades_per_day: number;
}

export interface DailyTracker {
  date: string;
  invested_today: number;
  loss_today: number;
  trades_today: number;
}

export interface DailyLimitsResponse {
  limits: DailyLimits;
  tracker: DailyTracker;
  remaining_budget: number;
  remaining_trades: number;
  remaining_loss_budget: number;
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
  name?: string;
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
  pnl: number | null;
  timestamp: string;
}

export interface NewsItem {
  title: string;
  source: string;
  sentiment?: string;
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
  volumeHistory: Array<{ date: string; volume: number }>;
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
  config: Record<string, unknown>;
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
export type Tab = 'dashboard' | 'portfolio' | 'trading' | 'agents' | 'models' | 'news' | 'reports' | 'brain';

export interface CitadelStore {
  // System
  systemState: SystemState;
  connected: boolean;
  uptime: number;
  activeTab: Tab;
  
  // Portfolio
  portfolio: PortfolioState;
  portfolioSettings: PortfolioSettings;
  holdings: HoldingsResponse | null;
  pnlHistory: PnlDataPoint[];
  trades: Trade[];
  
  // Trading
  orders: OrdersResponse | null;
  watchlist: string[];
  suggestions: SuggestionsResponse | null;
  dailyLimits: DailyLimitsResponse | null;
  
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
  // New trading APIs
  fetchHoldings: () => Promise<void>;
  fetchPortfolioSettings: () => Promise<void>;
  updatePortfolioSettings: (settings: Partial<PortfolioSettings>) => Promise<void>;
  addManualPosition: (symbol: string, quantity: number, avgCost: number, side?: string) => Promise<void>;
  removeManualPosition: (symbol: string) => Promise<void>;
  placeOrder: (symbol: string, action: string, quantity: number, orderType: string, limitPrice?: number) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchWatchlist: () => Promise<void>;
  addToWatchlist: (symbol: string) => Promise<void>;
  removeFromWatchlist: (symbol: string) => Promise<void>;
  // Agent suggestions
  suggestStock: (symbol: string, reason: string, maxAmount: number | null, autoInvest: boolean) => Promise<void>;
  fetchSuggestions: () => Promise<void>;
  removeSuggestion: (symbol: string) => Promise<void>;
  refreshSuggestion: (symbol: string) => Promise<void>;
  // Daily limits
  fetchDailyLimits: () => Promise<void>;
  updateDailyLimits: (limits: Partial<DailyLimits>) => Promise<void>;
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

export const useStore = create<CitadelStore>((set, get) => ({
  // Defaults
  systemState: 'IDLE',
  connected: false,
  uptime: 0,
  activeTab: 'dashboard',

  portfolio: {
    total_equity: 0,
    cash: 0,
    positions: [],
    daily_pnl: 0,
    total_pnl: 0,
    leverage: 0,
  },
  portfolioSettings: {
    initial_capital: 100000,
    risk_per_trade_pct: 2.0,
    max_position_pct: 25.0,
    max_positions: 20,
    stop_loss_pct: 5.0,
    take_profit_pct: 10.0,
  },
  holdings: null,
  pnlHistory: [],
  trades: [],
  orders: null,
  watchlist: [],
  suggestions: null,
  dailyLimits: null,

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
    } catch { /* offline */ }
  },
  fetchModels: async () => {
    try {
      const data = await apiFetch<ModelInfo[]>('/models');
      set({ models: data });
    } catch { /* offline */ }
  },
  startTraining: async (config) => {
    await apiFetch<{ run_id: string }>('/models/train', {
      method: 'POST',
      body: JSON.stringify(config),
    });
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
    } catch {
      // Provide fallback details so the modal isn't stuck on loading
      const fallback: AgentDetail = {
        name,
        role: 'Agent',
        description: 'Agent details could not be loaded from the server.',
        model: 'Unknown',
        version: '2.0.0',
        status: 'IDLE',
        uptime: 0,
        capabilities: [],
        config_keys: [],
        config_values: {},
        metrics: {},
        error_count: 0,
        last_heartbeat: null,
      };
      set((s) => ({ agentDetails: { ...s.agentDetails, [name]: fallback } }));
    }
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

  // ── New Trading APIs ───────────────────────────────
  fetchHoldings: async () => {
    try {
      const data = await apiFetch<HoldingsResponse>('/portfolio/holdings');
      set({
        holdings: data,
        portfolio: {
          ...get().portfolio,
          cash: data.cash,
          total_equity: data.total_equity,
          positions: data.positions,
        },
        portfolioSettings: data.settings,
      });
    } catch { /* offline */ }
  },
  fetchPortfolioSettings: async () => {
    try {
      const data = await apiFetch<PortfolioSettings>('/portfolio/settings');
      set({ portfolioSettings: data });
    } catch { /* offline */ }
  },
  updatePortfolioSettings: async (settings) => {
    try {
      const resp = await apiFetch<{ settings: PortfolioSettings }>('/portfolio/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      set({ portfolioSettings: resp.settings });
    } catch { /* offline */ }
  },
  addManualPosition: async (symbol, quantity, avgCost, side = 'long') => {
    await apiFetch('/portfolio/holdings', {
      method: 'POST',
      body: JSON.stringify({ symbol, quantity, avg_cost: avgCost, side }),
    });
    get().fetchHoldings();
  },
  removeManualPosition: async (symbol) => {
    await apiFetch(`/portfolio/holdings/${symbol}`, { method: 'DELETE' });
    get().fetchHoldings();
  },
  placeOrder: async (symbol, action, quantity, orderType, limitPrice) => {
    await apiFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({
        symbol, action, quantity, order_type: orderType,
        limit_price: limitPrice,
      }),
    });
    get().fetchOrders();
    get().fetchHoldings();
  },
  cancelOrder: async (orderId) => {
    await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
    get().fetchOrders();
  },
  fetchOrders: async () => {
    try {
      const data = await apiFetch<OrdersResponse>('/orders');
      set({ orders: data });
    } catch { /* offline */ }
  },
  fetchWatchlist: async () => {
    try {
      const data = await apiFetch<{ symbols: string[] }>('/watchlist');
      set({ watchlist: data.symbols });
    } catch { /* offline */ }
  },
  addToWatchlist: async (symbol) => {
    try {
      const data = await apiFetch<{ symbols: string[] }>(`/watchlist/${symbol}`, { method: 'POST' });
      set({ watchlist: data.symbols });
    } catch { /* offline */ }
  },
  removeFromWatchlist: async (symbol) => {
    try {
      const data = await apiFetch<{ symbols: string[] }>(`/watchlist/${symbol}`, { method: 'DELETE' });
      set({ watchlist: data.symbols });
    } catch { /* offline */ }
  },

  // ── Agent Suggestions ──────────────────────────────────────────────
  suggestStock: async (symbol, reason, maxAmount, autoInvest) => {
    try {
      const data = await apiFetch<SuggestionsResponse>('/agent/suggest', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          reason,
          max_invest_amount: maxAmount,
          auto_invest: autoInvest,
        }),
      });
      // refresh full list after suggestion
      get().fetchSuggestions();
      // also refresh daily limits since auto-invest may have used budget
      if (autoInvest) get().fetchDailyLimits();
    } catch { /* offline */ }
  },
  fetchSuggestions: async () => {
    try {
      const data = await apiFetch<SuggestionsResponse>('/agent/suggestions');
      set({ suggestions: data });
    } catch { /* offline */ }
  },
  removeSuggestion: async (symbol) => {
    try {
      await apiFetch(`/agent/suggestions/${symbol}`, { method: 'DELETE' });
      get().fetchSuggestions();
    } catch { /* offline */ }
  },
  refreshSuggestion: async (symbol) => {
    try {
      await apiFetch(`/agent/suggestions/${symbol}/refresh`, { method: 'PUT' });
      get().fetchSuggestions();
    } catch { /* offline */ }
  },

  // ── Daily Limits ───────────────────────────────────────────────────
  fetchDailyLimits: async () => {
    try {
      const data = await apiFetch<DailyLimitsResponse>('/daily-limits');
      set({ dailyLimits: data });
    } catch { /* offline */ }
  },
  updateDailyLimits: async (limits) => {
    try {
      const data = await apiFetch<DailyLimitsResponse>('/daily-limits', {
        method: 'PUT',
        body: JSON.stringify(limits),
      });
      set({ dailyLimits: data });
    } catch { /* offline */ }
  },
}));
