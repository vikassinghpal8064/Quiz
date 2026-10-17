// Shared vocabulary for the scheduler. Pure data + tiny helpers only: this
// file imports nothing, so it is safe on both the client and the server.

// Review ratings. These line up 1:1 with ts-fsrs' Rating enum and with the
// smallint stored in fc_review_logs.rating.
export const RATINGS = Object.freeze({
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
});

// Card learning states. These line up 1:1 with ts-fsrs' State enum and with
// fc_card_state.state.
export const STATES = Object.freeze({
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
});

// Scheduler implementations the registry can select.
export const SCHEDULER_NAMES = Object.freeze({
  FSRS: "fsrs",
  SM2: "sm2",
});

// Mirrors the default rows seeded into fc_settings by db/flash_001.sql, so the
// schedulers behave identically whether settings came from the DB or from a
// bare call in a unit test.
export const DEFAULT_SETTINGS = Object.freeze({
  scheduler: SCHEDULER_NAMES.FSRS,
  desired_retention: 0.9,
  new_cards_per_day: 20,
  // Reviews the user aims to complete in a day. Shown as progress on the flash
  // home screen; stored in fc_settings like the scheduler knobs.
  daily_goal: 30,
  focus_fraction: 0.25,
  focus_min: 10,
  focus_max: 60,
  struggle_slow_ratio: 1.75,
  struggle_weights: Object.freeze({
    time: 0.35,
    again: 0.3,
    lapse: 0.2,
    hard: 0.15,
  }),
  // When true, a correct-but-slow ("shaky") answer schedules as Hard instead of
  // being echoed back for a second pass. Off by default so the classic echo
  // behaviour is unchanged.
  auto_downgrade_shaky_correct: false,
  // Play a card's audio block automatically once the answer is revealed.
  audio_autoplay: true,
  // balanced | high | lossless - the WebP quality the image pipeline encodes at
  // (see lib/imageProcessing/presets.js). "high" (0.92) is the documented
  // default; the value is duplicated here as a literal because this module
  // deliberately imports nothing, so it is loadable on both client and server.
  image_quality: "high",
  // light | dark | system - mirrors the pre-paint script's localStorage key.
  theme: "system",
});

export const DEFAULT_STRUGGLE_WEIGHTS = DEFAULT_SETTINGS.struggle_weights;
export const DEFAULT_STRUGGLE_SLOW_RATIO = DEFAULT_SETTINGS.struggle_slow_ratio;

const RATING_NAMES = { again: RATINGS.Again, hard: RATINGS.Hard, good: RATINGS.Good, easy: RATINGS.Easy };

// Accepts 1-4 or "again"/"hard"/"good"/"easy" (any case) and returns the
// numeric rating. Throws on anything else so a bad caller fails loudly.
export function normalizeRating(rating) {
  if (typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 4) {
    return rating;
  }
  if (typeof rating === "string") {
    const key = rating.trim().toLowerCase();
    if (key in RATING_NAMES) return RATING_NAMES[key];
    const asNumber = Number(key);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 4) return asNumber;
  }
  throw new RangeError(`Invalid rating: ${String(rating)}. Expected 1-4 or again|hard|good|easy.`);
}

// "Correct" means the card was recalled without failing: Good or Easy.
export function isCorrectRating(rating) {
  try {
    const r = normalizeRating(rating);
    return r === RATINGS.Good || r === RATINGS.Easy;
  } catch {
    return false;
  }
}

// Clamp to [0, 1], mapping NaN/Infinity to 0 so scoring can never produce a
// value outside its documented bounds.
export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
