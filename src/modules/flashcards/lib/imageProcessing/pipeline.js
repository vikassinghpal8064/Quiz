// The image pipeline entry point.
//
// prepareImage() takes whatever the caller has - a File from a picker, a canvas
// holding a rasterised PDF page, a crop canvas, an ImageBitmap - and returns the
// single blob that should be uploaded, plus everything the UI needs to show the
// user what happened ("2400x3360 WebP - 212 KB, was 1.4 MB").
//
// The order is fixed by the rules in plan.js:
//
//   decode once -> plan -> (pass through) | rasterise -> encode off-thread with
//   a WebP fallback -> hash -> hand back
//
// Nothing here talks to the network: the caller uploads the result through
// lib/media.js, which forwards the hash so the server can skip a duplicate.
//
// Decoding is the only step that must touch the main thread (createImageBitmap
// reads EXIF orientation and cannot run in a module worker without a Blob URL
// dance), so the bitmap is created here and then *transferred* to an encoder
// worker. That keeps the expensive half - WebP compression - off the UI thread.

import { encodeWithFallback } from "./encode.js";
import { encodeBitmap, workersSupported } from "./encodePool.js";
import { sha256Hex } from "./hash.js";
import { planEncoding } from "./plan.js";

// ---------- source detection ----------

export function isCanvasLike(value) {
  return Boolean(value) && typeof value.getContext === "function" && typeof value.width === "number";
}

export function isBitmapLike(value) {
  return Boolean(value) && typeof value.width === "number" && typeof value.close === "function";
}

export function isBlobLike(value) {
  return Boolean(value) && typeof value.arrayBuffer === "function" && typeof value.size === "number";
}

// Decode a Blob/File into a bitmap, honouring EXIF orientation so a phone photo
// taken sideways is not uploaded sideways.
async function decodeBlob(blob) {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot read images for upload.");
  }
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

// Wrap a source so it can be rasterised more than once: the first raster is used
// directly (and transferred to a worker), later rasters are rebuilt from the
// platform source, which is what makes the main-thread fallback possible after a
// transfer has detached the bitmap.
function makeRasterizer(source) {
  let handedOut = false;
  return async function rasterize() {
    if (isCanvasLike(source)) return createImageBitmap(source);
    if (isBitmapLike(source)) {
      if (!handedOut) {
        handedOut = true;
        return source;
      }
      return createImageBitmap(source);
    }
    if (isBlobLike(source)) return decodeBlob(source);
    throw new Error("Unsupported image source.");
  };
}

async function dimensionsOf(source) {
  if (isCanvasLike(source) || isBitmapLike(source)) {
    return { width: source.width, height: source.height, mime: source.type || "", bytes: source.size ?? null };
  }
  if (isBlobLike(source)) {
    const bitmap = await decodeBlob(source);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return { ...size, mime: source.type || "", bytes: source.size ?? null };
  }
  throw new Error("Unsupported image source.");
}

// ---------- formatting helpers ----------

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// "1.4 MB → 212 KB (−85%)" style summary for a progress row or a compare tooltip.
export function describePreparation(result) {
  if (!result) return "";
  const parts = [];
  if (result.width && result.height) parts.push(`${result.width}×${result.height}`);
  parts.push(result.mime === "image/webp" && result.lossless ? "WebP lossless" : String(result.mime || "").replace("image/", ""));
  parts.push(formatBytes(result.bytes));
  return parts.filter(Boolean).join(" · ");
}

// The saving, for the "Compare original / compressed" toggle. Returns null when
// the original size is unknown (a crop canvas has no source bytes).
export function comparisonOf(result) {
  const original = Number(result?.originalBytes);
  const compressed = Number(result?.bytes);
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(compressed)) return null;
  const savedBytes = Math.max(0, original - compressed);
  return {
    originalBytes: original,
    bytes: compressed,
    savedBytes,
    savedRatio: savedBytes / original,
    label: original > compressed ? `${Math.round((savedBytes / original) * 100)}% smaller` : "no saving",
  };
}

// ---------- the pipeline ----------

// Prepare one image for upload.
//
//   source      File | Blob | HTMLCanvasElement | OffscreenCanvas | ImageBitmap
//   sourceKind  "page" | "crop" | "photo" | "background" | "ink"
//   quality     an image_quality preset name (default "high")
//
// Returns
//   { blob, width, height, mime, bytes, hash, originalBytes, originalMime,
//     format, quality, lossless, resize, passthrough, sourceKind, fellBack }
export async function prepareImage(
  source,
  { sourceKind = "photo", quality, mime, bytes, computeHash = true } = {}
) {
  if (!source) throw new Error("prepareImage needs an image source");

  const natural = await dimensionsOf(source);
  const plan = planEncoding({
    sourceKind,
    mime: mime ?? natural.mime,
    bytes: bytes ?? natural.bytes,
    width: natural.width,
    height: natural.height,
    quality,
  });

  const originalBytes = Number.isFinite(Number(bytes)) ? Number(bytes) : natural.bytes ?? null;
  const originalMime = String(mime ?? natural.mime ?? "") || null;

  // Rule 1: already-compressed and already small enough - send it as it is.
  if (plan.passthrough && isBlobLike(source)) {
    const hash = computeHash ? await sha256Hex(source) : null;
    return {
      blob: source,
      width: natural.width,
      height: natural.height,
      mime: source.type || plan.format,
      bytes: source.size,
      hash,
      originalBytes: originalBytes ?? source.size,
      originalMime,
      format: source.type || plan.format,
      quality: plan.quality,
      lossless: false,
      resize: false,
      passthrough: true,
      fellBack: false,
      sourceKind: plan.sourceKind,
    };
  }

  const rasterize = makeRasterizer(source);
  const encodeOptions = {
    width: plan.width,
    height: plan.height,
    format: plan.format,
    quality: plan.quality,
    fallbackFormat: plan.fallbackFormat,
  };

  let encoded;
  try {
    encoded = await encodeBitmap(await rasterize(), encodeOptions, { rasterize });
  } catch {
    // The worker path is best-effort; the main thread is the guarantee.
    encoded = await encodeWithFallback(await rasterize(), encodeOptions);
  }

  const blob = encoded.blob;
  const hash = computeHash ? await sha256Hex(blob) : null;

  return {
    blob,
    width: plan.width,
    height: plan.height,
    mime: blob.type || plan.format,
    bytes: blob.size,
    hash,
    originalBytes,
    originalMime,
    format: plan.format,
    quality: plan.quality,
    lossless: plan.lossless,
    resize: plan.resize,
    passthrough: false,
    fellBack: Boolean(encoded.fellBack),
    sourceKind: plan.sourceKind,
  };
}

// Whether encoding will run off the main thread in this browser. Exposed so a
// caller can decide between a "Compressing…" and an "Uploading…" label.
export const canEncodeOffThread = workersSupported;
