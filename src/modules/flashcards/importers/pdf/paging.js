// Pure page arithmetic for the PDF importer: turning a typed range into page
// numbers, and grouping an ordered list of pages into front/back pairs.
//
// No DOM, no pdf.js. The UI owns the "which pages are blank" decision (it needs
// pixels for that) and hands the surviving page order here.

// Parse a page-range string like "1-3, 5, 7-10" into sorted, unique 0-based page
// indexes. An empty string (or "all") means every page.
//
// Returns { pages, error }. On a bad token, pages is what parsed cleanly so
// far and error explains the problem, so the UI can keep showing the previous
// selection while the user is mid-edit.
export function parsePageRange(input, pageCount) {
  const count = Math.max(0, Number(pageCount) || 0);
  const all = Array.from({ length: count }, (_, i) => i);

  const text = String(input ?? "").trim();
  if (text === "" || /^all$/i.test(text)) return { pages: all };

  const seen = new Set();
  for (const rawPart of text.split(",")) {
    const part = rawPart.trim();
    if (part === "") continue;

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      let from = Number(range[1]);
      let to = Number(range[2]);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return { pages: [...seen].sort((a, b) => a - b), error: `“${part}” is not a page range` };
      }
      if (from > to) [from, to] = [to, from];
      if (from < 1 || to > count) {
        return { pages: [...seen].sort((a, b) => a - b), error: `Pages must be between 1 and ${count}` };
      }
      for (let p = from; p <= to; p += 1) seen.add(p - 1);
      continue;
    }

    if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1 || p > count) {
        return { pages: [...seen].sort((a, b) => a - b), error: `Pages must be between 1 and ${count}` };
      }
      seen.add(p - 1);
      continue;
    }

    return { pages: [...seen].sort((a, b) => a - b), error: `“${part}” is not a page or range` };
  }

  return { pages: [...seen].sort((a, b) => a - b) };
}

// Collapse sorted 0-based indexes back into a compact "1-3,5" string.
export function formatPageRange(indexes) {
  const sorted = [...new Set(indexes ?? [])].sort((a, b) => a - b);
  if (!sorted.length) return "";

  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const value = sorted[i];
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    start = value;
    prev = value;
  }
  parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
  return parts.join(", ");
}

export function pairKey(a, b) {
  return `pair:${Math.min(a, b)}-${Math.max(a, b)}`;
}

// Group an ordered list of pages into front/back pairs.
//
//   offset 0 (default): (0,1) (2,3) (4,5) ...
//   offset 1           :  0  (1,2) (3,4) ...   - "shift pairing by one page",
//                        which is what a two-sided export with a leading cover
//                        (or a missing first page) needs.
//
// `swap` flips which page of each pair is the front. Pages that end up without a
// partner are returned in `unpaired` (in page order) so the UI can show them.
export function pairPages(pageIndexes, { offset = 0, swap = false } = {}) {
  const order = Array.isArray(pageIndexes) ? pageIndexes : [];
  const start = offset % 2 === 1 ? 1 : 0;

  const pairs = [];
  const unpaired = [];

  for (let i = 0; i < start && i < order.length; i += 1) unpaired.push(order[i]);

  for (let i = start; i < order.length; i += 2) {
    if (i + 1 < order.length) {
      const a = order[i];
      const b = order[i + 1];
      const key = pairKey(a, b);
      pairs.push(swap ? { key, front: b, back: a } : { key, front: a, back: b });
    } else {
      unpaired.push(order[i]);
    }
  }

  return { pairs, unpaired };
}

// Drop blank pages from an ordered page list, preserving order.
export function skipBlankPages(pageIndexes, blankIndexes) {
  const blank = blankIndexes instanceof Set ? blankIndexes : new Set(blankIndexes ?? []);
  return (pageIndexes ?? []).filter((page) => !blank.has(page));
}

// The optional "one card per page" plan (Mode C).
export function pagesToSingles(pageIndexes) {
  return (pageIndexes ?? []).map((page) => ({ key: `page:${page}`, front: page, back: null }));
}
