/**
 * CITADEL — Global Toast Notification System
 * Stacking bottom-right toast notifications with auto-dismiss and animations.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useStore, type Toast as ToastType } from '../store';

const ICONS: Record<ToastType['type'], string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const COLORS: Record<ToastType['type'], { bg: string; border: string; icon: string }> = {
  success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400' },
  error:   { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'text-red-400' },
  warning: { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'text-amber-400' },
  info:    { bg: 'bg-blue-500/10',     border: 'border-blue-500/30',    icon: 'text-blue-400' },
};

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useStore((s) => s.removeToast);
  const c = COLORS[toast.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`relative flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-2xl max-w-sm ${c.bg} ${c.border}`}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${c.icon} bg-white/5`}>
        {ICONS[toast.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-citadel-text">{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-citadel-muted mt-0.5 line-clamp-2">{toast.message}</p>
        )}
      </div>

      {/* Close */}
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 text-citadel-muted hover:text-citadel-text transition-colors text-sm"
      >
        ✕
      </button>
    </motion.div>
  );
}

export default function ToastContainer() {
  const toasts = useStore((s) => s.toasts);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
