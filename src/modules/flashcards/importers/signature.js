// The normalisation behind duplicate detection, shared by both sides of the
// import wizard.
//
// A "signature" is a card's front reduced to a comparable key. Two cards are
// duplicates of one another when their signatures match, which is what lets the
// wizard warn "this row already exists in the target category" before anything
// is written. The same function runs in the browser (to score the rows the user
// is importing) and on the server (to score the cards already in the category,
// see api/_flash/import/duplicates.js) - one definition, no drift.
//
// Deliberately conservative: fold case, fold the shape of whitespace and drop
// punctuation, but never drop a word. Two fronts that read the same to a human
// must produce the same signature, and two that read differently must not.
//
// Pure: no DOM, no fetch, no React - the API can import this module directly
// without pulling a single line of the app bundle in.

// The signature of a card with nothing on its front. Never treated as a
// duplicate: an empty key matches everything, so it has to be excluded.
export const EMPTY_SIGNATURE = "";

// Turns a string, a side object ({ blocks: [...] }) or a bare array of blocks
// into one plain string of text. Non-text blocks contribute nothing.
export function sidePlainText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;

  const blocks = Array.isArray(value) ? value : value.blocks;
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block) => {
      if (!block) return "";
      if (typeof block === "string") return block;
      return typeof block.text === "string" ? block.text : "";
    })
    .filter((part) => part !== "")
    .join(" ");
}

// Case-, width-, punctuation- and whitespace-insensitive key.
export function normalizeForSignature(value) {
  return sidePlainText(value)
    .normalize("NFKC")
    .toLowerCase()
    // Typographic apostrophes become plain ones so "don't" and "don\u2019t"
    // collapse together before punctuation is dropped anyway.
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// The signature of a card front. "" means "nothing to compare" and is never
// reported as a duplicate (see isSignatureComparable).
export function cardSignature(front) {
  return normalizeForSignature(front);
}

// Can this signature take part in duplicate detection at all?
export function isSignatureComparable(signature) {
  return typeof signature === "string" && signature !== EMPTY_SIGNATURE;
}
