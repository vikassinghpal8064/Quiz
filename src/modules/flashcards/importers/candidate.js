// The wizard's working copy of a card, and the only place that turns one into
// the payload POST /api/flash/cards/bulk accepts.
//
// A candidate is a card plus import-time bookkeeping: a stable key for React
// lists, a front signature for duplicate detection, and blocking errors the
// user has to fix (or approve around). Everything here is pure and immutable -
// each editor returns a new candidate, so the review step can hold an array in
// state and diff it.
//
// Pure: no DOM, no fetch, no React.

import { cardSignature, sidePlainText } from "./signature.js";

// What fc_cards.source records for each import route. The quiz bridge also
// stores the source question id in source_ref, so a card can be traced back to
// the question it came from.
export const SOURCES = {
  csv: "import",
  quiz: "quiz-bridge",
  pdf: "pdf-import",
  apkg: "apkg-import",
};

export const SOURCE_LABELS = {
  [SOURCES.csv]: "CSV / TSV import",
  [SOURCES.quiz]: "Quiz app bridge",
  [SOURCES.pdf]: "PDF / image import",
  [SOURCES.apkg]: "Anki deck import",
};

let sequence = 0;
function nextKey() {
  sequence += 1;
  return `candidate-${sequence}`;
}

// One side, as the bulk endpoint stores it. Text candidates are text-only;
// image candidates (PDF / page images) put an image block on the side instead.
export function textSide(text) {
  return { blocks: [{ type: "text", text: String(text ?? "") }] };
}

// An image-only side. `url` is the public storage URL (what the API stores);
// `path` is the object key (fc_media.storage_path); `previewUrl` is a local
// object URL used by the wizard before/while uploading and is stripped on the
// way out (keys starting with "_" never persist).
//
// `hash` is the pipeline's SHA-256 and *does* persist (fc_media.hash), so the
// sign endpoint can skip re-uploading identical bytes. `originalFile` /
// `originalUrl` / `originalBytes` are the pre-compression image and its size,
// kept under "_" keys so the review step can offer "Compare original /
// compressed" without writing a second URL into the saved card.
export function imageSide(
  url,
  {
    previewUrl,
    originalUrl,
    originalFile,
    originalBytes,
    width,
    height,
    alt,
    sourceRef,
    path,
    mime,
    bytes,
    hash,
  } = {}
) {
  const block = { type: "image", url };
  if (path) block.path = path;
  if (mime) block.mime = mime;
  if (bytes != null) block.bytes = bytes;
  if (hash) block.hash = hash;
  if (width) block.width = Math.round(width);
  if (height) block.height = Math.round(height);
  if (alt) block.alt = alt;
  if (sourceRef) block.source_ref = sourceRef;
  if (previewUrl) block._previewUrl = previewUrl;
  if (originalUrl) block._originalUrl = originalUrl;
  if (originalFile) block._originalFile = originalFile;
  if (originalBytes != null) block._originalBytes = originalBytes;
  return { blocks: [block] };
}

// Does this side carry anything a human would call content? Text blocks count
// when they have text; image/audio when they have a URL; ink when it has strokes
// or a preview. This is the media-aware replacement for "is block.text empty".
export function sideHasContent(side) {
  const blocks = side?.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    if (!block || typeof block !== "object") return false;
    if (block.type === "text") return typeof block.text === "string" && block.text.trim() !== "";
    if (block.type === "image" || block.type === "audio") {
      return typeof block.url === "string" && block.url.trim() !== "";
    }
    if (block.type === "ink") {
      return (Array.isArray(block.strokes) && block.strokes.length > 0) ||
        Boolean(block.preview && block.preview.url);
    }
    return true;
  });
}

// True when the side holds a media block at all - an image-only card is allowed
// to have an empty text back.
export function sideHasMedia(side) {
  const blocks = side?.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => block && (block.type === "image" || block.type === "audio" || block.type === "ink"));
}

// Drop wizard-only keys (anything starting with "_") from a block before it is
// serialised, so a local preview URL can never reach the database.
export function stripBlockKeys(block) {
  if (!block || typeof block !== "object") return block;
  const out = {};
  for (const [key, value] of Object.entries(block)) {
    if (!key.startsWith("_")) out[key] = value;
  }
  return out;
}

export function payloadSide(side) {
  const blocks = Array.isArray(side?.blocks) ? side.blocks : [];
  return { blocks: blocks.map(stripBlockKeys) };
}

export function candidateText(candidate, side = "front") {
  return sidePlainText(candidate?.[side]);
}

// Recompute the derived fields. Called after any edit to a side. An edit that
// introduces an error also unticks the card, so a row can never stay approved
// while it is broken; a clean edit leaves the user's tick alone.
//
// A card needs a front; the back may be empty when the front is media (an
// image-only card), since the API accepts a block-less-of-text back.
export function withDerived(candidate) {
  const errors = [];
  if (!sideHasContent(candidate.front)) errors.push("missing front");
  if (!sideHasContent(candidate.back) && !sideHasMedia(candidate.front)) errors.push("missing back");
  return {
    ...candidate,
    signature: cardSignature(candidate.front),
    errors,
    approved: errors.length ? false : candidate.approved,
  };
}

// front / back accept either plain text (the normal case) or an already-built
// side object. approved defaults to "valid", so a clean row starts ticked and a
// broken one does not.
export function makeCandidate({
  key,
  front,
  back,
  tags = [],
  cardType = "basic",
  source = SOURCES.csv,
  sourceRef = null,
  categoryName = null,
  warnings = [],
  approved,
} = {}) {
  const derived = withDerived({
    key: key ?? nextKey(),
    card_type: cardType,
    front: typeof front === "string" ? textSide(front) : (front ?? textSide("")),
    back: typeof back === "string" ? textSide(back) : (back ?? textSide("")),
    tags: [...new Set(tags ?? [])],
    source,
    source_ref: sourceRef ?? null,
    // Optional target override: when a CSV maps a "category" column, each row
    // carries the name it should land under. Empty means "the category chosen
    // in step 2".
    categoryName: categoryName || null,
    warnings: [...warnings],
    signature: "",
    errors: [],
    approved: false,
  });

  return { ...derived, approved: approved ?? derived.errors.length === 0 };
}

export function setCandidateText(candidate, side, text) {
  return withDerived({ ...candidate, [side]: textSide(text) });
}

// Edit the text of a side while keeping any media blocks it already carries.
// PDF/APKG sides can hold "text + image"; the review textarea should change the
// caption without dropping the picture. A text-only side is just replaced.
export function setCandidateSideText(candidate, side, text) {
  const blocks = candidate?.[side]?.blocks ?? [];
  const hasText = blocks.some((block) => block?.type === "text");
  const nextBlocks = hasText
    ? blocks.map((block) => (block?.type === "text" ? { ...block, text } : block))
    : [{ type: "text", text }, ...blocks];
  return withDerived({ ...candidate, [side]: { blocks: nextBlocks } });
}

// Accepts an array of tags, or a comma/space separated string from a single
// input box. Duplicates are dropped and blanks ignored.
export function setCandidateTags(candidate, value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
  return { ...candidate, tags: [...new Set(list)] };
}

export function setCandidateApproved(candidate, approved) {
  return { ...candidate, approved: Boolean(approved) };
}

// The optional per-row target override from a mapped CSV category column.
export function setCandidateCategory(candidate, name) {
  return { ...candidate, categoryName: String(name ?? "").trim() || null };
}

// A row can only be imported when the user has ticked it and it has no
// blocking errors left.
export function isImportable(candidate) {
  return Boolean(candidate?.approved) && (candidate?.errors?.length ?? 0) === 0;
}

// The exact shape POST /api/flash/cards/bulk validates. Everything else on the
// candidate (key, signature, errors, warnings) is wizard-only and is stripped
// here rather than at the call site, so no bookkeeping can leak into the API.
export function toCardPayload(candidate, categoryId) {
  const payload = {
    category_id: Number(categoryId),
    card_type: candidate?.card_type ?? "basic",
    front: payloadSide(candidate?.front),
    back: payloadSide(candidate?.back),
    tags: candidate?.tags ?? [],
  };
  if (candidate?.source) payload.source = candidate.source;
  if (candidate?.source_ref) payload.source_ref = candidate.source_ref;
  return payload;
}
