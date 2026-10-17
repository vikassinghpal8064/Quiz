// Client-side image prep for flash-card media.
//
// This is a thin, backwards-compatible wrapper over the shared image pipeline
// (lib/imageProcessing). Picked / photographed images are handed to prepareImage
// as sourceKind "photo", which:
//
//   - caps the longest edge at 2000 px,
//   - encodes once to WebP at the user's image_quality preset,
//   - falls back to JPEG 0.92 when the browser cannot encode WebP (Safari),
//   - SHA-256 hashes the result so a duplicate is not uploaded twice.
//
// Nothing here runs on the server: the editor component calls compressImage()
// from an event handler, and every browser API is feature-detected with a
// graceful fallback.
//
// fitWithin() is kept as a pure, unit-tested helper (it predates the pipeline
// and some callers still use it directly).

import { prepareImage } from "./imageProcessing/index.js";
import { IMAGE_QUALITY_NAMES } from "./imageProcessing/presets.js";

export const MAX_IMAGE_DIMENSION = 1600;
export const IMAGE_QUALITY = 0.82;

// Map a legacy numeric quality (or a preset name) onto a preset name. The
// pipeline only speaks in named presets; a number close to 1 means "keep more".
export function qualityNameFor(quality) {
  if (typeof quality === "string" && IMAGE_QUALITY_NAMES.includes(quality)) return quality;
  if (typeof quality === "number" && Number.isFinite(quality)) {
    if (quality >= 0.97) return "lossless";
    if (quality <= 0.88) return "balanced";
  }
  return "high";
}

// Fit (width, height) inside a maxDim x maxDim box, preserving aspect ratio.
// Never upscales: an image already smaller than the box is returned unchanged.
export function fitWithin(width, height, maxDim = MAX_IMAGE_DIMENSION) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const limit = Math.max(1, Number(maxDim) || MAX_IMAGE_DIMENSION);
  if (w <= limit && h <= limit) return { width: w, height: h };
  const scale = limit / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// Resize + re-encode an image File through the shared image pipeline. Returns
//   { blob, width, height, mime, compressed, hash, bytes, originalBytes,
//     originalMime, lossless, fallback }
// `compressed:false` means the original bytes were already WebP/JPEG/AVIF/HEIC
// inside the size budget and are being uploaded untouched (see plan.js rule 1).
export async function compressImage(file, { quality } = {}) {
  const prepared = await prepareImage(file, {
    sourceKind: "photo",
    quality: qualityNameFor(quality),
  });
  return {
    blob: prepared.blob,
    width: prepared.width,
    height: prepared.height,
    mime: prepared.mime,
    compressed: !prepared.passthrough,
    hash: prepared.hash,
    bytes: prepared.bytes,
    originalBytes: prepared.originalBytes,
    originalMime: prepared.originalMime,
    lossless: prepared.lossless,
    fallback: prepared.fellBack,
  };
}
