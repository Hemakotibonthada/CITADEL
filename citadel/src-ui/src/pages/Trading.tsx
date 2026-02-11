/**
 * CITADEL — Trading Page
 *
 * Order entry, open orders, order history, watchlist management.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, Order } from '../store';

const POPULAR_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'SPY', 'QQQ', 'IWM'];

// ── Order Entry Form ─────────────────────────────────────
function OrderEntry() {
  const { placeOrder, portfolioSettings, holdings, fetchHoldings } = useStore();
  const [symbol, setSymbol] = useState('');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => { fetchHoldings(); }, []);

  const cash = holdings?.cash ?? portfolioSettings.initial_capital;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim() || !quantity) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await placeOrder(
        symbol.trim().toUpperCase(),
        action,
        Number(quantity),
        orderType,
        orderType === 'limit' ? Number(limitPrice) : undefined,
      );
      setFeedback({ type: 'success', msg: `${action} ${quantity} ${symbol.toUpperCase()} placed!` });
      setSymbol('');
      setQuantity('');
      setLimitPrice('');
    } catch (err: unknown) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Order failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#1a2332] border border-[#1e3a5f] rounded-2xl p-6"
    >
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-xl">📝</span> Place Order
      </h2>

      <div className="bg-[#111827]/60 rounded-xl p-4 mb-4 flex items-center justify-between">
        <div>
          <span className="text-gray-400 text-xs uppercase tracking-wider">Available Cash</span>
          <div className="text-2xl font-bold text-[#00d4ff]">${cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div>
          <span className="text-gray-400 text-xs uppercase tracking-wider">Max Position</span>
          <div className="text-lg font-semibold text-gray-300">{portfolioSettings.max_position_pct}%</div>
        </div>
        <div>
          <span className="text-gray-400 text-xs uppercase tracking-wider">Risk / Trade</span>
          <div className="text-lg font-semibold text-gray-300">{portfolioSettings.risk_per_trade_pct}%</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Action toggle */}
        <div className="flex gap-2">
          {(['BUY', 'SELL'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                action === a
                  ? a === 'BUY'
                    ? 'bg-[#10b981] text-white shadow-lg shadow-[#10b981]/25'
                    : 'bg-[#ef4444] text-white shadow-lg shadow-[#ef4444]/25'
                  : 'bg-[#111827] text-gray-400 hover:text-white'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Symbol */}
        <div>
          <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL"
            required
            className="w-full bg-[#111827] border border-[#1e3a5f] rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:border-[#00d4ff] focus:outline-none transition"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {POPULAR_SYMBOLS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSymbol(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  symbol === s
                    ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/40'
                    : 'bg-[#111827] text-gray-400 hover:text-white border border-[#1e3a5f]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1">Quantity</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="100"
            required
            className="w-full bg-[#111827] border border-[#1e3a5f] rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:border-[#00d4ff] focus:outline-none transition"
          />
        </div>

        {/* Order type */}
        <div>
          <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1">Order Type</label>
          <div className="flex gap-2">
            {(['market', 'limit'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                  orderType === t
                    ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/40'
                    : 'bg-[#111827] text-gray-400 hover:text-white border border-[#1e3a5f]'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Limit price */}
        <AnimatePresence>
          {orderType === 'limit' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1">Limit Price</label>
              <input
                type="number"
                step="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="150.00"
                required
                className="w-full bg-[#111827] border border-[#1e3a5f] rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:border-[#00d4ff] focus:outline-none transition"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !symbol.trim() || !quantity}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
            action === 'BUY'
              ? 'bg-[#10b981] hover:bg-[#059669] disabled:bg-[#10b981]/40'
              : 'bg-[#ef4444] hover:bg-[#dc2626] disabled:bg-[#ef4444]/40'
          } text-white disabled:cursor-not-allowed`}
        >
          {submitting ? 'Placing...' : `${action} ${symbol || '...'}`}
        </button>

        {/* Feedback */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium ${
                feedback.type === 'success'
                  ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30'
                  : 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30'
              }`}
            >
              {feedback.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </motion.div>
  );
}

// ── Open Orders ──────────────────────────────────────────
function OpenOrders() {
  const { orders, fetchOrders, cancelOrder } = useStore();
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => { fetchOrders(); }, []);

  const openList = orders?.open ?? [];

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try { await cancelOrder(id); } finally { setCancelling(null); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-[#1a2332] border border-[#1e3a5f] rounded-2xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-xl">⏳</span> Open Orders
          {openList.length > 0 && (
            <span className="bg-[#f59e0b]/20 text-[#f59e0b] text-xs font-bold px-2 py-0.5 rounded-full">
              {openList.length}
            </span>
          )}
        </h2>
        <button onClick={() => fetchOrders()} className="text-xs text-[#00d4ff] hover:underline">Refresh</button>
      </div>

      {openList.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No open orders</div>
      ) : (
        <div className="space-y-2">
          {openList.map((o) => (
            <div key={o.id} className="bg-[#111827]/60 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  o.action === 'BUY' ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-[#ef4444]/20 text-[#ef4444]'
                }`}>
                  {o.action}
                </span>
                <span className="text-white font-semibold">{o.symbol}</span>
                <span className="text-gray-400 text-sm">{o.quantity} shares</span>
                {o.limit_price && (
                  <span className="text-gray-400 text-sm">@ ${o.limit_price.toFixed(2)}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{o.order_type}</span>
                <button
                  onClick={() => handleCancel(o.id)}
                  disabled={cancelling === o.id}
                  className="px-3 py-1 rounded-lg bg-[#ef4444]/15 text-[#ef4444] text-xs font-medium hover:bg-[#ef4444]/25 transition disabled:opacity-50"
                >
                  {cancelling === o.id ? '...' : 'Cancel'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Order History ────────────────────────────────────────
function OrderHistory() {
  const { orders, fetchOrders } = useStore();

  useEffect(() => { fetchOrders(); }, []);

  const history = orders?.history ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-[#1a2332] border border-[#1e3a5f] rounded-2xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-xl">📋</span> Order History
          {history.length > 0 && (
            <span className="text-xs text-gray-400">({history.length})</span>
          )}
        </h2>
        <button onClick={() => fetchOrders()} className="text-xs text-[#00d4ff] hover:underline">Refresh</button>
      </div>

      {history.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No completed orders yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs uppercase border-b border-[#1e3a5f]">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">Symbol</th>
                <th className="text-left py-2 px-2">Side</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Price</th>
                <th className="text-right py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 50).map((o) => (
                <tr key={o.id} className="border-b border-[#1e3a5f]/30 hover:bg-[#111827]/40 transition">
                  <td className="py-2 px-2 text-gray-400">
                    {new Date(o.filled_at || o.created_at).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2 px-2 text-white font-medium">{o.symbol}</td>
                  <td className="py-2 px-2">
                    <span className={o.action === 'BUY' ? 'text-[#10b981]' : 'text-[#ef4444]'}>{o.action}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-gray-300">{o.quantity}</td>
                  <td className="py-2 px-2 text-right text-gray-300">${o.filled_price.toFixed(2)}</td>
                  <td className="py-2 px-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      o.status === 'filled' ? 'bg-[#10b981]/15 text-[#10b981]' :
                      o.status === 'cancelled' ? 'bg-[#ef4444]/15 text-[#ef4444]' :
                      'bg-[#f59e0b]/15 text-[#f59e0b]'
                    }`}>
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

// ── Watchlist ─────────────────────────────────────────────
function Watchlist() {
  const { watchlist, fetchWatchlist, addToWatchlist, removeFromWatchlist, fetchStockDetail } = useStore();
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => { fetchWatchlist(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol.trim()) return;
    setAdding(true);
    try {
      await addToWatchlist(newSymbol.trim().toUpperCase());
      setNewSymbol('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bg-[#1a2332] border border-[#1e3a5f] rounded-2xl p-6"
    >
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-xl">👁️</span> Watchlist
      </h2>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
          placeholder="Add symbol..."
          className="flex-1 bg-[#111827] border border-[#1e3a5f] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[#00d4ff] focus:outline-none transition"
        />
        <button
          type="submit"
          disabled={adding || !newSymbol.trim()}
          className="px-4 py-2 rounded-xl bg-[#00d4ff] hover:bg-[#00bcd4] text-black font-bold text-sm transition disabled:opacity-40"
        >
          {adding ? '...' : '+'}
        </button>
      </form>

      {watchlist.length === 0 ? (
        <div className="text-center text-gray-500 py-6">No symbols in watchlist</div>
      ) : (
        <div className="space-y-1.5">
          {watchlist.map((sym) => (
            <div
              key={sym}
              className="flex items-center justify-between bg-[#111827]/60 rounded-xl px-4 py-2.5 hover:bg-[#111827] transition group"
            >
              <button
                onClick={() => fetchStockDetail(sym)}
                className="text-white font-semibold hover:text-[#00d4ff] transition"
              >
                {sym}
              </button>
              <button
                onClick={() => removeFromWatchlist(sym)}
                className="text-gray-500 hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Quick Stats Bar ──────────────────────────────────────
function TradingStats() {
  const { holdings, orders, portfolioSettings, fetchHoldings, fetchOrders } = useStore();

  useEffect(() => { fetchHoldings(); fetchOrders(); }, []);

  const cash = holdings?.cash ?? portfolioSettings.initial_capital;
  const invested = holdings?.invested ?? 0;
  const equity = holdings?.total_equity ?? cash;
  const openCount = orders?.total_open ?? 0;
  const filledCount = orders?.total_filled ?? 0;
  const posCount = (holdings?.manual_count ?? 0) + (holdings?.engine_count ?? 0);

  const stats = [
    { label: 'Equity', value: `$${equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: 'text-[#00d4ff]' },
    { label: 'Cash', value: `$${cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: 'text-[#10b981]' },
    { label: 'Invested', value: `$${invested.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: 'text-[#f59e0b]' },
    { label: 'Positions', value: String(posCount), color: 'text-white' },
    { label: 'Open Orders', value: String(openCount), color: openCount > 0 ? 'text-[#f59e0b]' : 'text-gray-400' },
    { label: 'Filled', value: String(filledCount), color: 'text-gray-300' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6"
    >
      {stats.map((s) => (
        <div key={s.label} className="bg-[#1a2332] border border-[#1e3a5f] rounded-xl p-4 text-center">
          <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">{s.label}</div>
          <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
        </div>
      ))}
    </motion.div>
  );
}

// ── Main Trading Page ────────────────────────────────────
export default function Trading() {
  return (
    <div className="space-y-6">
      <TradingStats />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <OrderEntry />
          <Watchlist />
        </div>
        <div className="lg:col-span-2 space-y-6">
          <OpenOrders />
          <OrderHistory />
        </div>
      </div>
    </div>
  );
}
