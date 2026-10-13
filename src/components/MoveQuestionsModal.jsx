import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { moveQuestions } from "../lib/questionMeta";

const overlay = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } };
const panel = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 10 },
};

// Admin move dialog: Subject dropdown -> Category dropdown -> summary ->
// confirm. Existing categories only, any subject (the current one included).
export default function MoveQuestionsModal({
  open,
  questionIds = [],
  sourceCategoryId = null,
  sourceCategoryName = "this category",
  sourceSubjectId = null,
  onClose,
  onMoved,
}) {
  const [subjects, setSubjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Load subjects when the dialog opens and preselect the current subject.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setArmed(false);
    setCategoryId("");
    setError(null);
    setLoadingSubjects(true);
    fetch("/api/subjects")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load subjects"))))
      .then((rows) => {
        if (cancelled) return;
        setSubjects(rows);
        const initial =
          sourceSubjectId && rows.some((s) => s.id === Number(sourceSubjectId))
            ? String(sourceSubjectId)
            : rows[0]
              ? String(rows[0].id)
              : "";
        setSubjectId(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingSubjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceSubjectId]);

  // Load that subject's categories whenever the subject changes.
  useEffect(() => {
    if (!open || !subjectId) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    setLoadingCategories(true);
    setCategoryId("");
    fetch(`/api/categories?subjectId=${subjectId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load categories"))))
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, subjectId]);

  const target = categories.find((c) => String(c.id) === String(categoryId)) ?? null;
  const count = questionIds.length;
  const movable = categories.filter((c) => c.id !== sourceCategoryId);

  async function confirmMove() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await moveQuestions(questionIds, target.id);
      onMoved?.(result, target);
    } catch (err) {
      setError(err.message);
      setBusy(false);
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
            className="relative w-full max-w-md rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Move questions"
          >
            <h2 className="text-xl font-semibold text-ink">Move Questions</h2>
            <p className="mt-1 text-sm text-ink/55">
              {count} {count === 1 ? "question" : "questions"} selected.
            </p>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <label className="mt-4 block text-sm font-medium text-ink/70">
              Subject
              <select
                value={subjectId}
                disabled={loadingSubjects}
                onChange={(e) => setSubjectId(e.target.value)}
                className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
              >
                {loadingSubjects && <option>Loading…</option>}
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium text-ink/70">
              Category
              <select
                value={categoryId}
                disabled={loadingCategories || !subjectId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setArmed(false);
                }}
                className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
              >
                <option value="">
                  {loadingCategories ? "Loading…" : "Select a category"}
                </option>
                {movable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.question_count ?? 0})
                  </option>
                ))}
              </select>
            </label>

            {target && (
              <p className="mt-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-ink/75">
                Move <span className="font-semibold">{count}</span>{" "}
                {count === 1 ? "question" : "questions"} from{" "}
                <span className="font-semibold">{sourceCategoryName}</span> to{" "}
                <span className="font-semibold">{target.name}</span>.
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100 disabled:opacity-50"
              >
                Cancel
              </button>

              {!armed ? (
                <button
                  type="button"
                  disabled={!target || busy}
                  onClick={() => setArmed(true)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || !target}
                  onClick={confirmMove}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? "Moving…" : `Confirm move (${count})`}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
