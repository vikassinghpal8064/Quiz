// Pure parser behind the Import screen.
//
// Turns pasted or uploaded CSV/TSV into the card payloads POST
// /api/flash/cards/bulk expects. Everything here is a pure function of its
// input - no DOM, no fetch - so the column guessing, quoting and tag splitting
// can be unit-tested directly.
//
// A file is "delimiter separated": either a tab (TSV, the shape Anki exports)
// or a comma (CSV). Fields may be quoted with double quotes, quotes are escaped
// by doubling them, and a quoted field may contain the delimiter or a newline.

// Kept in step with api/_lib/flashCards.js and TagInput.jsx.
export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 64;
export const MAX_BULK_CARDS = 500;

// Header aliases. Matching is case-insensitive and ignores surrounding space.
const FRONT_ALIASES = ["front", "question", "term", "prompt", "word", "q", "问"];
const BACK_ALIASES = ["back", "answer", "definition", "meaning", "translation", "a", "答"];
const TAGS_ALIASES = ["tags", "tag", "labels", "label", "topics", "topic", "deck"];

function normalizeHeader(cell) {
  return String(cell ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(headers, aliases) {
  for (let i = 0; i < headers.length; i += 1) {
    if (aliases.includes(normalizeHeader(headers[i]))) return i;
  }
  return -1;
}

// Tab wins when it appears at all: a TSV field may legitimately contain a comma
// (e.g. "Paris, France"), so the presence of a tab is the stronger signal.
export function detectDelimiter(text) {
  const sample = String(text ?? "").split(/\r?\n/).slice(0, 20).join("\n");
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  return tabs > 0 && tabs >= commas ? "\t" : ",";
}

// Split one delimiter-separated string into rows of cells (RFC-4180-ish).
export function parseDelimited(text, delimiter = ",") {
  const s = String(text ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let started = false; // has this row seen any character yet?

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      started = true;
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    if (ch === "\r") {
      continue; // swallow CR so CRLF and CR both become a row break
    }
    field += ch;
    started = true;
  }

  // Flush the final field/row unless the input ended on a newline (which we have
  // already emitted) with nothing pending.
  if (started || field !== "" || row.length > 0) {
    endRow();
  }

  return rows;
}

function isBlankRow(cells) {
  return cells.every((cell) => String(cell ?? "").trim() === "");
}

// Does the first non-empty row name its columns? Require at least two known
// names so a two-column data row like "ask,answer" is not mistaken for a header.
export function looksLikeHeader(cells) {
  const names = cells.map(normalizeHeader);
  const hits = ["front", "back", "tags"]
    .map((kind) => {
      const aliases = kind === "front" ? FRONT_ALIASES : kind === "back" ? BACK_ALIASES : TAGS_ALIASES;
      return names.some((n) => aliases.includes(n));
    })
    .filter(Boolean).length;
  return hits >= 2;
}

// A tag cell may hold several tags; split on the usual separators and clean up.
export function splitTags(value) {
  const parts = String(value ?? "")
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const seen = new Set();
  const tags = [];
  for (const part of parts) {
    const trimmed = part.slice(0, MAX_TAG_LENGTH);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function pick(cells, column) {
  if (column < 0 || column >= cells.length) return "";
  return String(cells[column] ?? "");
}

// parseImport(text, options) -> {
//   delimiter, hadHeader,
//   columns: { front, back, tags },   // 0-based indices, -1 when absent
//   rows: [{ line, front, back, tags, issues }],
//   errors: string[],
// }
//
// options.delimiter   force a delimiter (default: auto-detect)
// options.header      true/false to force header handling (default: auto)
// options.frontColumn / backColumn / tagsColumn   override a column index
export function parseImport(text, options = {}) {
  const delimiter = options.delimiter || detectDelimiter(text);
  const records = parseDelimited(text, delimiter).filter((cells) => !isBlankRow(cells));

  if (records.length === 0) {
    return {
      delimiter,
      hadHeader: false,
      columns: { front: 0, back: 1, tags: -1 },
      rows: [],
      errors: ["Nothing to import yet."],
    };
  }

  const hadHeader = options.header === undefined ? looksLikeHeader(records[0]) : Boolean(options.header);
  const headerCells = hadHeader ? records[0] : [];
  const body = hadHeader ? records.slice(1) : records;

  // Column indices: an explicit override beats a header name, which beats the
  // positional default of 0 = front, 1 = back, 2 = tags.
  const headerFront = hadHeader ? findColumn(headerCells, FRONT_ALIASES) : -1;
  const headerBack = hadHeader ? findColumn(headerCells, BACK_ALIASES) : -1;
  const headerTags = hadHeader ? findColumn(headerCells, TAGS_ALIASES) : -1;

  const frontColumn = options.frontColumn ?? (headerFront === -1 ? 0 : headerFront);
  const backColumn = options.backColumn ?? (headerBack === -1 ? 1 : headerBack);
  const tagsColumn = options.tagsColumn ?? (hadHeader ? headerTags : 2);

  // Line numbers below are 1-based positions in the original text, so the first
  // body record is line 1 (no header) or line 2 (header).
  const firstBodyLine = hadHeader ? 1 : 0;

  const rows = [];
  const errors = [];
  body.forEach((cells, i) => {
    const line = firstBodyLine + i + 1;
    const front = pick(cells, frontColumn).trim();
    const back = pick(cells, backColumn).trim();
    const tags = tagsColumn >= 0 ? splitTags(pick(cells, tagsColumn)) : [];

    const issues = [];
    if (!front) issues.push("missing front");
    if (!back) issues.push("missing back");
    const rawTagCount = pick(cells, tagsColumn).split(/[,;|]/).filter((t) => t.trim()).length;
    if (rawTagCount > MAX_TAGS) issues.push(`only the first ${MAX_TAGS} tags are kept`);

    if (issues.length) errors.push(`Line ${line}: ${issues.join(", ")}`);
    rows.push({ line, front, back, tags, issues });
  });

  return {
    delimiter,
    hadHeader,
    columns: { front: frontColumn, back: backColumn, tags: tagsColumn },
    rows,
    errors,
  };
}

// Rows that are ready to send (both sides present).
export function importableRows(parsed) {
  return (parsed?.rows ?? []).filter((row) => row.front && row.back);
}

// One text block per side, which is what the bulk endpoint stores.
function textSide(text) {
  return { blocks: [{ type: "text", text }] };
}

// Turn parsed rows into the objects POST /api/flash/cards/bulk accepts.
export function buildCards(rows, { categoryId, source = "import" } = {}) {
  return rows.map((row) => ({
    category_id: categoryId,
    card_type: "basic",
    front: textSide(row.front),
    back: textSide(row.back),
    tags: row.tags,
    source,
  }));
}

// Split into batches no larger than the bulk endpoint's limit.
export function chunkCards(cards, size = MAX_BULK_CARDS) {
  const out = [];
  for (let i = 0; i < cards.length; i += size) out.push(cards.slice(i, i + size));
  return out;
}
