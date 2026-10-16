// SM-2 scheduler (alternative). Implements the classic SuperMemo-2 algorithm
// against the same card-state shape as FSRS, so it is a drop-in replacement
// selectable via settings.scheduler === "sm2".
//
// Field reuse (only one scheduler is active at a time, so there is no clash):
//   difficulty  -> the ease factor (EF), default 2.5, floor 1.3
//   stability   -> the current interval, in days
//
// Pure: no database, no React, no globals.

import { DAY_MS, newCardState, normalizeCardState, toDate, diffDays } from "./cardState.js";
import { formatInterval } from "./formatInterval.js";
import { RATINGS, STATES, clamp01, normalizeRating } from "./constants.js";

const MINUTE_MS = 60_000;

const SM2 = Object.freeze({
  default_ease: 2.5,
  min_ease: 1.3,
  again_minutes: 10,
  hard_factor: 1.2,
  easy_bonus: 1.3,
  new_hard_days: 1,
  new_good_days: 3,
  new_easy_days: 7,
});

// Rating -> SM-2 quality (0-5). Again is a failure (< 3); the rest succeed.
const QUALITY = {
  [RATINGS.Again]: 2,
  [RATINGS.Hard]: 3,
  [RATINGS.Good]: 4,
  [RATINGS.Easy]: 5,
};

const PREVIEW_RATINGS = [
  [RATINGS.Again, "again"],
  [RATINGS.Hard, "hard"],
  [RATINGS.Good, "good"],
  [RATINGS.Easy, "easy"],
];

function easeOf(state) {
  return state.difficulty > 0 ? state.difficulty : SM2.default_ease;
}

function nextEase(ease, quality) {
  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  return Math.max(SM2.min_ease, ease + delta);
}

// The interval (in days) a non-failure rating would schedule. Deterministic
// and monotonic: hard < good < easy for any ease >= 1.3.
function successInterval(rating, ease, intervalDays) {
  const hasHistory = intervalDays > 0;
  if (rating === RATINGS.Hard) return hasHistory ? intervalDays * SM2.hard_factor : SM2.new_hard_days;
  if (rating === RATINGS.Easy) {
    return hasHistory ? intervalDays * ease * SM2.easy_bonus : SM2.new_easy_days;
  }
  return hasHistory ? intervalDays * ease : SM2.new_good_days;
}

// schedule(cardState, rating, now, settings) -> newCardState
// `settings` is part of the shared scheduler interface but SM-2 has no
// tunable parameters in fc_settings, so it is intentionally unused.
export function schedule(cardState, rating, now, _settings = {}) {
  const state = normalizeCardState(cardState);
  const grade = normalizeRating(rating);
  const nowDate = toDate(now) ?? new Date();

  const ease = easeOf(state);
  const nextEaseValue = nextEase(ease, QUALITY[grade]);

  let intervalDays;
  let nextState;
  let reps = state.reps;
  let lapses = state.lapses;
  let due;

  if (grade === RATINGS.Again) {
    reps = 0;
    lapses += 1;
    intervalDays = 0;
    nextState = state.state === STATES.New ? STATES.Learning : STATES.Relearning;
    due = new Date(nowDate.getTime() + SM2.again_minutes * MINUTE_MS);
  } else {
    intervalDays = successInterval(grade, ease, state.stability);
    reps += 1;
    nextState = STATES.Review;
    due = new Date(nowDate.getTime() + intervalDays * DAY_MS);
  }

  return {
    state: nextState,
    due: due.toISOString(),
    stability: intervalDays,
    difficulty: nextEaseValue,
    reps,
    lapses,
    last_review: nowDate.toISOString(),
    scheduled_days: Math.round(intervalDays),
    learning_steps: 0,
    elapsed_days: 0,
  };
}

// previewIntervals(cardState, now, settings) -> { again, hard, good, easy }
export function previewIntervals(cardState, now, settings = {}) {
  const nowDate = toDate(now) ?? new Date();
  const out = {};
  for (const [rating, key] of PREVIEW_RATINGS) {
    const next = schedule(cardState, rating, nowDate, settings);
    out[key] = formatInterval(toDate(next.due).getTime() - nowDate.getTime());
  }
  return out;
}

// SM-2 has no native retrievability, so approximate it with exponential decay
// over the current interval: R = e^(-elapsed / interval).
export function getRetrievability(cardState, now) {
  const state = normalizeCardState(cardState);
  if (!(state.stability > 0) || !state.last_review) return 0;
  const elapsed = Math.max(0, diffDays(now, state.last_review));
  return clamp01(Math.exp(-elapsed / state.stability));
}

export { newCardState };

export default {
  name: "sm2",
  schedule,
  previewIntervals,
  getRetrievability,
};
