// WebP quality presets for the flash-card image pipeline.
//
// A preset is two numbers and a flag: the WebP `quality` to ask the encoder for,
// and whether to ask for lossless. `image_quality` in fc_settings selects one by
// name (see lib/scheduler/constants.js DEFAULT_SETTINGS and
// api/_lib/flashSettings.js SETTINGS_SPEC); a missing row means
// DEFAULT_IMAGE_QUALITY.
//
// Pure data + a lookup, so it is safe on the client, the server and in tests -
// no DOM, no canvas, no fetch.

// The names the settings whitelist accepts, in the order the UI shows them.
export const IMAGE_QUALITY_NAMES = Object.freeze(["balanced", "high", "lossless"]);

// `high` is the default: at 0.92 a photographed page is visually lossless to a
// student on a phone, while still landing well under the 5 MB upload ceiling.
export const DEFAULT_IMAGE_QUALITY = "high";

export const QUALITY_PRESETS = Object.freeze({
  balanced: Object.freeze({ name: "balanced", quality: 0.85, lossless: false }),
  high: Object.freeze({ name: "high", quality: 0.92, lossless: false }),
  // Lossless WebP ignores `quality`; it is 1 so the encoder call is uniform.
  lossless: Object.freeze({ name: "lossless", quality: 1, lossless: true }),
});

export function isImageQualityName(name) {
  return IMAGE_QUALITY_NAMES.includes(name);
}

// Resolve a preset by name, falling back to the default for an unknown value (a
// stale setting row, a client on an older build) rather than throwing.
export function resolveQualityPreset(name) {
  return QUALITY_PRESETS[name] ?? QUALITY_PRESETS[DEFAULT_IMAGE_QUALITY];
}
