import { AnimatePresence, motion } from "framer-motion";

export default function Toast({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 max-w-[calc(100vw-3rem)] flex-col gap-3">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`toast pointer-events-auto flex items-start gap-3 px-4 py-3 text-sm ${
              t.type === "error"
                ? "toast-error"
                : "toast-success"
            }`}
          >
            <span className="mt-0.5 font-bold">
              {t.type === "error" ? (
                "✕"
              ) : (
                <span className="text-correct">✓</span>
              )}
            </span>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="opacity-60 transition-opacity hover:opacity-100"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}