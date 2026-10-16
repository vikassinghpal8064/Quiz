// FSRS scheduler (default). Wraps ts-fsrs so the rest of the app only ever
// deals with the plain card-state object defined in cardState.js.
//
// Pure: no database, no React, no globals. The FSRS instance is rebuilt per
// call from the requested retention, which keeps the function stateless and
// therefore identical on the client and the server.

import { fsrs, generatorParameters } from "ts-fsrs";
import {
  newCardState,
  normalizeCardState,
  toDate,
  diffDays,
} from "./cardState.js";
import { formatInterval } from "./formatInterval.js";
import {
  DEFAULT_SETTINGS,
  RATINGS,
  clamp01,
  normalizeRating,
} from "./constants.js";

const PREVIEW_RATINGS = [
  [RATINGS.Again, "again"],
  [RATINGS.Hard, "hard"],
  [RATINGS.Good, "good"],
  [RATINGS.Easy, "easy"],
];

function buildFsrs(settings) {
  const requested = settings?.desired_retention;
  const request_retention =
    typeof requested === "number" && requested > 0 && requested <= 1
      ? requested
      : DEFAULT_SETTINGS.desired_retention;
  // Fuzzing is off unless a caller opts in, so previews and tests are
  // deterministic.
  return fsrs(
    generatorParameters({
      request_retention,
      enable_fuzz: settings?.enable_fuzz === true,
    }),
  );
}

// card-state -> ts-fsrs Card.
function toFsrsCard(cardState, now) {
  const s = normalizeCardState(cardState);
  const nowDate = toDate(now) ?? new Date();
  const lastReview = toDate(s.last_review);
  const due = toDate(s.due) ?? lastReview ?? nowDate;
  const elapsed = lastReview ? Math.max(0, diffDays(nowDate, lastReview)) : 0;
  return {
    due,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: elapsed,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: lastReview ?? undefined,
  };
}

// ts-fsrs Card -> card-state.
function fromFsrsCard(card) {
  return {
    state: card.state,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    scheduled_days: card.scheduled_days ?? 0,
    learning_steps: card.learning_steps ?? 0,
    elapsed_days: card.elapsed_days ?? 0,
  };
}

// schedule(cardState, rating, now, settings) -> newCardState
export function schedule(cardState, rating, now, settings = {}) {
  const grade = normalizeRating(rating);
  const nowDate = toDate(now) ?? new Date();
  const engine = buildFsrs(settings);
  const { card } = engine.next(toFsrsCard(cardState, nowDate), nowDate, grade);
  return fromFsrsCard(card);
}

// previewIntervals(cardState, now, settings) -> { again, hard, good, easy }
export function previewIntervals(cardState, now, settings = {}) {
  const nowDate = toDate(now) ?? new Date();
  const engine = buildFsrs(settings);
  const record = engine.repeat(toFsrsCard(cardState, nowDate), nowDate);
  const out = {};
  for (const [rating, key] of PREVIEW_RATINGS) {
    const due = record[rating].card.due;
    out[key] = formatInterval(due.getTime() - nowDate.getTime());
  }
  return out;
}

// Probability the card is still recalled at `now`. New / never-reviewed cards
// have no memory state, so they report 0.
export function getRetrievability(cardState, now) {
  const s = normalizeCardState(cardState);
  if (!(s.stability > 0) || !s.last_review) return 0;
  const nowDate = toDate(now) ?? new Date();
  const engine = buildFsrs(DEFAULT_SETTINGS);
  const value = engine.get_retrievability(toFsrsCard(s, nowDate), nowDate, false);
  return clamp01(value);
}

export { newCardState };

export default {
  name: "fsrs",
  schedule,
  previewIntervals,
  getRetrievability,
};
