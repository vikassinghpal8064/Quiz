// Pure helpers for the Anki `.apkg` importer.
//
// An Anki collection stores a note's fields as one blob separated by the unit
// separator (0x1f), and the field names live on the *notetype* (model). This
// module turns those two facts into plain data the wizard can show and map:
// field lists, default front/back indices, stripped text, tags and the media
// name table. Everything here is pure - the SQLite/zip plumbing lives in
// `apkg/load.js` and the upload plumbing in `apkg/build.js`.
//
// Pure: no DOM, no fetch, no React, no sql.js.

export const ANKI_FIELD_SEP = "\u001f";

// Anki wraps line breaks in <br>/<div> and stores sounds as [sound:file]. Turn a
// field's HTML into something readable: block tags become newlines, the rest of
// the tags are dropped, a handful of entities are decoded, and sound refs go.
export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\[sound:[^\]]*\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// `<img src="...">` references, in document order. Anki stores media by its
// original filename in the field text; the zip holds it under a number.
export function extractImageRefs(html) {
  const refs = [];
  const re = /<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi;
  const text = String(html ?? "");
  let match = re.exec(text);
  while (match) {
    refs.push(match[1]);
    match = re.exec(text);
  }
  return refs;
}

// A note's fields, split on the unit separator. An empty string yields one
// empty field, which is what Anki itself does.
export function splitFields(flds) {
  return String(flds ?? "").split(ANKI_FIELD_SEP);
}

// Anki stores tags as a space-separated string padded with spaces.
export function parseAnkiTags(tags) {
  return String(tags ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// The notetype (model) name, tolerating a missing/garbage models blob.
export function notetypeName(notetype, mid) {
  return notetype?.name || `Notetype ${mid}`;
}

// The ordered field names of a notetype, e.g. ["Front", "Back", "Notes"].
export function notetypeFieldNames(notetype) {
  const flds = notetype?.flds;
  if (!Array.isArray(flds)) return [];
  return flds
    .slice()
    .sort((a, b) => (a?.ord ?? 0) - (b?.ord ?? 0))
    .map((field, index) => field?.name || `Field ${index + 1}`);
}

// The notetypes that actually have notes, with their note counts, newest-ish
// order preserved from the models blob.
export function notetypesWithCounts(notetypes, notes) {
  const counts = new Map();
  for (const note of notes ?? []) {
    counts.set(note.mid, (counts.get(note.mid) ?? 0) + 1);
  }
  return Object.entries(notetypes ?? {})
    .map(([mid, notetype]) => ({
      mid,
      name: notetypeName(notetype, mid),
      fieldNames: notetypeFieldNames(notetype),
      count: counts.get(mid) ?? 0,
    }))
    .filter((entry) => entry.count > 0);
}

// Front = the first field; back = the rest, joined. That matches the common
// Basic/Front-Back notetypes and is a sensible starting point for the rest.
export function defaultFieldMapping(notetype) {
  const fieldNames = notetypeFieldNames(notetype);
  const front = 0;
  const back = fieldNames.length > 1 ? [1] : [];
  return { front, back };
}

// Strip and join the chosen field indices, dropping blanks, so a Back built from
// several fields does not open with a run of empty lines.
export function fieldText(fields, indices) {
  return (indices ?? [])
    .map((index) => stripHtml(fields?.[index] ?? ""))
    .filter((text) => text !== "")
    .join("\n\n");
}

// The `media` file in an .apkg is a JSON object mapping the numeric zip entry
// (as a string) to the original filename. Anything else (a newer SQLite media
// db, a truncated file) is treated as "no media map".
export function parseMediaMap(json) {
  let parsed = json;
  if (typeof json === "string") {
    try {
      parsed = JSON.parse(json);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  for (const [number, name] of Object.entries(parsed)) {
    if (typeof name === "string" && name) out[String(number)] = name;
  }
  return out;
}

// name -> zip entry number, so a field's `<img src="cat.jpg">` can find the
// zip entry named "3". Later duplicates win, which is harmless.
export function invertMediaMap(mediaMap) {
  const out = {};
  for (const [number, name] of Object.entries(mediaMap ?? {})) {
    out[name] = String(number);
  }
  return out;
}

// Turn a media shelf into a front/back summary the review UI can label, e.g.
// "2 images". Only images are counted; sounds are dropped by the importer.
export function countMediaRefs(html) {
  return extractImageRefs(html).length;
}
