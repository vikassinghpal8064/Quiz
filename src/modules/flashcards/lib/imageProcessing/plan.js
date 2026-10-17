// The pure decision layer of the image pipeline.
//
// Given what an image *is* (a rasterised PDF page, a crop out of one, a camera
// photo, an ink preview) and where it came from, decide - without touching a
// canvas - the single encode that should happen: whether to re-encode at all,
// what size to draw at, which format and quality to ask for, and what to fall
// back to when the browser cannot encode WebP (Safari).
//
// Rules, in the order they matter:
//
//   1. Never re-encode an already-compressed file. A WebP/JPEG/AVIF/HEIC that is
//      already inside its size budget is passed through untouched; a PDF page is
//      rasterised once (at 2x) and encoded once.
//   2. Longest edge: pages 2400 px, camera photos 2000 px. A crop is *never*
//      downscaled - it is a deliberate rectangle, so its pixels are kept.
//   3. Lossless WebP for crops under 600 KB and for ink PNG previews; otherwise
//      the user's quality preset (balanced 0.85 / high 0.92 / lossless).
//   4. If WebP is unavailable the encoder falls back to JPEG 0.92, or PNG for
//      crops and ink (a transparency / text edge must not ring).
//
// Everything here is pure and total: bad input yields sane defaults, never a
// throw, so a single odd file cannot stall an import. This is the file the unit
// tests pin the rules down in.

import { resolveQualityPreset } from "./presets.js";

// Output formats. "webp" is always attempted first; the other two are fallbacks.
export const WEBP = "image/webp";
export const JPEG = "image/jpeg";
export const PNG = "image/png";

// Longest-edge ceilings. `Infinity` means "keep every pixel".
export const PAGE_MAX_EDGE = 2400;
export const PHOTO_MAX_EDGE = 2000;

// A PDF page is rasterised at twice its natural size before the 2400 px cap is
// applied, so the vector glyphs of a LaTeX fraction are resolved at print
// resolution rather than screen resolution.
export const PAGE_RENDER_SCALE = 2;

// Crops this small are cheap to store losslessly, so their fine detail (a small
// exponent, a curve label) survives. The threshold is a byte budget when the
// caller knows the source size, and a pixel budget otherwise (about 0.5 bytes
// per pixel for lossless WebP of line art).
export const CROP_LOSSLESS_MAX_BYTES = 600 * 1024;
export const CROP_LOSSLESS_MAX_PIXELS = 1_200_000;

// A crop / ink preview that falls back must not be re-encoded as JPEG - the
// ringing around drawn or typeset edges is exactly what the user is staring at.
export const LOSSLESS_FALLBACK_FORMAT = PNG;
export const PHOTO_FALLBACK_FORMAT = JPEG;

// Sources whose bytes are already a compressed image codec. Re-encoding one of
// these is a pure quality loss with no format gain, so rule 1 passes it through.
export const ALREADY_COMPRESSED_MIMES = Object.freeze(
  new Set(["image/webp", "image/jpeg", "image/jpg", "image/avif", "image/heic", "image/heif"])
);

// Raster formats the pipeline can safely decode with createImageBitmap. SVG,
// GIF (animated) and anything else are left for the caller to upload untouched.
export const RASTER_MIMES = Object.freeze(
  new Set([
    "image/webp",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/bmp",
  ])
);

// The upload kinds the pipeline understands. `background` is the photo behind an
// ink drawing; it is treated as a camera photo for sizing.
export const SOURCE_KINDS = Object.freeze(["page", "crop", "photo", "background", "ink"]);

function normaliseMime(mime) {
  return String(mime ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

// Can the pipeline decode (and therefore re-encode) this MIME itself? SVG and
// animated GIF are deliberately excluded.
export function isRasterMime(mime) {
  return RASTER_MIMES.has(normaliseMime(mime));
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// The longest-edge ceiling for a kind. Crops and ink are unbounded here - they
// are drawn at a size the user chose.
export function maxEdgeFor(sourceKind) {
  if (sourceKind === "page") return PAGE_MAX_EDGE;
  if (sourceKind === "photo" || sourceKind === "background") return PHOTO_MAX_EDGE;
  return Infinity;
}

// Fit (width, height) inside a maxEdge box without ever upscaling. Mirrors
// lib/image.js fitWithin, but reports the scale so callers can tell "untouched"
// from "shrunk". `maxEdge === Infinity` returns the input untouched.
export function fitEdge(width, height, maxEdge = Infinity) {
  const w = Math.max(1, Math.round(positive(width, 1)));
  const h = Math.max(1, Math.round(positive(height, 1)));
  const limit = Number(maxEdge);
  if (!Number.isFinite(limit) || limit <= 0 || (w <= limit && h <= limit)) {
    return { width: w, height: h, scale: 1, resized: false };
  }
  const scale = limit / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
    resized: true,
  };
}

// The pixel size a PDF page should be rasterised at: 2x its natural size, capped
// so the longest edge is at most `maxEdge`. Unlike fitEdge this *may* upscale -
// pdf.js renders vectors, so asking for 2x yields real detail rather than
// interpolated pixels.
export function pageRenderSize(width, height, { scale = PAGE_RENDER_SCALE, maxEdge = PAGE_MAX_EDGE } = {}) {
  const w = Math.max(1, positive(width, 1));
  const h = Math.max(1, positive(height, 1));
  const longest = Math.max(w, h);
  const factor = Math.min(positive(scale, PAGE_RENDER_SCALE) * longest, positive(maxEdge, PAGE_MAX_EDGE));
  const ratio = factor / longest;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

// Decide the one encode for a source. Returns a plain object the pipeline (and
// the tests) can read:
//
//   { sourceKind, format, fallbackFormat, quality, lossless, maxEdge,
//     width, height, scale, resize, passthrough, reason }
//
// `passthrough` true means "upload the original bytes unchanged".
export function planEncoding({ sourceKind = "photo", mime, bytes, width, height, quality } = {}) {
  const kind = SOURCE_KINDS.includes(sourceKind) ? sourceKind : "photo";
  const preset = resolveQualityPreset(quality);
  const maxEdge = maxEdgeFor(kind);
  const fit = fitEdge(width, height, maxEdge);

  const originalMime = normaliseMime(mime);
  const alreadyCompressed = ALREADY_COMPRESSED_MIMES.has(originalMime);
  // Rule 1: a compressed source that needs no resize is never re-encoded. An ink
  // preview is deliberately re-encoded to WebP losslessly, so it is exempt.
  const passthrough = alreadyCompressed && !fit.resized && kind !== "ink";

  const pixels = fit.width * fit.height;
  const sourceBytes = Number(bytes);
  const knowsBytes = Number.isFinite(sourceBytes) && sourceBytes > 0;

  // Rule 3: crops and ink are lossless when they are small. `preset.lossless`
  // already asks for lossless for every kind.
  let lossless = preset.lossless;
  let reason = preset.lossless ? "preset:lossless" : `preset:${preset.name}`;
  if (kind === "ink") {
    lossless = true;
    reason = "ink:lossless";
  } else if (kind === "crop" && !lossless) {
    const small = knowsBytes ? sourceBytes <= CROP_LOSSLESS_MAX_BYTES : pixels <= CROP_LOSSLESS_MAX_PIXELS;
    if (small) {
      lossless = true;
      reason = "crop:small-lossless";
    }
  }
  if (passthrough) reason = "passthrough:already-compressed";

  const fallbackFormat =
    kind === "crop" || kind === "ink" ? LOSSLESS_FALLBACK_FORMAT : PHOTO_FALLBACK_FORMAT;

  return {
    sourceKind: kind,
    format: WEBP,
    fallbackFormat,
    quality: lossless ? 1 : preset.quality,
    lossless,
    maxEdge,
    width: fit.width,
    height: fit.height,
    scale: fit.scale,
    resize: fit.resized,
    passthrough,
    reason,
  };
}
