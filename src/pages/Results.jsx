import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import LoadingSkeleton from "../components/LoadingSkeleton";
import BackButton from "../components/BackButton";
import StarIcon from "../components/StarIcon";
import FlagIcon from "../components/FlagIcon";
import FlagModal from "../components/FlagModal";
import DifficultyChips from "../components/DifficultyChips";
import QuizTimerModal from "../components/QuizTimerModal";
import {
  fetchQuestionMeta,
  fileFlag,
  withdrawFlag,
  setDifficulty as saveDifficulty,
  clearDifficulty as removeDifficulty,
} from "../lib/questionMeta";

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
  const [starred, setStarred] = useState(new Set());
  const [flaggedMap, setFlaggedMap] = useState({});
  const [difficultyMap, setDifficultyMap] = useState({});
  const [flagTarget, setFlagTarget] = useState(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retaking, setRetaking] = useState(false);
  const [retakeTimerOpen, setRetakeTimerOpen] = useState(false);

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
        let starredIds = new Set();
        if (body.attempt?.category_id) {
          const [statsRes, starredRes] = await Promise.all([
            fetch(
              `/api/categories/${body.attempt.category_id}/question-stats?excludeAttemptId=${attemptId}`
            ).catch(() => null),
            fetch(
              `/api/categories/${body.attempt.category_id}/starred-questions`
            ).catch(() => null),
          ]);

          if (statsRes && statsRes.ok) {
            const questionStats = await statsRes.json();
            statsMap = Object.fromEntries(
              questionStats.map((s) => [Number(s.question_id), s.wrong_count])
            );
          }

          if (starredRes && starredRes.ok) {
            const starredData = await starredRes.json();
            starredIds = new Set(
              (starredData.starred_questions ?? []).map((s) => s.question_id)
            );
          }
        }

        // My own flag / difficulty for each answered question. A failure here
        // must not break the results screen.
        let meta = {};
        try {
          meta = await fetchQuestionMeta((body.answers ?? []).map((a) => a.question_id));
        } catch {
          // ignore - flags/difficulty are an enhancement to the review screen
        }

        if (!cancelled) {
          setData(body);
          setStats(statsMap);
          setStarred(starredIds);
          setFlaggedMap(
            Object.fromEntries(
              Object.entries(meta)
                .filter(([, m]) => m.flagged)
                .map(([id, m]) => [id, m.flag])
            )
          );
          setDifficultyMap(
            Object.fromEntries(
              Object.entries(meta)
                .filter(([, m]) => m.difficulty)
                .map(([id, m]) => [id, m.difficulty])
            )
          );
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

  function openFlag(questionId) {
    setFlagError(null);
    setFlagTarget(questionId);
  }

  async function submitFlag(reason, comment) {
    if (flagTarget == null) return;
    setFlagBusy(true);
    setFlagError(null);
    try {
      const row = await fileFlag(flagTarget, reason, comment);
      setFlaggedMap((prev) => ({
        ...prev,
        [flagTarget]: { reason: row.reason, comment: row.comment, status: row.status },
      }));
      setFlagTarget(null);
    } catch (err) {
      setFlagError(err.message);
    } finally {
      setFlagBusy(false);
    }
  }

  async function withdrawMyFlag() {
    if (flagTarget == null) return;
    setFlagBusy(true);
    setFlagError(null);
    try {
      await withdrawFlag(flagTarget);
      setFlaggedMap((prev) => {
        const next = { ...prev };
        delete next[flagTarget];
        return next;
      });
      setFlagTarget(null);
    } catch (err) {
      setFlagError(err.message);
    } finally {
      setFlagBusy(false);
    }
  }

  // Optimistic, reverts on failure, same pattern as the star toggle.
  async function changeDifficulty(questionId, next) {
    const prev = difficultyMap[questionId] ?? null;
    if (prev === next) return;
    setDifficultyMap((map) => ({ ...map, [questionId]: next }));
    try {
      if (next === null) await removeDifficulty(questionId);
      else await saveDifficulty(questionId, next);
    } catch {
      setDifficultyMap((map) => ({ ...map, [questionId]: prev }));
    }
  }

  async function handleRetake(timerSeconds) {
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
      const timerQuery = timerSeconds ? `&timer=${timerSeconds}` : "";
      navigate(
        `/quiz/${data.attempt.category_id}?attemptId=${attempt.id}&mode=${data.attempt.mode}${timerQuery}`
      );
    } catch (err) {
      setError(err.message);
      setRetaking(false);
    }
  }

  // Same optional timer as the mode buttons on the category page.
  function handleRetakeTimerStart(timerSeconds) {
    setRetakeTimerOpen(false);
    handleRetake(timerSeconds);
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
        className="accent-card accent-sage rounded-2xl border p-8 text-center"
      >
        <p className="label-caps text-ink/40">
          Your Score
        </p>
        <p className="stat-num mt-3 font-display text-6xl text-ink">
          {attempt.score}
          <span className="text-3xl font-normal text-ink/35">
            {" "}
            / {attempt.total_questions}
          </span>
        </p>

        <div className="progress-track mx-auto mt-5 h-3 w-full max-w-xs">
          <motion.div
            className="progress-fill h-full"
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          />
        </div>

        <p className="stat-num mt-2 font-display text-2xl text-ink">
          {percentage}%
        </p>

        <div className="mx-auto mt-6 grid max-w-sm grid-cols-3 gap-4">
          <div className="stat-block px-4 py-3">
            <p className="stat-num text-2xl text-ink">
              {correctCount}
            </p>
            <p className="label-caps mt-1 text-ink/45">
              Correct
            </p>
          </div>
          <div className="stat-block px-4 py-3">
            <p className="stat-num text-2xl text-ink">{wrongCount}</p>
            <p className="label-caps mt-1 text-ink/45">
              Wrong
            </p>
          </div>
          <div className="stat-block px-4 py-3">
            <p className="stat-num text-2xl text-ink">
              {timeTaken ?? "—"}
            </p>
            <p className="label-caps mt-1 text-ink/45">
              Time Taken
            </p>
          </div>
        </div>
      </motion.div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Question Review</h2>
        <button
          onClick={() => setRetakeTimerOpen(true)}
          disabled={retaking}
          className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
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
            className={`answer-card p-5 ${
              ans.is_correct ? "is-correct" : "is-wrong"
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
              <div className="flex shrink-0 items-center gap-1">
                <FlagIcon
                  flagged={Boolean(flaggedMap[ans.question_id])}
                  onToggle={() => openFlag(ans.question_id)}
                  size={20}
                />
                <StarIcon
                  starred={starred.has(ans.question_id)}
                  onToggle={() => toggleStar(ans.question_id)}
                  size={20}
                />
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    ans.is_correct
                      ? "badge-correct"
                      : "badge-wrong"
                  }`}
                >
                  {ans.is_correct ? "Correct" : "Wrong"}
                </span>
              </div>
            </div>

            <DifficultyChips
              className="mt-3"
              value={difficultyMap[ans.question_id] ?? null}
              onSet={(level) => changeDifficulty(ans.question_id, level)}
              onClear={() => changeDifficulty(ans.question_id, null)}
            />

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
                      ? "font-semibold text-correct"
                      : "font-semibold text-wrong"
                  }
                >
                  {ans.selected_option_text ?? "—"}
                </span>
              </p>
              {!ans.is_correct && (
                <p>
                  <span className="text-ink/50">Correct answer: </span>
                  <span className="font-semibold text-correct">
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
          onClick={() => setRetakeTimerOpen(true)}
          disabled={retaking}
          className="rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {retaking ? "Starting…" : "Retake This Test"}
        </button>
      </div>

      <QuizTimerModal
        open={retakeTimerOpen}
        onClose={() => setRetakeTimerOpen(false)}
        onStart={handleRetakeTimerStart}
      />

      <FlagModal
        open={flagTarget !== null}
        existing={flagTarget != null ? flaggedMap[flagTarget] ?? null : null}
        onClose={() => setFlagTarget(null)}
        onSubmit={submitFlag}
        onWithdraw={withdrawMyFlag}
        busy={flagBusy}
        error={flagError}
      />
    </div>
  );
}
