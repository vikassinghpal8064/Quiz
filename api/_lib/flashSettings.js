// Editable flash-card settings (api/_flash/settings).
//
// fc_settings is a per-user key/value table. This module owns the whitelist of
// keys the settings screen may write, together with each key's type and bounds.
// Everything is additive: unknown keys are ignored, and a missing row simply
// keeps its documented default (see scheduler/constants.js DEFAULT_SETTINGS).
//
// The parser is deliberately data-driven (SETTINGS_SPEC) so the endpoint, the
// UI and the tests all agree on the bounds and the value shapes.

import { MAX_DAILY_GOAL } from "../../src/modules/flashcards/lib/statsModel.js";
import { SCHEDULER_NAMES } from "../../src/modules/flashcards/lib/scheduler/constants.js";
import { IMAGE_QUALITY_NAMES } from "../../src/modules/flashcards/lib/imageProcessing/presets.js";

// The four struggle-score weights. Each is 0..1; the scoring helper merges a
// partial object over DEFAULT_STRUGGLE_WEIGHTS, so a saved object may omit keys.
export const STRUGGLE_WEIGHT_KEYS = Object.freeze(["time", "again", "lapse", "hard"]);

// key -> { type, ...bounds }. `type` is one of: int, number, bool, enum, weights.
export const SETTINGS_SPEC = Object.freeze({
  // Scheduler
  scheduler: { type: "enum", values: [SCHEDULER_NAMES.FSRS, SCHEDULER_NAMES.SM2] },
  desired_retention: { type: "number", min: 0.8, max: 0.97 },
  new_cards_per_day: { type: "int", min: 0, max: 1000 },

  // Daily target (shown on the home screen)
  daily_goal: { type: "int", min: 1, max: MAX_DAILY_GOAL },

  // Focus sessions: N = clamp(ceil(deck * fraction), min, max)
  focus_fraction: { type: "number", min: 0.1, max: 0.5 },
  focus_min: { type: "int", min: 1, max: 500 },
  focus_max: { type: "int", min: 1, max: 500 },

  // Struggle scoring
  struggle_slow_ratio: { type: "number", min: 1, max: 5 },
  struggle_weights: { type: "weights" },

  // Behaviour
  auto_downgrade_shaky_correct: { type: "bool" },
  audio_autoplay: { type: "bool" },
  theme: { type: "enum", values: ["light", "dark", "system"] },

  // Media
  // The WebP quality the image pipeline encodes uploads at. The names come from
  // lib/imageProcessing/presets.js (balanced 0.85 / high 0.92 / lossless) so the
  // UI, the encoder and this whitelist can never disagree.
  image_quality: { type: "enum", values: [...IMAGE_QUALITY_NAMES] },
});

export const EDITABLE_SETTINGS = Object.freeze(Object.keys(SETTINGS_SPEC));

// A JSON-serialisable copy of the spec, handed to the UI so sliders can read
// their own bounds instead of hardcoding them.
export const SETTINGS_SCHEMA = Object.freeze(
  Object.fromEntries(
    EDITABLE_SETTINGS.map((key) => {
      const spec = SETTINGS_SPEC[key];
      return [key, { ...spec, values: spec.values ? [...spec.values] : undefined }];
    })
  )
);

function parseBool(raw, key) {
  if (typeof raw === "boolean") return { value: raw };
  if (raw === "true") return { value: true };
  if (raw === "false") return { value: false };
  return { error: `${key} must be a boolean` };
}

function parseEnum(raw, key, spec) {
  if (typeof raw !== "string" || !spec.values.includes(raw)) {
    return { error: `${key} must be one of ${spec.values.join(", ")}` };
  }
  return { value: raw };
}

function parseWeights(raw, key) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${key} must be an object of weights` };
  }
  const out = {};
  let seen = 0;
  for (const weightKey of STRUGGLE_WEIGHT_KEYS) {
    if (!(weightKey in raw)) continue;
    const n = Number(raw[weightKey]);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return { error: `${key}.${weightKey} must be a number between 0 and 1` };
    }
    out[weightKey] = n;
    seen += 1;
  }
  if (seen === 0) {
    return { error: `${key} must include at least one of ${STRUGGLE_WEIGHT_KEYS.join(", ")}` };
  }
  return { value: out };
}

// Validate one raw value against its spec. Returns { value } or { error }.
export function parseSettingValue(key, raw) {
  const spec = SETTINGS_SPEC[key];
  if (!spec) return { error: `unknown setting: ${key}` };

  if (spec.type === "bool") return parseBool(raw, key);
  if (spec.type === "enum") return parseEnum(raw, key, spec);
  if (spec.type === "weights") return parseWeights(raw, key);

  if (spec.type === "int") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
      return { error: `${key} must be an integer between ${spec.min} and ${spec.max}` };
    }
    return { value: n };
  }

  // number (float)
  const n = Number(raw);
  if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
    return { error: `${key} must be a number between ${spec.min} and ${spec.max}` };
  }
  return { value: n };
}

// Validate a PATCH body down to [{ key, value }]. Keys that are not editable are
// ignored; an empty result (or an out-of-range value) is an error so the caller
// gets a clear message instead of a silent no-op.
export function parseSettingsPatch(body = {}) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be an object" };
  }

  const updates = [];
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const parsed = parseSettingValue(key, raw);
    if (parsed.error) return { error: parsed.error };
    updates.push({ key, value: parsed.value });
  }

  if (updates.length === 0) {
    return { error: `Provide at least one of: ${EDITABLE_SETTINGS.join(", ")}` };
  }
  return { value: updates };
}

// Upsert one setting row. The value is stringified so jsonb is never handed a
// raw JS object. ON CONFLICT updates in place, so editing a value twice is fine.
export const UPSERT_SETTING_SQL = `
  INSERT INTO fc_settings (user_id, key, value)
  VALUES ($1, $2, $3::jsonb)
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
`;

export function upsertSettingArgs(uid, { key, value }) {
  return [uid, key, JSON.stringify(value)];
}
