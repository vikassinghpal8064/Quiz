import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import LoadingSkeleton from "../components/LoadingSkeleton";
import BackButton from "../components/BackButton";
import StarIcon from "../components/StarIcon";

export default function QuizTaking() {
  const { categoryId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const mode =
    searchParams.get("mode") === "wrong_only"
      ? "wrong_only"
      : searchParams.get("mode") === "starred_only"
        ? "starred_only"
        : "full";
  const attemptId = searchParams.get("attemptId");

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [starred, setStarred] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!attemptId) {
      setError("No active attempt. Start a quiz from the category page.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const starredRes = await fetch(
          `/api/categories/${categoryId}/starred-questions`
        ).catch(() => null);
        let starredData = null;
        if (starredRes && starredRes.ok) {
          starredData = await starredRes.json();
        }
        let starredIds = new Set();
        if (starredData) {
          starredIds = new Set(
            (starredData.starred_questions ?? []).map((s) => s.question_id)
          );
        }

        let data;
        if (mode === "wrong_only") {
          const wrongRes = await fetch(
            `/api/categories/${categoryId}/wrong-questions`
          );
          if (!wrongRes.ok) throw new Error("Failed to load wrong questions");
          const wrong = await wrongRes.json();

          if (!wrong.length) {
            if (!cancelled) {
              setQuestions([]);
              setLoading(false);
            }
            return;
          }

          const ids = wrong.map((w) => w.question_id);
          const res = await fetch(`/api/questions?questionIds=${ids.join(",")}`);
          if (!res.ok) throw new Error("Failed to load questions");
          data = await res.json();

          const orderMap = new Map(wrong.map((w, i) => [w.question_id, i]));
          data.sort(
            (a, b) =>
              (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER)
          );
        } else if (mode === "starred_only") {
          if (!starredIds.size) {
            if (!cancelled) {
              setQuestions([]);
              setLoading(false);
            }
            return;
          }

          const ids = [...starredIds];
          const res = await fetch(`/api/questions?questionIds=${ids.join(",")}`);
          if (!res.ok) throw new Error("Failed to load questions");
          data = await res.json();

          const orderMap = new Map(
            (starredData?.starred_questions ?? []).map((s, i) => [
              s.question_id,
              i,
            ])
          );
          data.sort(
            (a, b) =>
              (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER)
          );
        } else {
          const [res, statsRes] = await Promise.all([
            fetch(`/api/questions?categoryId=${categoryId}`),
            fetch(`/api/categories/${categoryId}/question-stats`),
          ]);

          if (!res.ok) throw new Error("Failed to load questions");

          let stats = [];
          if (statsRes.ok) stats = await statsRes.json();

          data = await res.json();

          const statsMap = new Map(
            stats.map((s) => [
              s.question_id,
              { wrong: s.wrong_count, attempts: s.total_attempts },
            ])
          );

          const rankTier = (q) => {
            const s = statsMap.get(q.id) ?? { wrong: 0, attempts: 0 };
            if (s.wrong > 0) return 0;
            if (s.attempts === 0) return 1;
            return 2;
          };

          data.sort((a, b) => {
            const ta = rankTier(a);
            const tb = rankTier(b);
            if (ta !== tb) return ta - tb;
            if (ta === 0) {
              return (
                (statsMap.get(b.id)?.wrong ?? 0) -
                (statsMap.get(a.id)?.wrong ?? 0)
              );
            }
            return a.id - b.id;
          });
        }

        if (!cancelled) {
          setStarred(starredIds);
          setQuestions(data);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [categoryId, mode, attemptId]);

  const current = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;

  const progress = useMemo(() => {
    if (!questions.length) return 0;
    return ((currentIndex + 1) / questions.length) * 100;
  }, [currentIndex, questions.length]);

  async function selectOption(questionId, optionId) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setSaving(true);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          selected_option_id: optionId,
        }),
      });
      if (!res.ok) throw new Error("Failed to save answer");
    } catch {
      // Keep the local selection; the user can retry by clicking again.
    } finally {
      setSaving(false);
    }
  }

  async function toggleStar(questionId) {
    const wasStarred = starred.has(questionId);
    setStarred((prev) => {
      const next = new Set(prev);
      if (wasStarred) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });

    try {
      const res = await fetch(`/api/questions/${questionId}/star`, {
        method: wasStarred ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error("Failed to update star");
    } catch {
      setStarred((prev) => {
        const next = new Set(prev);
        if (wasStarred) {
          next.add(questionId);
        } else {
          next.delete(questionId);
        }
        return next;
      });
    }
  }

  async function submitTest() {
    if (!attemptId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/finish`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to finish test");
      }
      navigate(`/results/${attemptId}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <BackButton />
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <BackButton />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <BackButton />
        <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center text-ink/50 shadow-card">
          No questions to show in this mode.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <BackButton />
      {mode === "wrong_only" && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-900">
          Practice Mode: Previously Wrong Questions
        </div>
      )}
      {mode === "starred_only" && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-900">
          Review Mode: Starred Questions
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-ink/55">
        <span>
          Question {currentIndex + 1} of {questions.length}
        </span>
        <span>
          {answeredCount}/{questions.length} answered
        </span>
      </div>

      <div className="mb-6 h-2 overflow-hidden rounded-full bg-ink/10">
        <motion.div
          className="h-full rounded-full bg-emerald-500"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      <motion.div
        key={current.id}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold leading-relaxed text-ink">
            {current.question_text}
          </h2>
          <StarIcon
            starred={starred.has(current.id)}
            onToggle={() => toggleStar(current.id)}
            size={24}
          />
        </div>

        {current.image_url && (
          <img
            src={current.image_url}
            alt=""
            className="mt-4 max-h-64 w-full rounded-lg object-contain bg-stone-50"
          />
        )}

        <div className="mt-6 space-y-2">
          {current.options.map((opt, i) => {
            const isSelected = answers[current.id] === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => selectOption(current.id, opt.id)}
                className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition-all ${
                  isSelected
                    ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                    : "border-ink/10 bg-white text-ink/75 hover:border-ink/25 hover:bg-stone-50"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isSelected
                      ? "bg-emerald-600 text-white"
                      : "bg-stone-100 text-ink/50"
                  }`}
                >
                  {["A", "B", "C", "D"][i]}
                </span>
                {opt.option_text}
              </button>
            );
          })}
        </div>
      </motion.div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="rounded-xl px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100 disabled:opacity-40"
        >
          ← Previous
        </button>

        {currentIndex === questions.length - 1 ? (
          <button
            onClick={submitTest}
            disabled={submitting}
            className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Test"}
          </button>
        ) : (
          <button
            onClick={() =>
              setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
            }
            className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Next →
          </button>
        )}
      </div>

      <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-5 shadow-card">
        <p className="mb-3 text-sm font-semibold text-ink/70">
          Question Palette{" "}
          {saving && (
            <span className="ml-1 text-xs font-normal text-ink/40">
              (saving…)
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, i) => {
            const answered = answers[q.id] != null;
            const isCurrent = i === currentIndex;
            const isStarred = starred.has(q.id);
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(i)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold transition-colors sm:h-10 sm:w-10 ${
                  isCurrent
                    ? "ring-2 ring-emerald-600 ring-offset-2 ring-offset-white"
                    : ""
                } ${
                  answered
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-stone-100 text-ink/55 hover:bg-stone-200"
                }`}
              >
                {i + 1}
                {isStarred && (
                  <span
                    className="absolute -right-1 -top-1 text-[10px] text-amber-500"
                    aria-hidden="true"
                  >
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}