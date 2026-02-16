import { useToastStore, type ToastType } from '../stores/toastStore'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react'

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-emerald" />,
  info: <Info size={16} className="text-sky" />,
  error: <AlertCircle size={16} className="text-rose" />,
}

const STYLES: Record<ToastType, string> = {
  success: 'border-emerald/20 bg-emerald/5',
  info: 'border-sky/20 bg-sky/5',
  error: 'border-rose/20 bg-rose/5',
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg max-w-sm ${STYLES[toast.type]}`}
          >
            <span className="mt-0.5 shrink-0">{ICONS[toast.type]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{toast.title}</p>
              {toast.description && (
                <p className="text-xs text-text-muted mt-0.5">{toast.description}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-0.5 rounded hover:bg-surface-3 text-text-muted transition-colors"
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
