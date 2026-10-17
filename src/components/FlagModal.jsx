import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FLAG_REASONS, reasonLabel } from "../lib/questionMeta";

const overlay = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } };
const panel = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

// Reason dropdown + optional comment. When the question is already flagged by
// the caller, it offers a "Withdraw flag" action instead of re-filing.
export default function FlagModal({
  open,
  existing = null,
  onClose,
  onSubmit,
  onWithdraw,
  busy = false,
  error = null,
}) {
  const [reason, setReason] = useState("wrong_answer_key");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason(existing?.reason ?? "wrong_answer_key");
    setComment(existing?.comment ?? "");
  }, [open, existing]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative w-full max-w-2xl rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Flag question"
          >
            <h2 className="text-xl font-semibold text-ink">
              {existing ? "Your flag" : "Flag this question"}
            </h2>
            <p className="mt-1 text-sm text-ink/55">
              Reports go to the admins for review. Only you can see your flag.
            </p>

            {existing && (
              <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-ink/60">
                Currently flagged as{" "}
                <span className="font-semibold">{reasonLabel(existing.reason)}</span>
                {existing.status && existing.status !== "open" && (
                  <> · status: {existing.status}</>
                )}
              </p>
            )}

            <label className="mt-4 block text-sm font-medium text-ink/70">
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="field mt-1 w-full px-3 py-2.5 text-sm"
              >
                {FLAG_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium text-ink/70">
              Comment <span className="font-normal text-ink/40">(optional)</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="What looks wrong?"
                className="field mt-1 w-full resize-none px-3 py-2.5 text-sm"
              />
            </label>

            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100 disabled:opacity-50"
              >
                Cancel
              </button>

              {existing && (
                <button
                  type="button"
                  onClick={onWithdraw}
                  disabled={busy}
                  className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
                >
                  {busy ? "…" : "Withdraw flag"}
                </button>
              )}

              <button
                type="button"
                onClick={() => onSubmit(reason, comment)}
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : existing ? "Update flag" : "Submit flag"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
