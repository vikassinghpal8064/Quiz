// The CSV / TSV importer.
//
// Built on the pure parser in lib/importParse.js (delimiter detection, RFC-4180
// quoting, tag splitting) but adds the two things the wizard needs on top: a
// fourth, optional "category" column, and an inspect step so the column-mapping
// UI can show headers and re-parse with a different mapping without re-reading
// the file.
//
// The importer descriptor follows the registry contract -
// { id, label, accepts, parse } - plus `inspect`, which the wizard uses for the
// mapping controls and the 20-row preview. `parse` honours a mapping passed in
// `options`, so the wizard inspects once, lets the user adjust, then parses.

import { detectDelimiter, looksLikeHeader, parseDelimited, splitTags } from "../lib/importParse.js";
import { SOURCES, makeCandidate } from "./candidate.js";

export const CSV_IMPORTER_ID = "csv";

// How many rows the preview step shows before scrolling. The prompt for this
// screen asks for the first 20.
export const PREVIEW_ROWS = 20;

// "No column" - the user has chosen not to map this field.
export const NO_COLUMN = -1;

// Header aliases, matched case-insensitively against a trimmed, single-spaced
// header cell. Category is optional: when nothing matches, every row simply
// lands in the category chosen in step 2.
const FRONT_ALIASES = ["front", "question", "term", "prompt", "word", "q", "ask", "问"];
const BACK_ALIASES = ["back", "answer", "definition", "meaning", "translation", "a", "response", "答"];
const TAGS_ALIASES = ["tags", "tag", "labels", "label", "topics", "topic", "keywords"];
const CATEGORY_ALIASES = ["category", "cat", "subject", "group", "collection", "section", "deck", "folder"];

export const MAPPING_FIELDS = [
  { field: "front", label: "Front", required: true, aliases: FRONT_ALIASES },
  { field: "back", label: "Back", required: true, aliases: BACK_ALIASES },
  { field: "tags", label: "Tags", required: false, aliases: TAGS_ALIASES },
  { field: "category", label: "Category", required: false, aliases: CATEGORY_ALIASES },
];

function normalizeHeader(cell) {
  return String(cell ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(headers, aliases) {
  const names = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const hit = names.indexOf(alias);
    if (hit !== -1) return hit;
  }
  return NO_COLUMN;
}

function pickCell(cells, column) {
  if (column < 0 || column >= cells.length) return "";
  return String(cells[column] ?? "");
}

function isBlankRow(cells) {
  return cells.every((cell) => String(cell ?? "").trim() === "");
}

export function delimiterLabel(delimiter) {
  if (delimiter === "\t") return "tab";
  if (delimiter === ",") return "comma";
  if (delimiter === ";") return "semicolon";
  if (delimiter === "|") return "pipe";
  return "unknown";
}

// inspectCsv(text, options) -> {
//   delimiter, guessedDelimiter, hadHeader, guessedHeader,
//   headers, columns: { front, back, tags, category }, rows, rowCount,
// }
//
// options.delimiter / options.header force those choices; options.frontColumn,
// backColumn, tagsColumn and categoryColumn force a mapping. Everything left
// out is guessed.
export function inspectCsv(text, options = {}) {
  const raw = String(text ?? "");
  const guessedDelimiter = detectDelimiter(raw);
  const delimiter = options.delimiter || guessedDelimiter;

  // Kept unfiltered: row numbers must match the original text, so blanks are
  // skipped while the rows are built rather than before.
  const records = parseDelimited(raw, delimiter);
  const firstNonBlank = records.find((cells) => !isBlankRow(cells));

  const guessedHeader = firstNonBlank ? looksLikeHeader(firstNonBlank) : false;
  const hadHeader = options.header === undefined ? guessedHeader : Boolean(options.header);
  const headers = hadHeader ? firstNonBlank ?? [] : [];

  // The header is the first non-blank row, so a leading blank line does not
  // push it out of position.
  const bodyStart = hadHeader && firstNonBlank ? records.indexOf(firstNonBlank) + 1 : 0;

  // Guessing: with a header row we look for known names; without one we fall
  // back to the positional convention (1st column front, 2nd back).
  const guessed = hadHeader
    ? {
        front: findColumn(headers, FRONT_ALIASES),
        back: findColumn(headers, BACK_ALIASES),
        tags: findColumn(headers, TAGS_ALIASES),
        category: findColumn(headers, CATEGORY_ALIASES),
      }
    : { front: 0, back: 1, tags: NO_COLUMN, category: NO_COLUMN };

  // front and back always resolve to something usable so a headerless or oddly
  // named file still produces a preview the user can correct by hand.
  if (guessed.front === NO_COLUMN) guessed.front = 0;
  if (guessed.back === NO_COLUMN) guessed.back = 1;

  const columns = {
    front: options.frontColumn ?? guessed.front,
    back: options.backColumn ?? guessed.back,
    tags: options.tagsColumn ?? guessed.tags,
    category: options.categoryColumn ?? guessed.category,
  };

  const rows = [];
  for (let i = bodyStart; i < records.length; i += 1) {
    const cells = records[i];
    if (isBlankRow(cells)) continue;
    rows.push({
      // 1-based position in the parsed records, i.e. the row's line in the
      // original text.
      line: i + 1,
      cells,
      front: pickCell(cells, columns.front).trim(),
      back: pickCell(cells, columns.back).trim(),
      tags: columns.tags >= 0 ? splitTags(pickCell(cells, columns.tags)) : [],
      category: columns.category >= 0 ? pickCell(cells, columns.category).trim() : "",
    });
  }

  return {
    delimiter,
    guessedDelimiter,
    hadHeader,
    guessedHeader,
    headers,
    columns,
    rows,
    rowCount: rows.length,
  };
}

// inspect() plus one candidate per row. Candidates whose front or back is blank
// carry a blocking error and start unapproved, so the review step can show them
// as skipped rather than silently dropping them.
export function buildCandidates(text, options = {}) {
  const inspected = inspectCsv(text, options);
  const sourceRef = options.sourceRef ?? null;

  const candidates = inspected.rows.map((row) =>
    makeCandidate({
      key: `row-${row.line}`,
      front: row.front,
      back: row.back,
      tags: row.tags,
      categoryName: row.category || null,
      source: options.source ?? SOURCES.csv,
      sourceRef,
    })
  );

  return { inspected, candidates };
}

// Accepts a File (or anything with .text()) or the text itself.
async function readText(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.text === "function") return await input.text();
  return "";
}

const csvImporter = {
  id: CSV_IMPORTER_ID,
  label: "CSV / TSV file",

  // Anything that looks like a delimited text file, or is simply text. Binary
  // sources (a PDF, page images) are explicitly rejected so importerFor() routes
  // them to the PDF importer rather than trying to read them as text.
  accepts(input) {
    if (typeof input === "string") return true;
    if (!input || typeof input !== "object") return false;
    if (typeof input.name === "string" && /\.(pdf|png|jpe?g|webp|gif|bmp|avif|heic|apkg)$/i.test(input.name)) {
      return false;
    }
    if (typeof input.type === "string" && (input.type === "application/pdf" || input.type.startsWith("image/"))) {
      return false;
    }
    if (typeof input.name === "string" && /\.(csv|tsv|txt)$/i.test(input.name)) return true;
    return typeof input.text === "function";
  },

  // Contract entry point: file -> candidates[].
  async parse(input, options = {}) {
    const text = await readText(input);
    const sourceRef = options.sourceRef ?? (input && input.name ? input.name : null);
    return buildCandidates(text, { ...options, sourceRef }).candidates;
  },

  // Extra, used by the wizard for the column-mapping UI and the preview.
  inspect: inspectCsv,
};

export default csvImporter;
