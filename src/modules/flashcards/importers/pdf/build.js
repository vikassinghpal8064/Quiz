// Turn resolved page regions into cards, uploading only the final crops.
//
// A "side spec" is one of:
//   { canvas }            - a canvas to encode as WebP and upload
//   { url, width, height }- already-uploaded image
//   { text }              - a text side (e.g. Mode C placeholder, or a caption)
//
// Only sides that are actually part of an approved card reach here, so a whole
// PDF is never uploaded - just the crops the user chose. Uploads run with a
// small concurrency pool so a 150-card run does not open 150 sockets at once.

import { SOURCES, imageSide, makeCandidate, textSide } from "../candidate.js";
import { uploadMediaBlob } from "../../lib/media.js";
import { loadImageQuality } from "../../lib/imageQuality.js";
import { PAGE_MAX_EDGE, fitEdge, pageRenderSize, prepareImage } from "../../lib/imageProcessing/index.js";

export const UPLOAD_CONCURRENCY = 4;

// Kept for callers that still import it; the pipeline now owns the actual
// quality. This is a preset *name*, not a 0..1 number.
export const WEBP_QUALITY = "high";

// Rasterise a page for export. The page scale lives in one place (plan.js
// PAGE_RENDER_SCALE / PAGE_MAX_EDGE): a vector PDF page is rendered at 2x its
// natural size so the glyphs of a LaTeX fraction resolve cleanly, and never
// beyond a 2400 px longest edge. A raster image source is rendered 1:1 - there
// is no vector detail to gain by upscaling it - and the pipeline caps it later.
export async function renderPageForExport(source, index, opts = {}) {
  const size = await source.getSize(index);
  const target =
    source.kind === "pdf"
      ? pageRenderSize(size.width, size.height)
      : fitEdge(size.width, size.height, PAGE_MAX_EDGE);
  return source.render(index, { ...opts, targetWidth: target.width });
}

// Run `worker` over `items` with at most `limit` in flight, preserving order.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) runners.push(run());
  await Promise.all(runners);
  return results;
}

// Encode one canvas through the pipeline and upload it. `sourceKind` decides the
// size cap and the lossless rule: a whole PDF page (2400 px) or a crop (never
// downscaled, lossless when small).
async function uploadCanvas(canvas, { quality, filename, sourceKind = "page" } = {}) {
  const prepared = await prepareImage(canvas, { sourceKind, quality });
  const uploaded = await uploadMediaBlob(prepared.blob, {
    kind: "image",
    mime: prepared.mime,
    filename,
    hash: prepared.hash,
  });
  return imageSide(uploaded.url, {
    width: prepared.width,
    height: prepared.height,
    path: uploaded.path,
    mime: uploaded.mime,
    bytes: uploaded.bytes,
    hash: uploaded.hash,
  });
}

async function resolveSide(spec, ctx) {
  if (!spec) return textSide("");
  if (typeof spec === "string") return textSide(spec);
  if (spec.text != null) return textSide(spec.text);
  if (spec.url) return imageSide(spec.url, { width: spec.width, height: spec.height, alt: spec.alt });
  // `render` defers rasterising the page until an upload slot is free, so a
  // 150-page run never holds every canvas in memory at once.
  const canvas = spec.canvas ?? (spec.render ? await spec.render() : null);
  if (canvas) {
    return uploadCanvas(canvas, {
      quality: ctx.quality,
      filename: spec.filename,
      sourceKind: spec.sourceKind ?? "page",
    });
  }
  return textSide("");
}

// regions -> candidates[]. `onProgress(done, total)` fires per region, not per
// upload, so one region with two sides only moves the bar once.
export async function buildImageCandidates(
  regions,
  { source = SOURCES.pdf, tags = [], quality, onProgress, cardType = "basic" } = {}
) {
  const list = regions ?? [];
  // Resolve the user's quality preset once per build (cached after the first
  // call), so every page in one import is encoded at the same quality.
  const resolvedQuality = quality ?? (await loadImageQuality());
  let done = 0;

  const candidates = await mapLimit(list, UPLOAD_CONCURRENCY, async (region) => {
    const front = await resolveSide(region.front, { quality: resolvedQuality });
    const back = await resolveSide(region.back, { quality: resolvedQuality });
    done += 1;
    onProgress?.(done, list.length);
    return makeCandidate({
      key: region.key,
      front,
      back,
      tags: region.tags ?? tags,
      cardType,
      source,
      sourceRef: region.sourceRef ?? null,
      categoryName: region.categoryName ?? null,
      warnings: region.warnings ?? [],
      approved: region.approved,
    });
  });

  return candidates;
}
