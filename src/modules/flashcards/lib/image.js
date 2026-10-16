// Client-side image prep for flash-card media.
//
// Images are resized to fit a 1600 px box and re-encoded as WebP *in the
// browser* before upload, so the blob store only ever receives a web-sized
// image and the upload stays small. Nothing here runs on the server: the
// editor component calls compressImage() from an event handler, and every
// browser API is feature-detected with a graceful fallback.
//
// fitWithin() is pure so it can be unit-tested without a DOM.

export const MAX_IMAGE_DIMENSION = 1600;
export const IMAGE_QUALITY = 0.82;

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

// Drawable source + its real pixel size, with a release() for the resources it
// pinned (an ImageBitmap or an object URL).
function loadDrawable(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Resize + re-encode an image File. Returns
//   { blob, width, height, mime, compressed }
// If the browser cannot encode WebP the original file is returned untouched
// (compressed:false), so an upload still succeeds on old engines.
export async function compressImage(
  file,
  { maxDim = MAX_IMAGE_DIMENSION, quality = IMAGE_QUALITY } = {}
) {
  const loaded = await loadDrawable(file);
  try {
    const { width, height } = fitWithin(loaded.width, loaded.height, maxDim);
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the image for upload.");
    ctx.drawImage(loaded.source, 0, 0, width, height);

    let blob = null;
    try {
      blob = await canvasToBlob(canvas, "image/webp", quality);
    } catch {
      blob = null;
    }

    if (!blob) {
      return {
        blob: file,
        width: loaded.width,
        height: loaded.height,
        mime: file.type || "image/jpeg",
        compressed: false,
      };
    }
    return { blob, width, height, mime: "image/webp", compressed: true };
  } finally {
    loaded.release();
  }
}
