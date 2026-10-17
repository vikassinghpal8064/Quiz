// The encode half of the image pipeline, on a worker thread.
//
// The main thread hands over an ImageBitmap (transferred, so it is not copied)
// plus the target size and format. This worker draws it into an OffscreenCanvas
// and encodes it off the UI thread, which is what keeps a 150-page import from
// freezing the tab while WebP compression runs.
//
// The rule-4 fallback lives here too, mirroring encode.js: ask for WebP, look at
// `blob.type`, and re-encode as the planned fallback if the browser produced
// something else. The worker never throws to the caller - a failure comes back
// as { ok: false, error } so the pool can degrade to the main thread.

/* eslint-disable no-restricted-globals */

self.onmessage = async (event) => {
  const { id, bitmap, width, height, format, quality, fallbackFormat } = event.data ?? {};
  let canvas = null;
  try {
    canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas has no 2d context");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap?.close?.();

    let blob = await canvas.convertToBlob({ type: format, quality });
    let fellBack = false;
    if (blob.type !== format) {
      blob = await canvas.convertToBlob({
        type: fallbackFormat,
        quality: fallbackFormat === "image/png" ? undefined : 0.92,
      });
      fellBack = true;
    }

    self.postMessage({ id, ok: true, blob, type: blob.type, fellBack });
  } catch (err) {
    bitmap?.close?.();
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
