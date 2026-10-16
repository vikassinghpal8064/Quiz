// Pure helpers for card "sides" - the { blocks: [...] } shape stored in
// fc_cards.front / fc_cards.back (see api/_lib/flashCards.js validateSide).
//
// No React and no Tiptap import on purpose: the rich-text editor builds these
// objects, the viewer renders them, and the unit tests exercise them - all
// without a DOM. A text block keeps BOTH a plain string (block.text, the value
// the API stores and searches with ILIKE) and the rich Tiptap JSON (block.doc,
// an extra key validateSide preserves). Media blocks (image / audio / ink) are
// stored verbatim.
//
// The ink defaults are duplicated here (rather than imported from lib/ink.js) so
// this helper module stays dependency-free like the rest of blocks.js.
const DEFAULT_INK_WIDTH = 1200;
const DEFAULT_INK_HEIGHT = 800;

// Client-only identity so React keeps the right editor mounted while a block
// stack is reordered / an item removed. Never persisted: toPayloadSide() drops
// every key starting with "_".
let seq = 0;
export function nextBlockKey() {
  seq += 1;
  return `blk_${seq}`;
}

export function textBlock(text = "", doc = null) {
  const block = { type: "text", text, _key: nextBlockKey() };
  if (doc) block.doc = doc;
  return block;
}

// A media block starts without a URL: it exists so the editor can render an
// uploader in place. toPayloadSide() drops it while it is still empty, so an
// abandoned "Add image" never reaches the API (validateSide requires a url).
export function imageBlock(props = {}) {
  return { type: "image", url: "", ...props, _key: nextBlockKey() };
}

export function audioBlock(props = {}) {
  return { type: "audio", url: "", ...props, _key: nextBlockKey() };
}

// A handwriting block: vector strokes in its logical coordinate space plus an
// optional rendered PNG preview (block.preview). The strokes are the source of
// truth; the preview is only a fast way to show it (and to import it). Sized to
// the module's default surface.
export function inkBlock(props = {}) {
  return {
    type: "ink",
    width: DEFAULT_INK_WIDTH,
    height: DEFAULT_INK_HEIGHT,
    background: "blank",
    strokes: [],
    ...props,
    _key: nextBlockKey(),
  };
}

// An image / audio block is empty until it points at an uploaded blob.
export function isMediaBlockEmpty(block) {
  if (!block || (block.type !== "image" && block.type !== "audio")) return false;
  return typeof block.url !== "string" || block.url.trim() === "";
}

// An ink block is empty until it has at least one stroke or a preview image.
export function isInkBlockEmpty(block) {
  if (!block || block.type !== "ink") return false;
  const hasStrokes = Array.isArray(block.strokes) && block.strokes.length > 0;
  const hasPreview =
    block.preview && typeof block.preview.url === "string" && block.preview.url.trim() !== "";
  return !hasStrokes && !hasPreview;
}

// Flatten a Tiptap JSON document to plain text. Used to keep block.text in sync
// with the rich editor and to fold cloze / math content into a search string.
export function deriveTextFromDoc(doc) {
  if (!doc || typeof doc !== "object") return "";
  const out = [];
  walk(doc, out);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(node, out) {
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "text":
      out.push(node.text ?? "");
      return;
    case "hardBreak":
      out.push("\n");
      return;
    case "inlineMath":
      out.push(`$${node.attrs?.latex ?? ""}$`);
      return;
    case "blockMath":
      out.push(`\n$$${node.attrs?.latex ?? ""}$$\n`);
      return;
    case "horizontalRule":
      out.push("\n");
      return;
    case "paragraph":
    case "heading":
    case "listItem":
    case "blockquote":
    case "codeBlock":
      for (const child of node.content ?? []) walk(child, out);
      out.push("\n");
      return;
    default:
      for (const child of node.content ?? []) walk(child, out);
  }
}

// A text block is empty when it has neither plain text nor rich content. Used to
// drop blank blocks before saving so the database never fills with empty rows.
export function isTextBlockEmpty(block) {
  if (!block || block.type !== "text") return false;
  const hasText = typeof block.text === "string" && block.text.trim() !== "";
  if (hasText) return false;
  const fromDoc = block.doc ? deriveTextFromDoc(block.doc) : "";
  return fromDoc.trim() === "";
}

// True when a side has no durable content at all (media blocks count).
export function isSideEmpty(side) {
  const blocks = side?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return true;
  return blocks.every((block) => {
    if (!block) return true;
    if (block.type === "text") return isTextBlockEmpty(block);
    if (block.type === "image" || block.type === "audio") return isMediaBlockEmpty(block);
    if (block.type === "ink") return isInkBlockEmpty(block);
    return false;
  });
}

export function sidePlainText(side) {
  const blocks = side?.blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block && block.type === "text")
    .map((block) => {
      if (typeof block.text === "string" && block.text.trim()) return block.text.trim();
      return deriveTextFromDoc(block.doc);
    })
    .filter(Boolean)
    .join("\n");
}

// Drop client-only keys ({ _key, ... }) from a block before it is serialised.
export function stripTransient(block) {
  const out = {};
  for (const [key, value] of Object.entries(block)) {
    if (!key.startsWith("_")) out[key] = value;
  }
  return out;
}

// Turn an editor side into the exact shape the API stores: empty text blocks are
// dropped, transient keys stripped, block.text guaranteed to hold plain text.
export function toPayloadSide(side) {
  const blocks = Array.isArray(side?.blocks) ? side.blocks : [];
  const out = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") {
      if (isTextBlockEmpty(block)) continue;
      const text =
        typeof block.text === "string" && block.text.trim() ? block.text : deriveTextFromDoc(block.doc);
      const clean = { type: "text", text };
      if (block.doc) clean.doc = block.doc;
      out.push(clean);
    } else {
      // An image / audio block without an uploaded url is an empty uploader;
      // drop it so the API never sees a url-less media block.
      if ((block.type === "image" || block.type === "audio") && isMediaBlockEmpty(block)) continue;
      // Likewise a handwriting block with nothing drawn and no preview.
      if (block.type === "ink" && isInkBlockEmpty(block)) continue;
      out.push(stripTransient(block));
    }
  }
  return { blocks: out };
}

// Normalise a stored side (legacy plain card or a rich one) into an editor side
// with stable block keys, so it can round-trip through BlockStackEditor.
export function normalizeSide(side) {
  const blocks = Array.isArray(side?.blocks) ? side.blocks : [];
  return {
    blocks: blocks.map((block) => {
      if (block && block.type === "text") {
        const normalised = {
          type: "text",
          text: typeof block.text === "string" ? block.text : "",
          _key: nextBlockKey(),
        };
        if (block.doc) normalised.doc = block.doc;
        return normalised;
      }
      if (block && block.type === "ink") {
        return {
          ...block,
          width: Number.isFinite(block.width) ? block.width : DEFAULT_INK_WIDTH,
          height: Number.isFinite(block.height) ? block.height : DEFAULT_INK_HEIGHT,
          background: typeof block.background === "string" ? block.background : "blank",
          strokes: Array.isArray(block.strokes) ? block.strokes : [],
          _key: nextBlockKey(),
        };
      }
      return { ...block, _key: nextBlockKey() };
    }),
  };
}
