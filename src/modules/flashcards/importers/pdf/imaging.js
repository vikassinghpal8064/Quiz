// Canvas helpers for the PDF importer. Everything that touches a <canvas> lives
// here; the maths it feeds lives in arrays.js.
//
// Rendered pages are kept as canvases, always cropped/scaled in the browser.
// Only the final, chosen crop is ever turned into a WebP blob and uploaded -
// a whole PDF never leaves the page.

import { imageStats } from "./arrays.js";

export function createCanvas(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function context2d(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

// Draw any CanvasImageSource (canvas, ImageBitmap, HTMLImageElement) scaled to
// the target size. White background so a transparent PNG crop does not turn
// black once it is re-encoded as WebP.
export function drawToCanvas(source, width, height, { background = "#ffffff" } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const sw = source.width ?? source.naturalWidth ?? canvas.width;
  const sh = source.height ?? source.naturalHeight ?? canvas.height;
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Downscale so the longest edge is at most `maxDim`. Returns the same canvas
// when it is already small enough (so callers can avoid an extra allocation).
export function downscaleCanvas(source, maxDim) {
  const w = source.width ?? 0;
  const h = source.height ?? 0;
  const longest = Math.max(w, h);
  if (longest <= maxDim || longest === 0) return source;
  const ratio = maxDim / longest;
  return drawToCanvas(source, w * ratio, h * ratio);
}

export function canvasToWebpBlob(canvas, { quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the image as WebP"));
      },
      "image/webp",
      quality
    );
  });
}

export function canvasToObjectUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the preview image"));
        return;
      }
      resolve({ blob, url: URL.createObjectURL(blob) });
    }, "image/webp", 0.7);
  });
}

// rect is normalised: { x, y, width, height } in 0..1 of the source.
export function cropNormalized(source, rect, { scale = 1 } = {}) {
  const sw = source.width ?? source.naturalWidth ?? 0;
  const sh = source.height ?? source.naturalHeight ?? 0;
  const x = Math.round(clamp01(rect.x) * sw);
  const y = Math.round(clamp01(rect.y) * sh);
  const w = Math.max(1, Math.round(clamp01(rect.width) * sw));
  const h = Math.max(1, Math.round(clamp01(rect.height) * sh));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = createCanvas(outW, outH);
  const ctx = context2d(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(source, x, y, w, h, 0, 0, outW, outH);
  return canvas;
}

// A copy of `source` with a normalised rect painted over, used by Mode E to hide
// the answer region on a card's front.
export function maskNormalized(source, rect, { fill = "#ffffff" } = {}) {
  const canvas = drawToCanvas(source, source.width, source.height);
  const ctx = context2d(canvas);
  const sw = canvas.width;
  const sh = canvas.height;
  ctx.fillStyle = fill;
  ctx.fillRect(
    Math.round(clamp01(rect.x) * sw),
    Math.round(clamp01(rect.y) * sh),
    Math.max(1, Math.round(clamp01(rect.width) * sw)),
    Math.max(1, Math.round(clamp01(rect.height) * sh))
  );
  return canvas;
}

// One luma sample per pixel at up to `maxDim`, plus the dimensions used. This is
// the input to every pixel-based decision (blank pages, pair similarity, diffs).
export function lumaFromCanvas(source, { maxDim = 240 } = {}) {
  const small = downscaleCanvas(source, maxDim);
  const w = small.width;
  const h = small.height;
  const ctx = context2d(small);
  const { data } = ctx.getImageData(0, 0, w, h);
  const luma = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    luma[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return { luma, width: w, height: h };
}

// Squash any page into a fixed size x size luma grid so two pages with different
// aspect ratios can be compared position by position (pair similarity).
export function fixedLuma(source, size = 64) {
  const square = drawToCanvas(source, size, size);
  const ctx = context2d(square);
  const { data } = ctx.getImageData(0, 0, size, size);
  const luma = new Uint8ClampedArray(size * size);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    luma[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return luma;
}

// The per-page stats object the pure blank-page classifier consumes.
export function statsFromCanvas(source, opts) {
  const { luma } = lumaFromCanvas(source, opts);
  return imageStats(luma);
}

export function toImageBitmap(source) {
  if (typeof createImageBitmap === "function") return createImageBitmap(source);
  return Promise.reject(new Error("createImageBitmap is not available in this browser"));
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
