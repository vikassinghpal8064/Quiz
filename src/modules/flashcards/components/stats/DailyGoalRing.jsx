import { Link } from "react-router-dom";

// Daily-goal progress on the flash home: a small ring showing reviews answered
// today against the goal, the streak beside it, and a shortcut to the full
// stats page. Pure presentation; the numbers come from /api/flash/stats/overview.

const SIZE = 96;
const STROKE = 9;

function Ring({ progress }) {
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  const offset = circumference * (1 - clamped);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-[96px] w-[96px] shrink-0" role="img" aria-label="Daily goal progress">
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={STROKE}
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        stroke={clamped >= 1 ? "var(--color-sage)" : "var(--color-lavender)"}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}

export default function DailyGoalRing({ overview, loading = false }) {
  const goal = Number(overview?.daily_goal) || 0;
  const reviews = Number(overview?.reviews_today) || 0;
  const progress = goal > 0 ? reviews / goal : 0;
  const pct = goal > 0 ? Math.min(100, Math.round(progress * 100)) : 0;
  const streak = Number(overview?.current_streak) || 0;
  const dueToday = Number(overview?.due_today) || 0;
  const done = goal > 0 && reviews >= goal;

  return (
    <div className="answer-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative flex items-center justify-center">
        <Ring progress={progress} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="stat-num text-2xl text-ink">{loading ? "–" : reviews}</span>
          <span className="text-[10px] uppercase tracking-wide text-ink/40">of {goal || "–"}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="label-caps">Today</p>
        <p className="mt-1 text-lg font-semibold text-ink">
          {loading ? "Loading…" : done ? "Goal reached 🎉" : `${pct}% of your daily goal`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink/55">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true">🔥</span>
            <strong className="font-semibold text-ink">{streak}</strong>
            day{streak === 1 ? "" : "s"} streak
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true">📅</span>
            <strong className="font-semibold text-ink">{dueToday}</strong> due today
          </span>
        </div>
        <Link
          to="/flash/stats"
          className="mt-4 inline-flex text-sm font-semibold text-lavender-soft transition hover:text-lavender"
        >
          View full stats →
        </Link>
      </div>
    </div>
  );
}
