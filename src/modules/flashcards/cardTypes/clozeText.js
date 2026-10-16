// Pure cloze arithmetic. A cloze card stores its raw source text (with
// {{c1::answer}} markers) on the front side; the blanked question and the
// revealed answer are both derived from it, so nothing is duplicated on disk.
//
// Kept free of React / Tiptap so it can be unit-tested and reused by the editor
// preview and the viewer.
const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

// Every {{cN::...}} match, in document order.
export function findClozes(text) {
  const out = [];
  if (typeof text !== "string" || !text) return out;
  // The regex is global (stateful); reset lastIndex so sequential calls on
  // different strings cannot skip matches.
  CLOZE_RE.lastIndex = 0;
  let match;
  while ((match = CLOZE_RE.exec(text)) !== null) {
    out.push({
      num: Number(match[1]),
      answer: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

export function hasCloze(text) {
  return findClozes(text).length > 0;
}

export function clozeNumbers(text) {
  return [...new Set(findClozes(text).map((m) => m.num))].sort((a, b) => a - b);
}

// Split the raw text into renderable segments. With reveal=false every cloze
// becomes a '{blank}'; with reveal=true each becomes its answer. Plain text in
// between is passed through untouched.
export function clozeSegments(text, { reveal = false } = {}) {
  const src = typeof text === "string" ? text : "";
  const segments = [];
  let cursor = 0;
  for (const match of findClozes(src)) {
    if (match.start > cursor) segments.push({ kind: "text", value: src.slice(cursor, match.start) });
    segments.push({ kind: reveal ? "answer" : "blank", value: match.answer, num: match.num });
    cursor = match.end;
  }
  if (cursor < src.length) segments.push({ kind: "text", value: src.slice(cursor) });
  return segments;
}

// Answers-only text used for search (markers removed, answers kept), so a
// search for "powerhouse" finds the cloze card that hides it.
export function clozePlainText(text) {
  return clozeSegments(text, { reveal: true })
    .map((segment) => segment.value)
    .join("");
}

// A cloze card is only valid once at least one part is wrapped.
export function validateCloze(text) {
  if (typeof text !== "string" || !text.trim()) return "Add the cloze text.";
  if (!hasCloze(text)) return "Wrap at least one part in {{c1::answer}} to create a blank.";
  return null;
}
