// Canvas encoding with the Safari fallback.
//
// The pipeline always asks for WebP first. Safari (through 16) encodes to WebP
// only when the platform decoder is present; when it is not, `toBlob` silently
// returns a PNG and `blob.type` reports "image/png". Rule 4 is therefore: encode,
// look at `blob.type`, and if it is not what was asked for, encode again as the
// planned fallback (JPEG 0.92 for photos and pages, PNG for crops and ink).
//
// This is the *main-thread* encoder, used directly when OffscreenCanvas or
// Worker is unavailable and as the reference implementation the worker mirrors.

import { JPEG, PNG } from "./plan.js";

// The quality the fallback JPEG is written at, regardless of the preset. A
// fallback should be predictable: JPEG 0.92 is a good page image either way.
export const FALLBACK_JPEG_QUALITY = 0.92;

// Pick the fallback format for a source kind when the caller did not already get
// one from planEncoding().
export function fallbackFormatFor(sourceKind) {
  return sourceKind === "crop" || sourceKind === "ink" ? PNG : JPEG;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("This browser cannot prepare images for upload.");
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      type,
      quality
    );
  });
}

// Draw `source` into a canvas of exactly (width, height) and encode once.
export async function encodeOnce(source, { width, height, format, quality }) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image for upload.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // White background so a transparent PNG crop does not turn black once the
  // WebP/JPEG has no alpha channel.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvasToBlob(canvas, format, quality);
}

// Encode with the rule-4 fallback. Returns
//   { blob, type, fellBack, attempted }
// `attempted` is the type the browser actually produced for the WebP request
// (useful to log a surprise), and `fellBack` says a second encode happened.
export async function encodeWithFallback(
  source,
  { width, height, format = "image/webp", quality, fallbackFormat = JPEG } = {}
) {
  const first = await encodeOnce(source, { width, height, format, quality });
  if (first.type === format) {
    return { blob: first, type: first.type, fellBack: false, attempted: first.type };
  }

  const second = await encodeOnce(source, {
    width,
    height,
    format: fallbackFormat,
    quality: fallbackFormat === PNG ? undefined : FALLBACK_JPEG_QUALITY,
  });
  return { blob: second, type: second.type, fellBack: true, attempted: first.type };
}
