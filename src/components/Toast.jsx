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
            className={`pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-card-hover ${
              t.type === "error"
                ? "bg-red-600 text-white"
                : "bg-ink text-white"
            }`}
          >
            <span className="mt-0.5 font-bold">
              {t.type === "error" ? (
                "✕"
              ) : (
                <span className="text-emerald-400">✓</span>
              )}
            </span>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="text-white/50 transition-colors hover:text-white"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}