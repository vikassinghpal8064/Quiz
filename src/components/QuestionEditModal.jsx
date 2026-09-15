import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const overlay = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const panel = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

const fieldClass =
  "mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

const labelClass = "block text-sm font-medium text-ink/70";

function toForm(question) {
  const options = [...(question.options ?? [])].sort((a, b) => a.id - b.id);
  const correctIdx = options.findIndex((o) => o.is_correct);
  return {
    question_text: question.question_text ?? "",
    options: [
      options[0]?.option_text ?? "",
      options[1]?.option_text ?? "",
      options[2]?.option_text ?? "",
      options[3]?.option_text ?? "",
    ],
    correct: correctIdx === -1 ? 0 : correctIdx,
    explanation: question.explanation ?? "",
  };
}

export default function QuestionEditModal({ question, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (question) {
      setForm(toForm(question));
      setSaving(false);
      setError(null);
    }
  }, [question]);

  if (!question || !form) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: form.question_text,
          explanation: form.explanation || undefined,
          options: form.options.map((text, i) => ({
            option_text: text,
            is_correct: i === form.correct,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save question");
      }

      const updated = await res.json();
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        variants={overlay}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />

        <motion.div
          className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
          variants={panel}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <h2 className="text-xl font-semibold text-ink">Edit Question</h2>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="edit-q-text" className={labelClass}>
                Question *
              </label>
              <textarea
                id="edit-q-text"
                rows={3}
                required
                value={form.question_text}
                onChange={(e) =>
                  setForm({ ...form, question_text: e.target.value })
                }
                className={fieldClass}
                placeholder="Type the question…"
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-ink/70">Options</p>
              <div className="space-y-2">
                {["A", "B", "C", "D"].map((letter, i) => (
                  <div key={letter} className="flex items-center gap-3">
                    <label className="flex w-6 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="radio"
                        name="correct-option"
                        checked={form.correct === i}
                        onChange={() => setForm({ ...form, correct: i })}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    <span className="w-5 text-sm font-semibold text-ink/50">
                      {letter}
                    </span>
                    <input
                      type="text"
                      required
                      value={form.options[i]}
                      onChange={(e) => {
                        const options = [...form.options];
                        options[i] = e.target.value;
                        setForm({ ...form, options });
                      }}
                      className={fieldClass}
                      placeholder={`Option ${letter} text…`}
                    />
                  </div>
                ))}
                <p className="text-xs text-ink/40">
                  Select the radio next to the correct option.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="edit-q-explanation" className={labelClass}>
                Explanation
              </label>
              <textarea
                id="edit-q-explanation"
                rows={2}
                value={form.explanation}
                onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                className={fieldClass}
                placeholder="Why is the answer correct? (shown on the results screen)"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}