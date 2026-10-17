import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { AnimatePresence, motion } from "framer-motion";
import { fetchQuestionFlags, reasonLabel, updateFlagStatus } from "../lib/questionMeta";

const overlay = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } };
const panel = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 10 },
};

const STATUS_BADGE = {
  open: "bg-red-100 text-red-700",
  resolved: "bg-emerald-100 text-emerald-700",
  dismissed: "bg-stone-200 text-ink/60",
};

// Admin triage: every flag on a question (from all users), with resolve /
// dismiss / reopen actions.
export default function FlagDetailsModal({ open, questionId, onClose, onChanged }) {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!open || !questionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchQuestionFlags(questionId)
      .then((rows) => {
        if (!cancelled) setFlags(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, questionId]);

  async function changeStatus(flag, status) {
    setBusyId(flag.id);
    setError(null);
    try {
      await updateFlagStatus(flag.id, status);
      const rows = await fetchQuestionFlags(questionId);
      setFlags(rows);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

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
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Question flags"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">Flags for question #{questionId}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-sm font-semibold text-ink/70 transition hover:bg-ink/10"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="mt-4 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-ink/50">Loading flags…</p>
              ) : flags.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink/50">
                  No flags on this question.
                </p>
              ) : (
                <ul className="space-y-3">
                  {flags.map((flag) => (
                    <li key={flag.id} className="rounded-xl border border-ink/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {reasonLabel(flag.reason)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            STATUS_BADGE[flag.status] ?? "bg-stone-100 text-ink/60"
                          }`}
                        >
                          {flag.status}
                        </span>
                        <span className="text-xs text-ink/45">
                          by {flag.username ?? `user #${flag.user_id}`}
                        </span>
                      </div>

                      {flag.comment && (
                        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-stone-100 p-2 text-sm text-ink/70">
                          {flag.comment}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {flag.status !== "resolved" && (
                          <button
                            type="button"
                            disabled={busyId === flag.id}
                            onClick={() => changeStatus(flag, "resolved")}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Resolve
                          </button>
                        )}
                        {flag.status !== "dismissed" && (
                          <button
                            type="button"
                            disabled={busyId === flag.id}
                            onClick={() => changeStatus(flag, "dismissed")}
                            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 transition hover:bg-stone-100 disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        )}
                        {flag.status !== "open" && (
                          <button
                            type="button"
                            disabled={busyId === flag.id}
                            onClick={() => changeStatus(flag, "open")}
                            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 transition hover:bg-stone-100 disabled:opacity-50"
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
