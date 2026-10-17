// The user's image_quality preference, read once and cached for the tab.
//
// The image editors and importers need the preset *name* ("balanced" / "high" /
// "lossless") before they can prepare an upload, but they are rendered deep in
// the tree and have no settings prop. Rather than thread a prop through twenty
// components, this module fetches GET /api/flash/settings lazily the first time
// an upload starts, caches the value, and falls back to the documented default
// if the request fails.
//
// It never blocks the UI: callers `await loadImageQuality()` inside an upload
// handler that is already async, and a failure just means "high".

import { getSettings } from "./api.js";
import { DEFAULT_IMAGE_QUALITY, isImageQualityName } from "./imageProcessing/presets.js";

let cached = null;
let inflight = null;

// The value known right now, without a request. Before the first fetch this is
// the default, so a synchronous caller still gets a usable preset name.
export function cachedImageQuality() {
  return cached ?? DEFAULT_IMAGE_QUALITY;
}

// Resolve the preset name, fetching the settings once. `force` re-reads (used
// after the settings page saves, so the next upload uses the new value).
export function loadImageQuality({ force = false } = {}) {
  if (cached && !force) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = getSettings()
    .then((res) => {
      const value = res?.settings?.image_quality;
      cached = isImageQualityName(value) ? value : DEFAULT_IMAGE_QUALITY;
      return cached;
    })
    .catch(() => DEFAULT_IMAGE_QUALITY)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Called by the settings form after a successful save so the change takes effect
// without a page reload. An invalid value collapses to the default.
export function setCachedImageQuality(value) {
  cached = isImageQualityName(value) ? value : DEFAULT_IMAGE_QUALITY;
  return cached;
}
