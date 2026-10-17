// Turn selected Anki notes into candidates, uploading any images the fields
// reference.
//
// A field's text is HTML; the readable part becomes a text block and each
// `<img src>` that resolves to a file inside the deck is uploaded and becomes an
// image block on the same side. Sounds are intentionally dropped - the bulk
// endpoint takes images and audio, but keeping the first cut to images avoids
// dragging media filenames through a second mapper.
//
// Only images that are actually referenced by an approved-field note are
// uploaded, and uploads run through a small pool so a 2,000-note deck does not
// open 2,000 sockets at once.

import { SOURCES, makeCandidate } from "../candidate.js";
import { uploadMediaBlob } from "../../lib/media.js";
import { loadImageQuality } from "../../lib/imageQuality.js";
import { isRasterMime, prepareImage } from "../../lib/imageProcessing/index.js";
import {
  extractImageRefs,
  invertMediaMap,
  parseAnkiTags,
  splitFields,
  stripHtml,
} from "../anki.js";

export const UPLOAD_CONCURRENCY = 4;

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
};

export function guessImageMime(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(name ?? "").split(/[?#]/)[0])?.[1]?.toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
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

// Resolve an `<img src>` to a zip entry. Anki keys media by original filename in
// the field and by number in the zip, so the name table does the translation;
// a path or query string is tolerated.
function mediaEntryFor(zip, nameToNumber, ref) {
  const clean = String(ref ?? "").split(/[?#]/)[0];
  const candidates = [clean, clean.split("/").pop()].filter(Boolean);
  for (const name of candidates) {
    const number = nameToNumber[name];
    if (number == null) continue;
    const entry = zip.file(number);
    if (entry) return entry;
  }
  return zip.file(clean) ?? null;
}

async function buildSide(html, { zip, nameToNumber, includeImages, quality }) {
  const blocks = [];
  const text = stripHtml(html);
  if (text) blocks.push({ type: "text", text });

  let failed = 0;
  const refs = includeImages ? extractImageRefs(html) : [];
  for (const ref of refs) {
    const entry = mediaEntryFor(zip, nameToNumber, ref);
    if (!entry) {
      // Either the media map is missing (a newer .apkg) or the entry is gone.
      failed += 1;
      continue;
    }
    try {
      const bytes = await entry.async("uint8array");
      const sourceMime = guessImageMime(ref);
      let blob = new Blob([bytes], { type: sourceMime });
      let mime = sourceMime;
      let hash = null;
      // A deck's images are already-compressed files in the zip. Route the
      // raster ones through the pipeline (which passes a small JPEG/WebP through
      // untouched and re-encodes a big PNG to WebP); leave SVG / GIF alone so
      // their vector / animation data survives.
      if (isRasterMime(sourceMime)) {
        try {
          const prepared = await prepareImage(blob, {
            sourceKind: "photo",
            mime: sourceMime,
            bytes: bytes.length,
            quality,
          });
          blob = prepared.blob;
          mime = prepared.mime;
          hash = prepared.hash;
        } catch {
          // A decode failure just means the original is uploaded instead.
        }
      }
      const uploaded = await uploadMediaBlob(blob, { kind: "image", mime, filename: ref, hash });
      blocks.push({
        type: "image",
        url: uploaded.url,
        path: uploaded.path,
        mime: uploaded.mime,
        bytes: uploaded.bytes,
        hash: uploaded.hash,
        // Wizard-only: the untouched bytes from the zip, so the review step can
        // offer "Compare original / compressed" and show the saving.
        _originalFile: new Blob([bytes], { type: sourceMime }),
        _originalBytes: bytes.length,
      });
    } catch {
      // A single unreadable/undeniable image must not sink the whole deck; the
      // text (or the other fields) still produce a card.
      failed += 1;
    }
  }

  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return { blocks, failed };
}

// notes + mapping -> candidates[]. `mapping` is { front, back: number[] };
// `onProgress(done, total)` fires per note.
export async function buildApkgCandidates(
  notes,
  {
    zip,
    mediaMap = {},
    mid = null,
    mapping = { front: 0, back: [] },
    includeTags = true,
    includeImages = true,
    onProgress,
    source = SOURCES.apkg,
  } = {}
) {
  const list = (notes ?? []).filter((note) => mid == null || note.mid === String(mid));
  const nameToNumber = invertMediaMap(mediaMap);
  const back = mapping.back ?? [];
  // Resolve the quality preset once for the whole deck (cached after the first
  // import), so every image in one import is encoded identically.
  const quality = await loadImageQuality();

  let done = 0;
  return mapLimit(list, UPLOAD_CONCURRENCY, async (note) => {
    const fields = splitFields(note.flds);
    const frontHtml = fields[mapping.front] ?? "";
    const backHtml = back.map((index) => fields[index] ?? "").join("\n\n");

    const front = await buildSide(frontHtml, { zip, nameToNumber, includeImages, quality });
    const sideBack = await buildSide(backHtml, { zip, nameToNumber, includeImages, quality });

    const failedImages = front.failed + sideBack.failed;
    const warnings = failedImages
      ? [`${failedImages} image${failedImages === 1 ? "" : "s"} could not be included`]
      : [];

    done += 1;
    onProgress?.(done, list.length);

    return makeCandidate({
      key: `anki-${note.id}`,
      front: { blocks: front.blocks },
      back: { blocks: sideBack.blocks },
      tags: includeTags ? parseAnkiTags(note.tags) : [],
      source,
      sourceRef: note.id,
      warnings,
    });
  });
}
