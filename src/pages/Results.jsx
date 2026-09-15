import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import LoadingSkeleton from "../components/LoadingSkeleton";
import BackButton from "../components/BackButton";

function formatTime(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt) - new Date(startedAt);
  if (ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

export default function Results() {
  const { attemptId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retaking, setRetaking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/attempts/${attemptId}/results`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("Attempt not found");
          throw new Error("Failed to load results");
        }
        const body = await res.json();

        let statsMap = {};
        if (body.attempt?.category_id) {
          const statsRes = await fetch(
            `/api/categories/${body.attempt.category_id}/question-stats?excludeAttemptId=${attemptId}`
          ).catch(() => null);

          if (statsRes && statsRes.ok) {
            const questionStats = await statsRes.json();
            statsMap = Object.fromEntries(
              questionStats.map((s) => [Number(s.question_id), s.wrong_count])
            );
          }
        }

        if (!cancelled) {
          setData(body);
          setStats(statsMap);
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
  }, [attemptId]);

  async function handleRetake() {
    if (!data?.attempt) return;
    setRetaking(true);
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: data.attempt.category_id,
          mode: data.attempt.mode,
        }),
      });
      if (!res.ok) throw new Error("Failed to start new attempt");
      const attempt = await res.json();
      navigate(
        `/quiz/${data.attempt.category_id}?attemptId=${attempt.id}&mode=${data.attempt.mode}`
      );
    } catch (err) {
      setError(err.message);
      setRetaking(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <BackButton />
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <BackButton />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { attempt, answers } = data;
  const percentage =
    attempt.total_questions > 0
      ? Math.round((attempt.score / attempt.total_questions) * 100)
      : 0;
  const correctCount = attempt.score ?? 0;
  const wrongCount = attempt.total_questions - correctCount;
  const timeTaken = formatTime(attempt.started_at, attempt.finished_at);

  const sorted = [...answers].sort((a, b) => {
    if (a.is_correct === b.is_correct) return 0;
    return a.is_correct ? 1 : -1;
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <BackButton />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="rounded-2xl border border-ink/10 bg-white p-8 text-center shadow-card"
      >
        <p className="text-sm font-medium uppercase tracking-widest text-ink/40">
          Your Score
        </p>
        <p className="mt-3 font-display text-6xl font-semibold tracking-tight text-ink">
          {attempt.score}
          <span className="text-3xl font-normal text-ink/35">
            {" "}
            / {attempt.total_questions}
          </span>
        </p>

        <div className="mx-auto mt-5 h-3 w-full max-w-xs overflow-hidden rounded-full bg-ink/10">
          <motion.div
            className={`h-full rounded-full ${
              percentage >= 70
                ? "bg-emerald-500"
                : percentage >= 40
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          />
        </div>

        <p className="mt-2 font-display text-2xl font-semibold text-ink">
          {percentage}%
        </p>

        <div className="mx-auto mt-6 grid max-w-sm grid-cols-3 gap-4">
          <div className="rounded-xl bg-emerald-50 px-4 py-3">
            <p className="text-2xl font-semibold text-emerald-700">
              {correctCount}
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">
              Correct
            </p>
          </div>
          <div className="rounded-xl bg-red-50 px-4 py-3">
            <p className="text-2xl font-semibold text-red-600">{wrongCount}</p>
            <p className="text-xs font-medium uppercase tracking-wide text-red-500">
              Wrong
            </p>
          </div>
          <div className="rounded-xl bg-stone-100 px-4 py-3">
            <p className="text-2xl font-semibold text-ink">
              {timeTaken ?? "—"}
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-ink/45">
              Time Taken
            </p>
          </div>
        </div>
      </motion.div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Question Review</h2>
        <button
          onClick={handleRetake}
          disabled={retaking}
          className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {retaking ? "Starting…" : "Retake This Test"}
        </button>
      </div>

      <motion.div
        className="mt-4 space-y-3"
        variants={listVariants}
        initial="hidden"
        animate="visible"
      >
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink/15 bg-white/40 p-10 text-center text-sm text-ink/55">
            No answers were recorded for this attempt.
          </div>
        ) : (
          sorted.map((ans) => (
          <motion.div
            key={ans.answer_id}
            variants={itemVariants}
            className={`rounded-xl border bg-white p-5 shadow-card ${
              ans.is_correct
                ? "border-ink/10"
                : "border-l-4 border-l-red-500 border-t-red-200 border-r-red-200 border-b-red-200"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium leading-relaxed text-ink">
                  {ans.question_text}
                </p>
                {stats[ans.question_id] > 0 && (
                  <p className="mt-1.5 text-xs font-semibold text-amber-700">
                    Wrong {stats[ans.question_id]}{" "}
                    {stats[ans.question_id] === 1 ? "time" : "times"} before
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  ans.is_correct
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-600"
                }`}
              >
                {ans.is_correct ? "Correct" : "Wrong"}
              </span>
            </div>

            {ans.image_url && (
              <img
                src={ans.image_url}
                alt=""
                className="mt-3 max-h-48 rounded-lg object-contain bg-stone-50"
              />
            )}

            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-ink/50">Your answer: </span>
                <span
                  className={
                    ans.is_correct
                      ? "font-semibold text-emerald-700"
                      : "font-semibold text-red-600"
                  }
                >
                  {ans.selected_option_text ?? "—"}
                </span>
              </p>
              {!ans.is_correct && (
                <p>
                  <span className="text-ink/50">Correct answer: </span>
                  <span className="font-semibold text-emerald-700">
                    {ans.correct_option_text}
                  </span>
                </p>
              )}
            </div>

            {ans.explanation && (
              <p className="mt-3 rounded-lg bg-stone-100 p-3 text-sm leading-relaxed text-ink/65">
                {ans.explanation}
              </p>
            )}
          </motion.div>
          ))
        )}
      </motion.div>

      <div className="mt-10 text-center">
        <button
          onClick={handleRetake}
          disabled={retaking}
          className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {retaking ? "Starting…" : "Retake This Test"}
        </button>
      </div>
    </div>
  );
}