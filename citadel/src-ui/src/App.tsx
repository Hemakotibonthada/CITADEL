/**
 * CITADEL — App Root
 * Main application with tab routing, StockDetail modal overlay, and WebSocket hook.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store';
import { useWebSocket } from './useWebSocket';
import Header from './components/Header';
import { StockDetailModal } from './components/StockDetailModal';
import { Dashboard } from './pages/Dashboard';
import { Portfolio } from './pages/Portfolio';
import { Agents } from './pages/Agents';
import ModelLearning from './pages/ModelLearning';
import Brain from './pages/Brain';
import NewsPage from './pages/NewsPage';
import Reports from './pages/Reports';
import Trading from './pages/Trading';

const PAGE_MAP: Record<string, React.FC> = {
  dashboard: Dashboard,
  portfolio: Portfolio,
  trading: Trading,
  agents: Agents,
  models: ModelLearning,
  brain: Brain,
  news: NewsPage,
  reports: Reports,
};

export default function App() {
  useWebSocket();

  const activeTab = useStore((s) => s.activeTab);
  const fetchPortfolio = useStore((s) => s.fetchPortfolio);
  const fetchAgents = useStore((s) => s.fetchAgents);

  // Initial data fetch
  useEffect(() => {
    fetchPortfolio();
    fetchAgents();
  }, [fetchPortfolio, fetchAgents]);

  const ActivePage = PAGE_MAP[activeTab] || Dashboard;

  return (
    <div className="min-h-screen bg-citadel-bg text-citadel-text flex flex-col">
      <Header />

      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <ActivePage />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Stock Detail Modal Overlay */}
      <StockDetailModal />

      {/* Footer status bar */}
      <footer className="border-t border-citadel-border bg-citadel-bg/80 backdrop-blur-sm px-4 py-1.5 flex items-center justify-between text-[9px] sm:text-[10px] text-citadel-muted font-mono">
        <span>CITADEL Multi-Agent Trading System</span>
        <span>{new Date().toLocaleDateString()}</span>
      </footer>
    </div>
  );
}
