import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import {
  abandonSession,
  dropLastQueuedReview,
  finishSession,
  flushReviews,
  getSession,
  pendingReviewCount,
  postReview,
  subscribeReviewQueue,
} from "../lib/api";
import { RATINGS, previewIntervals } from "../lib/scheduler";
import { cleanSample, createStopwatch } from "../lib/timing";
import { classifySwipe } from "../lib/gestures";
import { formatDuration } from "../lib/format";
import { getCardType } from "../cardTypes/registry";
import FlashBreadcrumbs from "../components/FlashBreadcrumbs";
import { ErrorState } from "../components/FlashStates";

// The full card editor is only needed when a leech is being rewritten, so it is
// kept out of the study screen's initial bundle (same lazy split CategoryPage
// uses).
const CardEditorModal = lazy(() => import("../components/CardEditorModal"));

// /flash/study/:sessionId - run one study sitting.
//
// The queue and the scheduler settings come from the server (GET .../sessions/:id).
// Each answer is recorded server-side (POST /api/flash/reviews), which computes
// and returns the next scheduler state; this screen only turns that into the
// next card. The four rating buttons show the interval the *current* state would
// schedule, using the same pure scheduler the server uses, so the promise on the
// button and the write that follows can never disagree.
//
// Timing: think_ms is measured from the card appearing to the reveal, total_ms
// from appearing to the rating. The clock pauses while the tab is hidden and any
// sample over 120s is discarded as idle (lib/timing.js).
//
// Re-queueing: Again brings a card back a few slots later (at most twice); a
// "shaky" correct answer (Good, but slower than the card-type baseline - the
// server flags it) brings it back once, further down the queue, as an echo. The
// server only moves the FSRS schedule on a card's FIRST rating in a sitting, so
// these repeats are logged without disturbing the due date.
//
// `autoPlay` is handed to the viewer only on reveal, which is what lets an audio
// block with its per-card flag set start playing at the right moment.

const RATING_BUTTONS = [
  { rating: RATINGS.Again, key: "again", label: "Again", hint: "1", className: "border-red-400/40 bg-red-500/15 text-red-100 hover:bg-red-500/25" },
  { rating: RATINGS.Hard, key: "hard", label: "Hard", hint: "2", className: "border-amber-400/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25" },
  { rating: RATINGS.Good, key: "good", label: "Good", hint: "3", className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25" },
  { rating: RATINGS.Easy, key: "easy", label: "Easy", hint: "4", className: "border-sky-400/40 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25" },
];

// Which rating a swipe direction means.
const SWIPE_RATINGS = {
  left: RATINGS.Again,
  right: RATINGS.Good,
  up: RATINGS.Easy,
  down: RATINGS.Hard,
};

// Re-queue tuning. Again brings a card back 3-5 slots later, at most twice per
// card. A shaky-but-correct answer is echoed once, 8-12 slots later.
const AGAIN_REQUEUE_MIN = 3;
const AGAIN_REQUEUE_MAX = 5;
const AGAIN_REQUEUE_LIMIT = 2;
const SHAKY_REQUEUE_MIN = 8;
const SHAKY_REQUEUE_MAX = 12;

// A re-queued card is a second slot for the same card id; each slot needs its
// own stable key so React (and Undo) can tell them apart.
let slotSeq = 0;
function makeKey() {
  slotSeq += 1;
  return `slot-${slotSeq}`;
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// The card-state shape the (pure) scheduler reads, back-filled from a queue row.
function stateFromRow(row) {
  return {
    state: row?.state ?? 0,
    due: row?.due ?? null,
    stability: row?.stability ?? 0,
    difficulty: row?.difficulty ?? 0,
    reps: row?.reps ?? 0,
    lapses: row?.lapses ?? 0,
    last_review: row?.last_review ?? null,
    scheduled_days: 0,
    learning_steps: 0,
    elapsed_days: 0,
  };
}

function backTo(session) {
  if (!session) return "/flash";
  if (session.scope_type === "category") return `/flash/category/${session.scope_id}`;
  if (session.scope_type === "folder") return `/flash/folder/${session.scope_id}`;
  return "/flash";
}

export default function StudyPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { toasts, notify, dismiss } = useToast();

  const [session, setSession] = useState(null);
  const [queue, setQueue] = useState([]);
  const [settings, setSettings] = useState({});
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [summary, setSummary] = useState(null);
  const [queuedCount, setQueuedCount] = useState(pendingReviewCount);
  // Whether "Undo last answer" has anything to undo. Mirrors history.current,
  // kept as state so render never reads a ref (react-hooks/refs).
  const [canUndo, setCanUndo] = useState(false);
  // The card a leech prompt is offering to rewrite (null when there is none).
  const [leechCard, setLeechCard] = useState(null);
  const [leechEditing, setLeechEditing] = useState(false);
  // For a focus session: the builder's pool counts and leftover-due figure,
  // shown on the summary.
  const [focusMeta, setFocusMeta] = useState(null);

  // Timing: how long the question was on screen before the card was revealed
  // (thinkMs) and before it was rated (the stopwatch read at rating time). The
  // stopwatch is created once and reused for every card.
  const stopwatch = useRef(null);
  if (stopwatch.current === null) stopwatch.current = createStopwatch();
  const thinkMs = useRef(null);

  // Undo stack: one snapshot per answer (the card row as it was before the
  // answer, and whether that answer is still sitting in the offline queue).
  const history = useRef([]);

  // Swipe gesture start point (touch devices only).
  const swipeStart = useRef(null);

  const finish = useCallback(async () => {
    try {
      const data = await finishSession(sessionId);
      setSummary(data.summary);
    } catch (err) {
      notify(err?.message ?? "Could not finish the session", "error");
    }
  }, [notify, sessionId]);

  // Deliberately async before its first setState: calling a promise-returning
  // loader from an effect is fine, but a setState that runs synchronously in
  // the effect body would cascade a render (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    try {
      const data = await getSession(sessionId);
      const cards = (data.cards ?? []).map((card) => ({ ...card, _key: makeKey() }));
      setSession(data.session);
      setSettings(data.settings ?? {});
      setQueue(cards);
      history.current = [];
      setCanUndo(false);
      setLeechCard(null);
      setLeechEditing(false);
      setFocusMeta(data.focus ?? null);
      const firstUnreviewed = cards.findIndex((card) => !card.reviewed);
      setIndex(firstUnreviewed === -1 ? cards.length : firstUnreviewed);
      setRevealed(false);
      setError(null);
      setNotFound(false);
      // Resuming a sitting that is already fully answered goes straight to the
      // summary; an empty queue stays on the "nothing to study" state.
      if (cards.length > 0 && firstUnreviewed === -1) finish();
    } catch (err) {
      if (/not found/i.test(err.message)) setNotFound(true);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [finish, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Flush anything left from a previous (offline) sitting, and keep the badge
  // in step with the queue. The count is seeded lazily above (no setState in the
  // effect body); the subscriber callback only fires on a queue change.
  useEffect(() => {
    flushReviews();
    return subscribeReviewQueue((n) => setQueuedCount(n));
  }, []);

  const current = index < queue.length ? queue[index] : null;

  // A fresh card resets the reveal + the clock. Ref access only: no setState.
  useEffect(() => {
    stopwatch.current.start();
    thinkMs.current = null;
  }, [index, sessionId]);

  // Pause the clock while the tab is hidden so a phone call or a background tab
  // does not inflate the answer time.
  useEffect(() => {
    function onVisibility() {
      if (typeof document === "undefined") return;
      if (document.hidden) stopwatch.current.pause();
      else stopwatch.current.resume();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const previews = useMemo(() => {
    if (!current) return null;
    try {
      return previewIntervals(stateFromRow(current), new Date(), settings);
    } catch {
      return null;
    }
  }, [current, settings]);

  const completed = queue.filter((card) => card.reviewed).length;
  const planned = queue.length;
  const remaining = Math.max(0, planned - completed);

  function reload() {
    // Retry lives in an event handler, so resetting state here is expected.
    setLoading(true);
    setError(null);
    setNotFound(false);
    load();
  }

  function reveal() {
    if (!current || revealed) return;
    if (thinkMs.current === null) thinkMs.current = cleanSample(stopwatch.current.read());
    setRevealed(true);
  }

  const answer = useCallback(
    async (rating) => {
      if (!current || !revealed || busy) return;
      setBusy(true);
      const total = cleanSample(stopwatch.current.read());
      stopwatch.current.pause();
      const indexAt = index;
      const cardBefore = current;
      try {
        const result = await postReview({
          session_id: sessionId,
          card_id: current.id,
          rating,
          think_ms: thinkMs.current,
          total_ms: total,
          // A re-queued slot is a repeat: tell the server so it logs an echo and
          // leaves the schedule where the first rating put it.
          is_echo: Boolean(cardBefore._isEcho),
        });

        const againCount = cardBefore._againCount ?? 0;

        // Decide whether this answer earns a repeat slot further down the queue.
        let offset = 0;
        let requeue = null;
        if (rating === RATINGS.Again && againCount < AGAIN_REQUEUE_LIMIT) {
          offset = randomBetween(AGAIN_REQUEUE_MIN, AGAIN_REQUEUE_MAX);
          requeue = "again";
        } else if (result.shaky && !cardBefore._shakyDone) {
          offset = randomBetween(SHAKY_REQUEUE_MIN, SHAKY_REQUEUE_MAX);
          requeue = "echo";
        }

        const answered = {
          ...cardBefore,
          reviewed: true,
          last_rating: rating,
          state: result.state?.state ?? cardBefore.state,
          due: result.state?.due ?? cardBefore.due,
          stability: result.state?.stability ?? cardBefore.stability,
          difficulty: result.state?.difficulty ?? cardBefore.difficulty,
          reps: result.state?.reps ?? cardBefore.reps,
          lapses: result.state?.lapses ?? cardBefore.lapses,
          struggle_score:
            typeof result.struggle_score === "number"
              ? result.struggle_score
              : cardBefore.struggle_score,
          _againCount: requeue === "again" ? againCount + 1 : againCount,
          _shakyDone: Boolean(cardBefore._shakyDone || result.shaky),
        };

        const nextQueue = queue.map((card, i) => (i === indexAt ? answered : card));

        let insertedKey = null;
        if (requeue) {
          const slot = {
            ...cardBefore,
            reviewed: false,
            _key: makeKey(),
            _isEcho: true,
            _againCount: answered._againCount,
            _shakyDone: answered._shakyDone,
            _requeue: requeue,
          };
          const at = Math.min(indexAt + offset + 1, nextQueue.length);
          nextQueue.splice(at, 0, slot);
          insertedKey = slot._key;
        }

        history.current.push({
          index: indexAt,
          card: cardBefore,
          queued: Boolean(result.queued),
          insertedKey,
        });
        setCanUndo(true);
        setQueue(nextQueue);
        if (result.queued) notify("Saved offline — it will sync when you reconnect.");
        if (result.leech) setLeechCard(cardBefore);
        setRevealed(false);

        const next = nextQueue.findIndex((card, i) => i > indexAt && !card.reviewed);
        setIndex(next === -1 ? nextQueue.length : next);
        // Answering the last outstanding card closes the sitting.
        if (next === -1) finish();
      } catch (err) {
        notify(err?.message ?? "Could not record the answer", "error");
      } finally {
        setBusy(false);
      }
    },
    [busy, current, finish, index, notify, queue, revealed, sessionId]
  );

  // Undo the most recent answer: step back to that card, restore it as
  // unanswered, remove any repeat slot the answer had scheduled, and (when the
  // answer never reached the server) drop it from the offline queue. Re-answering
  // a card the server already recorded is logged as an echo, so it never
  // double-counts the sitting.
  const undo = useCallback(() => {
    const last = history.current.pop();
    if (!last) return;
    if (last.queued) dropLastQueuedReview();
    setQueue((prev) => {
      const out = [];
      for (const card of prev) {
        if (last.insertedKey != null && card._key === last.insertedKey) continue;
        out.push(card._key === last.card._key ? last.card : card);
      }
      return out;
    });
    setSummary(null);
    setRevealed(false);
    setIndex(last.index);
    setCanUndo(history.current.length > 0);
  }, []);

  // Keyboard: space/enter reveals, 1-4 rate, u undoes. Ignored while typing in a
  // field so a stray key in another input never answers a card.
  useEffect(() => {
    function onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
      if (event.key === " " || event.key === "Enter") {
        if (!revealed) {
          event.preventDefault();
          reveal();
        }
        return;
      }
      if (event.key === "u" || event.key === "U") {
        if (canUndo) {
          event.preventDefault();
          undo();
        }
        return;
      }
      const button = RATING_BUTTONS.find((b) => b.hint === event.key);
      if (button && revealed) {
        event.preventDefault();
        answer(button.rating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Touch gestures: record where a swipe began, classify it on release and turn
  // it into the same answer a button would send. Only while the answer is shown.
  function onTouchStart(event) {
    const touch = event.changedTouches?.[0];
    if (touch) swipeStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event) {
    const start = swipeStart.current;
    swipeStart.current = null;
    const touch = event.changedTouches?.[0];
    if (!start || !touch || !revealed || busy) return;
    const direction = classifySwipe({ dx: touch.clientX - start.x, dy: touch.clientY - start.y });
    if (direction && SWIPE_RATINGS[direction]) answer(SWIPE_RATINGS[direction]);
  }

  async function exitSession() {
    // Leaving early abandons the sitting; the answered cards keep their new
    // scheduling state (reviews are already logged), only the queue is dropped.
    try {
      await abandonSession(sessionId);
    } catch {
      /* a missing session is fine - we are leaving anyway */
    }
    navigate(backTo(session));
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="h-64 animate-pulse rounded-3xl bg-stone-200/70" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold text-ink">Session not found</h1>
        <p className="mt-2 text-sm text-ink/55">It may have been abandoned or already deleted.</p>
        <Link to="/flash" className="mt-6 inline-block text-sm font-semibold text-lavender-soft hover:underline">
          Back to flash cards
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  if (summary) {
    const total = summary.total ?? completed;
    const accuracy =
      typeof summary.accuracy === "number" ? Math.round(summary.accuracy * 100) : null;
    const focus = summary.focus ?? focusMeta;
    const leftoverDue =
      typeof summary.leftover_due === "number"
        ? summary.leftover_due
        : typeof focus?.leftover_due === "number"
          ? focus.leftover_due
          : null;
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="card p-8 text-center">
          <div className="text-5xl">🎉</div>
          <h1 className="mt-3 font-display text-3xl font-semibold text-ink">Session complete</h1>
          <p className="mt-2 text-sm text-ink/60">
            You answered {total} {total === 1 ? "card" : "cards"}.
          </p>

          <div className="mt-6 grid grid-cols-4 gap-2 text-center">
            {RATING_BUTTONS.map((b) => (
              <div key={b.key} className="rounded-xl border border-ink/10 bg-white/5 px-2 py-3">
                <div className="stat-num text-xl text-ink">{summary[b.key] ?? 0}</div>
                <div className="text-xs text-ink/50">{b.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-xl border border-ink/10 px-2 py-3">
              <div className="stat-num text-xl text-ink">{total}</div>
              <div className="text-xs text-ink/50">Reviewed</div>
            </div>
            <div className="rounded-xl border border-ink/10 px-2 py-3">
              <div className="stat-num text-xl text-ink">{accuracy === null ? "—" : `${accuracy}%`}</div>
              <div className="text-xs text-ink/50">Accuracy</div>
            </div>
            <div className="rounded-xl border border-ink/10 px-2 py-3">
              <div className="stat-num text-xl text-ink">{formatDuration(summary.total_ms)}</div>
              <div className="text-xs text-ink/50">Time</div>
            </div>
            <div className="rounded-xl border border-ink/10 px-2 py-3">
              <div className="stat-num text-xl text-ink">{summary.struggling ?? 0}</div>
              <div className="text-xs text-ink/50">Struggling</div>
            </div>
          </div>

          {leftoverDue !== null && (
            <div className="mt-4 rounded-xl border border-ink/10 bg-white/5 p-3 text-sm text-ink/70">
              {leftoverDue > 0 ? (
                <>
                  <span className="font-semibold text-ink">{leftoverDue}</span>{" "}
                  {leftoverDue === 1 ? "due card is" : "due cards are"} still waiting — run
                  another focus session when you have a minute.
                </>
              ) : (
                <>You caught up on everything due in this deck. 🎯</>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              to={backTo(session)}
              className="rounded-xl bg-lavender px-5 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep"
            >
              Back to deck
            </Link>
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="rounded-xl border border-ink/15 px-5 py-2.5 text-sm font-semibold text-ink/70 transition hover:bg-white/5 disabled:opacity-40"
            >
              Undo last answer
            </button>
            <Link
              to="/flash"
              className="rounded-xl border border-ink/15 px-5 py-2.5 text-sm font-semibold text-ink/70 transition hover:bg-white/5"
            >
              All decks
            </Link>
          </div>
        </div>
        <Toast toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="card p-10 text-center">
          <div className="text-4xl">✅</div>
          <h1 className="mt-3 font-display text-2xl font-semibold text-ink">Nothing to study</h1>
          <p className="mt-2 text-sm text-ink/60">No cards are due in this deck right now.</p>
          <Link
            to={backTo(session)}
            className="mt-6 inline-block rounded-xl bg-lavender px-5 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep"
          >
            Back to deck
          </Link>
        </div>
      </div>
    );
  }

  const Viewer = getCardType(current.card_type).Viewer;
  const face = revealed ? "back" : "front";
  const progress = planned > 0 ? Math.round((completed / planned) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <FlashBreadcrumbs
          items={[
            { label: "Flash Cards", to: "/flash" },
            { label: "Study" },
          ]}
        />
        <div className="flex items-center gap-2">
          {queuedCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
              {queuedCount} waiting to sync
            </span>
          )}
          <button
            type="button"
            onClick={exitSession}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-white/5"
          >
            End session
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-ink/50">
          <span>
            {completed} / {planned} reviewed
          </span>
          <span>{remaining} left · {progress}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div
          key={current._key ?? current.id}
          className="card flex min-h-[18rem] flex-1 touch-pan-y flex-col justify-center p-6 sm:p-8"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">
              {revealed ? "Answer" : "Question"}
            </span>
            {current._isEcho && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                {current._requeue === "echo" ? "Revisit" : "Again"}
              </span>
            )}
          </div>
          <div className="text-lg leading-relaxed text-ink">
            <Viewer card={current} face={face} autoPlay={revealed && settings.audio_autoplay !== false} />
          </div>
        </div>

        {!revealed ? (
          <button
            type="button"
            onClick={reveal}
            className="mt-5 w-full rounded-2xl bg-lavender px-6 py-4 text-base font-semibold text-on-accent transition hover:bg-lavender-deep"
          >
            Show answer
            <span className="ml-2 text-xs font-normal opacity-70">(Space)</span>
          </button>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RATING_BUTTONS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  disabled={busy}
                  onClick={() => answer(b.rating)}
                  className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition disabled:opacity-50 ${b.className}`}
                >
                  <span className="block">{b.label}</span>
                  <span className="mt-0.5 block text-xs font-normal opacity-75">
                    {previews?.[b.key] ?? "—"}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-50">{b.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-ink/40 sm:hidden">
              Swipe: ← Again · Good → · ↑ Easy · ↓ Hard
            </p>
          </>
        )}

        <button
          type="button"
          onClick={undo}
          disabled={busy || !canUndo}
          className="mt-3 self-center rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/55 transition hover:bg-white/5 disabled:opacity-40"
        >
          Undo last answer
        </button>
      </div>

      {/* A leech (too many lapses) is suspended; offer to rewrite it. */}
      {leechCard && !leechEditing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
          <div className="card w-full max-w-md p-6 text-center">
            <div className="text-4xl">🧟</div>
            <h2 className="mt-3 font-display text-xl font-semibold text-ink">Rewrite this card?</h2>
            <p className="mt-2 text-sm text-ink/60">
              This card has slipped {leechCard.lapses ?? 0} times and has been suspended so it
              stops clogging your queue. A clearer prompt — or splitting it in two — usually
              unsticks it.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setLeechCard(null)}
                className="rounded-xl border border-ink/15 px-4 py-2 text-sm font-semibold text-ink/70 transition hover:bg-white/5"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => setLeechEditing(true)}
                className="rounded-xl bg-lavender px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep"
              >
                Rewrite
              </button>
            </div>
          </div>
        </div>
      )}

      {leechEditing && leechCard && (
        <Suspense fallback={null}>
          <CardEditorModal
            key={`leech-editor-${leechCard.id}`}
            open
            card={leechCard}
            categoryId={leechCard.category_id}
            onClose={() => {
              setLeechEditing(false);
              setLeechCard(null);
            }}
            onSaved={() => {
              notify("Card updated.");
              setLeechEditing(false);
              setLeechCard(null);
            }}
          />
        </Suspense>
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
