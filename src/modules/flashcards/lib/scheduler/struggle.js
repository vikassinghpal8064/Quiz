// Struggle scoring: turns raw review data into a single 0-1 "this card is
// fighting me" signal, and flags correct-but-slow answers.
//
//   score = w.time  * clamp((ratio - 1) / 2, 0, 1)
//         + w.again * againRate5
//         + w.lapse * clamp(lapses / 6, 0, 1)
//         + w.hard  * hardRate5
//
// where `ratio` is think-time / baseline. Weights come from
// settings.struggle_weights. Pure: no database, no React.

import {
  DEFAULT_STRUGGLE_SLOW_RATIO,
  DEFAULT_STRUGGLE_WEIGHTS,
  RATINGS,
  clamp01,
  isCorrectRating,
  normalizeRating,
} from "./constants.js";

// Used when there is not enough history to derive a baseline.
export const DEFAULT_BASELINE_MS = 12_000;

// Fraction of the last `window` reviews that were Again / Hard. Empty input
// yields zeroes (never NaN).
export function computeRates(reviews = [], window = 5) {
  const recent = Array.isArray(reviews) ? reviews.slice(-window) : [];
  const total = recent.length;
  let again = 0;
  let hard = 0;
  for (const review of recent) {
    let rating;
    try {
      rating = normalizeRating(review?.rating);
    } catch {
      continue;
    }
    if (rating === RATINGS.Again) again += 1;
    else if (rating === RATINGS.Hard) hard += 1;
  }
  return {
    againRate5: total > 0 ? again / total : 0,
    hardRate5: total > 0 ? hard / total : 0,
  };
}

// Median think-time of correct answers, optionally scoped to one card type.
// Reviews without a matching card_type (or without one at all) are included
// when a type is requested, so partial data still produces something useful.
export function computeBaseline(reviews = [], cardType) {
  const list = Array.isArray(reviews) ? reviews : [];
  const times = list
    .filter((review) => {
      if (!review || typeof review.think_ms !== "number" || review.think_ms <= 0) return false;
      if (!isCorrectRating(review.rating)) return false;
      if (cardType != null && review.card_type != null && review.card_type !== cardType) return false;
      return true;
    })
    .map((review) => review.think_ms)
    .sort((a, b) => a - b);

  if (times.length === 0) return DEFAULT_BASELINE_MS;
  const mid = Math.floor(times.length / 2);
  return times.length % 2 === 1 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
}

// think-time as a multiple of the baseline. 1 means "right on baseline".
export function computeTimeRatio(thinkMs, baseline) {
  const base = Number(baseline);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (typeof thinkMs !== "number" || !Number.isFinite(thinkMs) || thinkMs <= 0) return 0;
  return thinkMs / base;
}

// computeStruggleScore accepts either pre-computed metrics or the raw inputs,
// filling in whatever is missing. Always returns a number in [0, 1].
export function computeStruggleScore(input = {}) {
  const {
    reviews = [],
    thinkMs,
    lapses = 0,
    cardType,
    baseline,
    timeRatio,
    settings = {},
  } = input;

  const list = Array.isArray(reviews) ? reviews : [];
  const weights = { ...DEFAULT_STRUGGLE_WEIGHTS, ...(settings.struggle_weights ?? {}) };

  const resolvedBaseline = baseline ?? computeBaseline(list, cardType);
  const ratio = timeRatio ?? computeTimeRatio(thinkMs, resolvedBaseline);

  const rates = computeRates(list);
  const againRate5 = input.againRate5 ?? rates.againRate5;
  const hardRate5 = input.hardRate5 ?? rates.hardRate5;

  const timeTerm = clamp01((ratio - 1) / 2);
  const lapseTerm = clamp01(Number(lapses) / 6);

  const score =
    weights.time * timeTerm +
    weights.again * clamp01(againRate5) +
    weights.lapse * lapseTerm +
    weights.hard * clamp01(hardRate5);

  return clamp01(score);
}

// A correct answer that took markedly longer than the baseline is "shaky":
// right, but not confidently. slowRatio defaults to settings.struggle_slow_ratio.
export function isShakyCorrect(rating, thinkMs, baseline, slowRatio = DEFAULT_STRUGGLE_SLOW_RATIO) {
  if (!isCorrectRating(rating)) return false;
  const base = Number(baseline);
  if (!Number.isFinite(base) || base <= 0) return false;
  if (typeof thinkMs !== "number" || !Number.isFinite(thinkMs) || thinkMs <= 0) return false;
  const threshold = Number.isFinite(slowRatio) && slowRatio > 0 ? slowRatio : DEFAULT_STRUGGLE_SLOW_RATIO;
  return thinkMs > base * threshold;
}
