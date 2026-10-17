import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSkeleton from "../../../components/LoadingSkeleton";
import Icon from "../../../components/Icon";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import useStartSession from "../hooks/useStartSession";
import { getStats, listCategories, listFolders, updateSettings } from "../lib/api";
import { formatDuration } from "../lib/format";
import FlashBreadcrumbs from "../components/FlashBreadcrumbs";
import { ErrorState } from "../components/FlashStates";
import Heatmap from "../components/charts/Heatmap";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import DonutChart from "../components/charts/DonutChart";
import StatTile from "../components/stats/StatTile";
import StatsFilters from "../components/stats/StatsFilters";
import HardestCardsTable from "../components/stats/HardestCardsTable";

// /flash/stats - the study dashboard.
//
// Everything comes from one GET /api/flash/stats call (fc_review_logs +
// fc_card_state), filtered by folder and/or category. Charts are hand-rolled
// SVG (no chart library), driven by the pure helpers in lib/statsModel.js.

const STATE_COLORS = {
  New: "var(--color-lavender-soft)",
  Learning: "var(--color-butter)",
  Review: "var(--color-lavender)",
  Mastered: "var(--color-sage)",
};

function pct(rate) {
  return typeof rate === "number" ? `${Math.round(rate * 100)}%` : "—";
}

function shortDay(date) {
  return date ? date.slice(8, 10) : "";
}

function scopePayload(folderId, categoryId) {
  if (categoryId != null) return { scope_type: "category", scope_id: categoryId };
  if (folderId != null) return { scope_type: "folder", scope_id: folderId };
  return { scope_type: "all" };
}

export default function StatsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [folders, setFolders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [folderId, setFolderId] = useState(null);
  const [categoryId, setCategoryId] = useState(null);
  const [days, setDays] = useState(30);

  const [goalDraft, setGoalDraft] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [studyBusy, setStudyBusy] = useState(false);

  const { toasts, notify, dismiss } = useToast();
  const startStudySession = useStartSession(notify);

  useEffect(() => {
    listFolders().then(setFolders).catch(() => {});
  }, []);

  useEffect(() => {
    if (folderId == null) return undefined;
    let cancelled = false;
    listCategories(folderId)
      .then((rows) => {
        if (!cancelled) setCategories(rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await getStats({ folderId, categoryId, days });
      setData(payload);
      setGoalDraft(payload.daily_goal ? String(payload.daily_goal) : "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [folderId, categoryId, days]);

  useEffect(() => {
    load();
  }, [load]);

  function handleFolder(next) {
    setFolderId(next);
    setCategoryId(null);
    setCategories([]);
  }

  async function saveGoal() {
    const value = Number(goalDraft);
    if (!Number.isInteger(value) || value < 1) {
      notify("Enter a whole number of at least 1.", "error");
      return;
    }
    setSavingGoal(true);
    try {
      const result = await updateSettings({ daily_goal: value });
      const saved = Number(result?.settings?.daily_goal) || value;
      setData((prev) => (prev ? { ...prev, daily_goal: saved } : prev));
      setGoalDraft(String(saved));
      notify("Daily goal updated.");
    } catch (err) {
      notify(err.message ?? "Could not save the goal", "error");
    } finally {
      setSavingGoal(false);
    }
  }

  async function studyNow() {
    if (studyBusy) return;
    setStudyBusy(true);
    try {
      await startStudySession({ ...scopePayload(folderId, categoryId), mode: "struggle" });
    } finally {
      setStudyBusy(false);
    }
  }

  const heatmap = data?.heatmap;
  const retention = data?.retention;
  const forecast = data?.due_forecast;
  const states = data?.states;
  const trend = data?.think_trend;
  const goal = Number(data?.daily_goal) || 0;
  const reviewsToday = useMemo(() => {
    if (!heatmap?.cells) return 0;
    const cell = heatmap.cells.find((c) => c.date === heatmap.end);
    return cell?.count ?? 0;
  }, [heatmap]);
  const goalPct = goal > 0 ? Math.min(100, Math.round((reviewsToday / goal) * 100)) : 0;

  const forecastData = useMemo(
    () => (forecast?.days ?? []).map((d) => ({ label: shortDay(d.date), value: d.count })),
    [forecast]
  );
  const trendData = useMemo(
    () => (trend?.days ?? []).map((d) => ({ label: shortDay(d.date), value: d.avg_ms })),
    [trend]
  );
  const stateSegments = useMemo(() => {
    if (!states) return [];
    return [
      { label: "New", value: states.new, color: STATE_COLORS.New },
      { label: "Learning", value: states.learning, color: STATE_COLORS.Learning },
      { label: "Review", value: states.review, color: STATE_COLORS.Review },
      { label: "Mastered", value: states.mastered, color: STATE_COLORS.Mastered },
    ];
  }, [states]);

  const mature = retention?.mature;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <FlashBreadcrumbs items={[{ label: "Flash Cards", to: "/flash" }, { label: "Stats" }]} />

      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Stats
        </h1>
        <p className="mt-2 text-ink/55">
          Reviews, retention and the cards that need the most work.
        </p>
      </div>

      <StatsFilters
        folders={folders}
        categories={categories}
        folderId={folderId}
        categoryId={categoryId}
        days={days}
        disabled={loading}
        onFolder={handleFolder}
        onCategory={setCategoryId}
        onDays={setDays}
      />

      <div className="mt-6">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <div className="space-y-6">
            {/* Headline numbers */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile
                label="Current streak"
                value={`${heatmap?.current_streak ?? 0}d`}
                hint={`longest ${heatmap?.longest_streak ?? 0} days`}
                icon="flame"
                tone={(heatmap?.current_streak ?? 0) > 0 ? "warn" : "default"}
              />
              <StatTile
                label="True retention"
                value={pct(mature?.rate)}
                hint={
                  mature && mature.total > 0
                    ? `${mature.correct}/${mature.total} mature reviews`
                    : "no mature reviews yet"
                }
                tone={mature?.rate >= 0.9 ? "good" : mature?.rate != null ? "warn" : "default"}
              />
              <StatTile
                label="Due · next 30d"
                value={forecast?.total ?? 0}
                hint={`${forecast?.overdue ?? 0} overdue`}
                icon="calendar"
              />
              <StatTile
                label="Cards tracked"
                value={states?.total ?? 0}
                hint={`${states?.mastered ?? 0} mastered`}
                icon="layers"
              />
            </div>

            {/* Daily goal */}
            <section className="answer-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="label-caps">Daily goal</p>
                  <p className="mt-1 text-sm text-ink/60">
                    <strong className="font-semibold text-ink">{reviewsToday}</strong> of{" "}
                    <strong className="font-semibold text-ink">{goal || "—"}</strong> reviews today
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-ink/50" htmlFor="daily-goal">
                    Goal
                  </label>
                  <input
                    id="daily-goal"
                    type="number"
                    min="1"
                    max="1000"
                    value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value)}
                    className="w-24 rounded-xl border border-ink/15 bg-elevated px-3 py-2 text-sm text-ink outline-none focus:border-lavender"
                  />
                  <button
                    type="button"
                    onClick={saveGoal}
                    disabled={savingGoal}
                    className="rounded-xl bg-lavender px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-60"
                  >
                    {savingGoal ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              <div className="progress-track mt-4 h-2.5 w-full">
                <div className="progress-fill h-full" style={{ width: `${goalPct}%` }} />
              </div>
            </section>

            {/* Heatmap */}
            <section className="answer-card p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">Reviews per day</h2>
                <p className="inline-flex flex-wrap items-center gap-x-1.5 text-sm text-ink/50">
                  {heatmap?.total ?? 0} reviews in the last year ·
                  <Icon name="flame" size={14} className="text-orange-500" />
                  {heatmap?.current_streak ?? 0}-day streak
                </p>
              </div>
              <Heatmap weeks={heatmap?.weeks ?? []} max={heatmap?.max ?? 0} />
            </section>

            {/* Forecast + states */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="answer-card p-5">
                <h2 className="mb-4 text-lg font-semibold text-ink">Due forecast · 30 days</h2>
                <BarChart
                  data={forecastData}
                  color="var(--color-lavender)"
                  labelEvery={5}
                  ariaLabel="Cards due over the next 30 days"
                />
              </section>

              <section className="answer-card p-5">
                <h2 className="mb-4 text-lg font-semibold text-ink">Cards by state</h2>
                <DonutChart
                  segments={stateSegments}
                  centerValue={states?.total ?? 0}
                  centerLabel="cards"
                  ariaLabel="Cards by scheduler state"
                />
              </section>
            </div>

            {/* Think time */}
            <section className="answer-card p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">Average think time</h2>
                <p className="text-sm text-ink/50">
                  last {data?.range_days ?? days} days
                  {trend?.average_ms ? ` · average ${formatDuration(trend.average_ms)}` : ""}
                </p>
              </div>
              <LineChart
                data={trendData}
                color="var(--color-sage)"
                labelEvery={Math.max(1, Math.round(trendData.length / 6))}
                formatValue={(ms) => (ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`)}
                ariaLabel="Average think time per day"
              />
            </section>

            {/* Hardest cards */}
            <section className="answer-card p-5">
              <h2 className="mb-4 text-lg font-semibold text-ink">Hardest cards</h2>
              <HardestCardsTable cards={data?.hardest ?? []} onStudyNow={studyNow} busy={studyBusy} />
            </section>
          </div>
        )}
      </div>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
