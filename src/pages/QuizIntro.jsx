import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import LoadingSkeleton from "../components/LoadingSkeleton";

function TrendBars({ attempts, label, color }) {
  if (!attempts.length) {
    return (
      <div>
        <p className="text-sm font-semibold text-ink/70">{label}</p>
        <p className="mt-2 text-xs text-ink/40">
          No completed {label.toLowerCase()} yet.
        </p>
      </div>
    );
  }

  const bars = [...attempts].slice(0, 5).reverse();

  return (
    <div>
      <p className="text-sm font-semibold text-ink/70">{label}</p>
      <div className="mt-2 flex h-16 items-end gap-2">
        {bars.map((a) => {
          const pct =
            a.total_questions > 0
              ? Math.round((a.score / a.total_questions) * 100)
              : 0;
          return (
            <div key={a.id} className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium text-ink/40">{pct}</span>
              <div
                className={`w-6 rounded ${color}`}
                style={{ height: `${Math.max(8, pct)}%` }}
                title={`${a.score}/${a.total_questions}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function QuizIntro() {
  const { categoryId } = useParams();
  const navigate = useNavigate();

  const [category, setCategory] = useState(null);
  const [wrongQuestions, setWrongQuestions] = useState([]);
  const [starredCount, setStarredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [catRes, wrongRes, starredRes] = await Promise.all([
          fetch(`/api/categories/${categoryId}`),
          fetch(`/api/categories/${categoryId}/wrong-questions`),
          fetch(`/api/categories/${categoryId}/starred-questions`),
        ]);

        if (!catRes.ok) throw new Error("Category not found");
        if (!wrongRes.ok) throw new Error("Failed to load wrong questions");

        const [catData, wrongData, starredData] = await Promise.all([
          catRes.json(),
          wrongRes.json(),
          starredRes.ok ? starredRes.json() : null,
        ]);

        if (cancelled) return;
        setCategory(catData);
        setWrongQuestions(wrongData);
        setStarredCount(starredData?.count ?? 0);
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
  }, [categoryId]);

  async function startQuiz(mode) {
    setStarting(mode);
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: Number(categoryId),
          mode,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to start quiz");
      }

      const attempt = await res.json();
      navigate(`/quiz/${categoryId}?attemptId=${attempt.id}&mode=${mode}`);
    } catch (err) {
      setError(err.message);
      setStarting(null);
    }
  }

  const wrongCount = wrongQuestions.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        to={category?.subject_id ? `/subject/${category.subject_id}` : "/"}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition-colors hover:text-ink"
      >
        ← Back to Categories
      </Link>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        category && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-ink/10 bg-white p-8 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
                    {category.name}
                  </h1>
                  {category.description && (
                    <p className="mt-2 text-ink/55">{category.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link
                    to={`/admin/questions?subject=${category.subject_id}&category=${categoryId}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 bg-stone-100 px-4 py-2 text-sm font-semibold text-ink/80 transition hover:bg-ink/10"
                  >
                    Manage Questions
                  </Link>
                  <Link
                    to={`/admin/upload?subject=${category.subject_id}&category=${categoryId}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 bg-stone-100 px-4 py-2 text-sm font-semibold text-ink/80 transition hover:bg-ink/10"
                  >
                    ＋ Add Question
                  </Link>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-stone-100 p-4 text-center">
                  <p className="text-3xl font-semibold text-ink">
                    {category.question_count}
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink/45">
                    Questions
                  </p>
                </div>
                <div className="rounded-xl bg-stone-100 p-4 text-center">
                  <p className="text-3xl font-semibold text-ink">
                    {category.attempt_count}
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink/45">
                    Attempts
                  </p>
                </div>
                <div className="col-span-2 rounded-xl bg-stone-100 p-4 text-center sm:col-span-1">
                  <p className="text-3xl font-semibold text-emerald-600">
                    {category.best_score ?? "—"}
                    {category.best_score != null && (
                      <span className="text-lg text-ink/35">
                        {" "}
                        / {category.question_count}
                      </span>
                    )}
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink/45">
                    Best Score
                  </p>
                </div>
              </div>
            </motion.div>

            {category.question_count === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      No questions in this category yet
                    </p>
                    <p className="mt-1 text-amber-800/70">
                      Add one below, or upload several at once from the bulk CSV
                      tab.
                    </p>
                  </div>
                  <Link
                    to={`/admin/upload?subject=${category.subject_id}&category=${categoryId}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
                  >
                    ＋ Add Question
                  </Link>
                </div>
              </motion.div>
            )}

            {(category.recent_attempts?.length ?? 0) > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 rounded-2xl border border-ink/10 bg-white p-6 shadow-card"
              >
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-ink/45">
                  Accuracy Trend
                </h2>
                <div className="grid gap-6 sm:grid-cols-2">
                  <TrendBars
                    attempts={(category.recent_attempts ?? []).filter(
                      (a) => a.mode === "full"
                    )}
                    label="Full Tests"
                    color="bg-emerald-500"
                  />
                  <TrendBars
                    attempts={(category.recent_attempts ?? []).filter(
                      (a) => a.mode === "wrong_only"
                    )}
                    label="Practice Sessions"
                    color="bg-amber-500"
                  />
                  <TrendBars
                    attempts={(category.recent_attempts ?? []).filter(
                      (a) => a.mode === "starred_only"
                    )}
                    label="Starred Reviews"
                    color="bg-sky-500"
                  />
                </div>
              </motion.div>
            )}

            <div className="mt-8">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-ink/45">
                Choose a mode
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <motion.button
                  whileHover={{ y: -6 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  onClick={() => startQuiz("full")}
                  disabled={starting !== null || category.question_count === 0}
                  className="rounded-2xl border border-ink/10 bg-emerald-600 p-6 text-left text-white shadow-card transition-all hover:bg-emerald-700 hover:shadow-card-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-xl font-semibold">Start Full Test</p>
                  <p className="mt-1 text-sm text-emerald-100">
                    {category.question_count === 0
                      ? "Add questions first to start."
                      : `All ${category.question_count} questions in this category.`}
                  </p>
                  <p className="mt-4 text-sm font-semibold text-emerald-50">
                    {starting === "full" ? "Starting..." : "Begin →"}
                  </p>
                </motion.button>

                <motion.div
                  whileHover={
                    wrongCount > 0 && starting === null ? { y: -6 } : {}
                  }
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                >
                  <button
                    onClick={() => startQuiz("wrong_only")}
                    disabled={wrongCount === 0 || starting !== null}
                    className="h-full w-full rounded-2xl border border-ink/10 bg-amber-50 p-6 text-left text-amber-950 shadow-card transition-all hover:shadow-card-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <p className="text-xl font-semibold">
                      Practice Only Wrong Questions
                      {wrongCount > 0 ? ` (${wrongCount})` : ""}
                    </p>
                    <p className="mt-1 text-sm text-amber-800/70">
                      {wrongCount > 0
                        ? `${wrongCount} question${wrongCount === 1 ? "" : "s"} you missed before.`
                        : "No wrong answers yet on this category."}
                    </p>
                    <p className="mt-4 text-sm font-semibold text-amber-800">
                      {wrongCount > 0
                        ? starting === "wrong_only"
                          ? "Starting..."
                          : "Begin →"
                        : ""}
                    </p>
                  </button>
                </motion.div>

                <motion.div
                  whileHover={
                    starredCount > 0 && starting === null ? { y: -6 } : {}
                  }
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="sm:col-span-2"
                >
                  <button
                    onClick={() => startQuiz("starred_only")}
                    disabled={starredCount === 0 || starting !== null}
                    className="w-full rounded-2xl border border-ink/10 bg-sky-50 p-6 text-left text-sky-950 shadow-card transition-all hover:shadow-card-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <p className="text-xl font-semibold">
                      Review Starred Questions
                      {starredCount > 0 ? ` (${starredCount})` : ""}
                    </p>
                    <p className="mt-1 text-sm text-sky-800/70">
                      {starredCount > 0
                        ? starredCount === 1
                          ? "1 question you starred for review."
                          : `${starredCount} questions you starred for review.`
                        : "No starred questions yet. Tap the ☆ on any question to star it for review."}
                    </p>
                    <p className="mt-4 text-sm font-semibold text-sky-800">
                      {starredCount > 0
                        ? starting === "starred_only"
                          ? "Starting..."
                          : "Begin →"
                        : ""}
                    </p>
                  </button>
                </motion.div>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}