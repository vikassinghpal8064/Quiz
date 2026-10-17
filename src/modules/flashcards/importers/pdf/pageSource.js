// A "page source" is an ordered collection of pages the importer can render on
// demand. Two implementations share one interface:
//
//   loadPdfSource(file)     - a real PDF, rasterised with pdf.js
//   loadImageSource(files)  - already-rendered page images (PNG/JPG)
//
// Page sources never hand out the original bytes to the network. A caller asks
// for a specific page at a specific pixel width, gets a canvas back, crops or
// re-encodes it, and only then might upload the result.
//
// pdf.js is pulled in with a dynamic import so the ~1 MB engine lands in its own
// lazy chunk and is only fetched when a PDF is actually opened.

import { createCanvas, context2d, downscaleCanvas, lumaFromCanvas, statsFromCanvas } from "./imaging.js";

// Every page the viewer draws is rendered at least 2x its CSS size.
export const RENDER_SCALE = 2;

const PDF_MAGIC = /^%PDF-/;

// Cache a handful of rendered canvases so scrolling back a page or opening the
// crop view does not re-rasterise from scratch. Bounded because a 2x A4 page is
// several megabytes of pixels.
const CANVAS_CACHE_LIMIT = 8;

function makeCanvasCache(limit = CANVAS_CACHE_LIMIT) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return null;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    clear() {
      map.clear();
    },
  };
}

export function lookLikePdf(file) {
  return Boolean(file) && (
    file.type === "application/pdf" ||
    (typeof file.name === "string" && /\.pdf$/i.test(file.name))
  );
}

// Filenames sort naturally so "page-2" comes before "page-10".
function naturalCompare(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export async function loadPdfSource(file, { onProgress } = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  if (onProgress) {
    task.onProgress = ({ loaded, total }) => {
      onProgress({ loaded, total: total || file.size || loaded });
    };
  }
  const doc = await task.promise;
  const cache = makeCanvasCache();
  const pageCache = new Map();
  const sizeCache = new Map();

  async function page(index) {
    const key = index + 1;
    if (!pageCache.has(key)) pageCache.set(key, doc.getPage(key));
    return pageCache.get(key);
  }

  async function baseSize(index) {
    if (!sizeCache.has(index)) {
      const proxy = await page(index);
      const viewport = proxy.getViewport({ scale: 1 });
      sizeCache.set(index, { width: viewport.width, height: viewport.height });
    }
    return sizeCache.get(index);
  }

  async function render(index, { targetWidth } = {}) {
    if (index < 0 || index >= doc.numPages) throw new Error(`Page ${index + 1} is out of range`);
    const size = await baseSize(index);
    const width = Math.max(1, Math.round(targetWidth || size.width));
    const key = `${index}@${width}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const proxy = await page(index);
    const scale = width / size.width;
    const viewport = proxy.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = context2d(canvas);
    await proxy.render({ canvasContext: ctx, viewport }).promise;
    cache.set(key, canvas);
    return canvas;
  }

  return {
    kind: "pdf",
    name: file.name ?? "document.pdf",
    sizeBytes: file.size ?? null,
    pageCount: doc.numPages,
    getSize: baseSize,
    render: (index, opts) => render(index, opts),
    async renderThumbnail(index, { maxDim = 220 } = {}) {
      const size = await baseSize(index);
      const scale = maxDim / Math.max(size.width, size.height);
      const full = await render(index, { targetWidth: Math.max(1, Math.round(size.width * scale)) });
      return downscaleCanvas(full, maxDim);
    },
    async stats(index) {
      const full = await render(index, { targetWidth: 260 });
      return statsFromCanvas(full);
    },
    async luma(index, opts) {
      const full = await render(index, { targetWidth: (opts?.maxDim ?? 240) * 2 });
      return lumaFromCanvas(full, opts);
    },
    destroy() {
      cache.clear();
      pageCache.clear();
      sizeCache.clear();
      doc.destroy?.();
    },
  };
}

export async function loadImageSource(files, { onProgress } = {}) {
  const list = [...(files ?? [])].sort((a, b) => naturalCompare(a.name, b.name));
  const bitmaps = [];
  const cache = makeCanvasCache();

  for (let i = 0; i < list.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const bitmap = await createImageBitmap(list[i]);
    bitmaps.push({ bitmap, name: list[i].name });
    onProgress?.({ loaded: i + 1, total: list.length });
  }

  function entry(index) {
    if (index < 0 || index >= bitmaps.length) throw new Error(`Page ${index + 1} is out of range`);
    return bitmaps[index];
  }

  function baseSize(index) {
    const { bitmap } = entry(index);
    return { width: bitmap.width, height: bitmap.height };
  }

  function render(index, { targetWidth } = {}) {
    const { bitmap } = entry(index);
    const size = baseSize(index);
    const width = Math.max(1, Math.round(targetWidth || size.width));
    const key = `${index}@${width}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const height = Math.round((width / size.width) * size.height);
    const canvas = createCanvas(width, height);
    const ctx = context2d(canvas);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    cache.set(key, canvas);
    return canvas;
  }

  return {
    kind: "images",
    name: list.length === 1 ? list[0].name : `${list.length} images`,
    sizeBytes: list.reduce((sum, f) => sum + (f.size ?? 0), 0),
    pageCount: bitmaps.length,
    getSize: async (index) => baseSize(index),
    render: async (index, opts) => render(index, opts),
    async renderThumbnail(index, { maxDim = 220 } = {}) {
      const size = baseSize(index);
      const scale = maxDim / Math.max(size.width, size.height);
      return render(index, { targetWidth: Math.max(1, Math.round(size.width * scale)) });
    },
    async stats(index) {
      return statsFromCanvas(render(index, { targetWidth: 260 }));
    },
    async luma(index, opts) {
      return lumaFromCanvas(render(index, { targetWidth: (opts?.maxDim ?? 240) * 2 }), opts);
    },
    destroy() {
      cache.clear();
      for (const { bitmap } of bitmaps) bitmap.close?.();
      bitmaps.length = 0;
    },
  };
}

// Choose the right loader from the dropped files: a single PDF, or one-or-more
// page images (kept in filename order).
export async function loadPageSource(files, { onProgress } = {}) {
  const list = [...(files ?? [])];
  if (list.length === 0) throw new Error("No file chosen");
  if (list.length === 1 && lookLikePdf(list[0])) return loadPdfSource(list[0], { onProgress });
  return loadImageSource(list, { onProgress });
}

export function isPdfHeader(bytes) {
  try {
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
    return PDF_MAGIC.test(head);
  } catch {
    return false;
  }
}
