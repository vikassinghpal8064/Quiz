// Shared helpers for the flash-card endpoints (api/_flash/*).
//
// Lives in api/_lib/ on purpose: files here are shared libraries, not routes,
// so they are excluded from the "every handler must be wired into the router"
// and "count real Vercel functions" checks in scripts/verify_routing.mjs.
//
// Pure validation + small SQL helpers only. Every flash endpoint uses these so
// the error shape ({ error: "..." }) and the limits stay in one place.

import { MAX_MEDIA_URL_LENGTH } from "./flashMedia.js";

// ---------- limits ----------

export const MAX_BLOCKS_PER_SIDE = 100;
export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 64;
export const MAX_BULK_CARDS = 500;
export const MAX_ID_LIST = 500;
export const MAX_CARD_SEARCH = 200;

// A card counts as "struggling" once its scheduler struggle_score reaches this
// point. struggle_score is a 0-1 signal (see src/modules/flashcards/lib/
// scheduler/struggle.js); 0.5 is the halfway mark - enough evidence of slow,
// repeated, or lapsed recall to single the card out. Kept here so the list
// endpoints and the (future) study screens agree on one number.
export const STRUGGLE_THRESHOLD = 0.5;

export const BLOCK_TYPES = new Set(["text", "image", "audio", "ink"]);

// Blocks whose content lives in Vercel Blob. Their URL / mime / byte size are
// mirrored into fc_media on save (see mediaRowsFromSides below).
export const MEDIA_BLOCK_TYPES = new Set(["image", "audio"]);

// ---------- missing-table guard ----------

// db/flash_001.sql is additive and is NOT assumed to have been applied. If it
// has not, Postgres answers a query against an fc_* table with SQLSTATE 42P01
// ("undefined_table"); without help that surfaces as a bare 500. Every flash
// handler runs the catch through sendMissingFlashTable() and returns a clear,
// actionable message instead.
//
// Apply with: paste db/flash_001.sql into the Neon SQL editor (or run it
// through the migration runner - see db/flash_001_down.sql to roll back).
export const FLASH_MIGRATION_HINT =
  "Flash-card tables are missing. Apply db/flash_001.sql to the database first.";

export function isMissingFlashTable(err) {
  return err?.code === "42P01" && /\bfc_/.test(err.message ?? "");
}

// Sends the 503 + hint and returns true for the missing-table case, so callers
// can `if (sendMissingFlashTable(res, err)) return;`.
export function sendMissingFlashTable(res, err) {
  if (!isMissingFlashTable(err)) return false;
  res.status(503).json({ error: FLASH_MIGRATION_HINT });
  return true;
}

// Flash rows are private to the signed-in account. user_id is TEXT in the
// schema (default 'local'), so a numeric user id is stringified consistently.
export function flashUserId(user) {
  return String(user.id);
}

// ---------- scalar validation ----------

// A positive integer id. Returns { value } or { error }.
export function parsePositiveInt(raw, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: `${label} must be a positive integer` };
  }
  return { value: n };
}

// A non-empty array of positive integers (de-duplicated). Returns { value } or
// { error }.
export function parseIdList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: `${label} must be a non-empty array of ids` };
  }
  if (value.length > MAX_ID_LIST) {
    return { error: `${label} must contain at most ${MAX_ID_LIST} ids` };
  }
  const ids = [];
  for (const item of value) {
    const n = Number(item);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: `${label} must contain only positive integers` };
    }
    ids.push(n);
  }
  return { value: [...new Set(ids)] };
}

export function requiredString(value, label, max = 200) {
  if (typeof value !== "string" || !value.trim()) {
    return { error: `${label} is required` };
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return { error: `${label} must be at most ${max} characters` };
  }
  return { value: trimmed };
}

// Optional string. Empty string / null / undefined collapses to null.
export function optionalString(value, label, max = 2000) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${label} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > max) {
    return { error: `${label} must be at most ${max} characters` };
  }
  return { value: trimmed };
}

export function optionalInt(value, label, { min = 0, max = 1_000_000 } = {}) {
  if (value === undefined || value === null || value === "") return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${label} must be an integer between ${min} and ${max}` };
  }
  return { value: n };
}

export function optionalBool(value, label) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "boolean") return { error: `${label} must be a boolean` };
  return { value };
}

// ---------- card content validation ----------

// A card side is { blocks: [...] } where each block is
// { type: 'text'|'image'|'audio'|'ink', ... }. Extra keys are preserved so the
// renderer can attach type-specific data without an API change.
// Returns { value } (the original object) or { error }.
export function validateSide(value, label) {
  if (value === undefined || value === null) {
    return { error: `${label} is required` };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: `${label} must be an object` };
  }
  const blocks = value.blocks;
  if (!Array.isArray(blocks)) {
    return { error: `${label}.blocks must be an array` };
  }
  if (blocks.length > MAX_BLOCKS_PER_SIDE) {
    return { error: `${label}.blocks must contain at most ${MAX_BLOCKS_PER_SIDE} blocks` };
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const where = `${label}.blocks[${i}]`;
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      return { error: `${where} must be an object` };
    }
    if (!BLOCK_TYPES.has(block.type)) {
      return { error: `${where}.type must be one of ${[...BLOCK_TYPES].join(", ")}` };
    }
    if (block.type === "text") {
      if (typeof block.text !== "string") {
        return { error: `${where}.text must be a string` };
      }
    } else if (block.type === "image" || block.type === "audio") {
      if (typeof block.url !== "string" || !block.url.trim()) {
        return { error: `${where}.url must be a non-empty string` };
      }
      if (block.url.length > MAX_MEDIA_URL_LENGTH) {
        return { error: `${where}.url must be at most ${MAX_MEDIA_URL_LENGTH} characters` };
      }
    } else if (block.type === "ink") {
      const hasData = typeof block.data === "string" && block.data.length > 0;
      const hasStrokes = Array.isArray(block.strokes);
      const hasPreview =
        block.preview && typeof block.preview.url === "string" && block.preview.url.trim();
      if (!hasData && !hasStrokes && !hasPreview) {
        return { error: `${where} must include a data string, a strokes array or a preview` };
      }
    }
  }

  return { value };
}

// Tags: an array of short, non-empty strings. Missing input yields [].
export function validateTags(value) {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value)) {
    return { error: "tags must be an array of strings" };
  }
  if (value.length > MAX_TAGS) {
    return { error: `tags must contain at most ${MAX_TAGS} items` };
  }
  const out = [];
  for (const tag of value) {
    if (typeof tag !== "string" || !tag.trim()) {
      return { error: "each tag must be a non-empty string" };
    }
    const trimmed = tag.trim();
    if (trimmed.length > MAX_TAG_LENGTH) {
      return { error: `each tag must be at most ${MAX_TAG_LENGTH} characters` };
    }
    out.push(trimmed);
  }
  return { value: [...new Set(out)] };
}

export function validateCardType(value) {
  if (value === undefined || value === null) return { value: "basic" };
  if (typeof value !== "string" || !value.trim()) {
    return { error: "card_type must be a non-empty string" };
  }
  const trimmed = value.trim();
  if (trimmed.length > 32) {
    return { error: "card_type must be at most 32 characters" };
  }
  return { value: trimmed };
}

// Escape the LIKE wildcards so a search for "50%" or "a_b" is literal.
export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ---------- card creation ----------

// Every card gets a scheduling row in the same statement (state = New, due =
// now), so a card can never exist without a state. The data-modifying CTE
// `new_state` runs even though the final SELECT reads `new_card`; that is what
// keeps this to one statement and one round trip.
//
// Parameters:
//   $1 user_id   $2 category_id   $3 card_type
//   $4 front::jsonb   $5 back::jsonb   $6 tags::text[]
//   $7 source    $8 source_ref
export const CREATE_CARD_SQL = `
  WITH new_card AS (
    INSERT INTO fc_cards (user_id, category_id, card_type, front, back, tags, source, source_ref)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8)
    RETURNING *
  ), new_state AS (
    INSERT INTO fc_card_state (card_id, user_id, state, due)
    SELECT id, $1, 0, now() FROM new_card
    RETURNING card_id, state, due, reps, lapses, stability, difficulty
  )
  SELECT c.*,
         s.state, s.due, s.reps, s.lapses, s.stability, s.difficulty
  FROM new_card c
  JOIN new_state s ON s.card_id = c.id
`;

// Argument list for CREATE_CARD_SQL. front/back are pre-validated and are
// stringified here so the jsonb cast is never fed a raw JS object.
export function createCardArgs(uid, card) {
  return [
    uid,
    card.categoryId,
    card.cardType,
    JSON.stringify(card.front ?? {}),
    JSON.stringify(card.back ?? {}),
    card.tags ?? [],
    card.source ?? null,
    card.sourceRef ?? null,
  ];
}

// ---------- media ----------

// fc_media.bytes is INT; PostgreSQL INT is 32-bit. A block's `bytes` comes from
// the client, so normalise it into range (or null) before it reaches the column.
const INT32_MAX = 2147483647;

function normaliseBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), INT32_MAX);
}

function normaliseMime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, 200);
}

function collectMediaRows(side, sideName, out) {
  const blocks = Array.isArray(side?.blocks) ? side.blocks : [];
  for (const block of blocks) {
    if (!block) continue;
    if (MEDIA_BLOCK_TYPES.has(block.type)) {
      if (typeof block.url !== "string" || !block.url.trim()) continue;
      out.push({
        side: sideName,
        kind: block.type,
        url: block.url.trim(),
        mime: normaliseMime(block.mime),
        bytes: normaliseBytes(block.bytes),
      });
    } else if (block.type === "ink") {
      // An ink block's bytes live in its rendered PNG preview (block.preview),
      // not on the block itself. Mirroring that URL into fc_media keeps the
      // orphan-blob cleanup uniform: deleting a card still removes its preview.
      const preview = block.preview;
      if (!preview || typeof preview.url !== "string" || !preview.url.trim()) continue;
      out.push({
        side: sideName,
        kind: "ink",
        url: preview.url.trim(),
        mime: normaliseMime(preview.mime),
        bytes: normaliseBytes(preview.bytes),
      });
    }
  }
}

// The fc_media rows a card's two sides imply. Blocks are the source of truth:
// the client uploads a blob, stores its URL (plus mime / bytes / dimensions) in
// block JSON, and the server mirrors that into fc_media on save.
export function mediaRowsFromSides(front, back) {
  const rows = [];
  collectMediaRows(front, "front", rows);
  collectMediaRows(back, "back", rows);
  return rows;
}

// Replace a card's media rows with the ones its blocks reference. The delete and
// the insert share one statement through a data-modifying CTE, so a save is a
// single round trip. Parameters: $1 card_id, $2 user_id, $3 rows::jsonb.
export const REPLACE_CARD_MEDIA_SQL = `
  WITH removed AS (
    DELETE FROM fc_media WHERE card_id = $1 AND user_id = $2
  )
  INSERT INTO fc_media (user_id, card_id, side, kind, url, mime, bytes)
  SELECT $2, $1, m.side, m.kind, m.url, m.mime, m.bytes
  FROM jsonb_to_recordset($3::jsonb)
       AS m(side text, kind text, url text, mime text, bytes int)
  RETURNING id
`;

export function replaceCardMediaArgs(cardId, uid, rows) {
  return [cardId, uid, JSON.stringify(rows ?? [])];
}

// Every blob URL a card still owns; read just before the card is deleted so the
// blobs can be removed from the store once the rows have cascaded away.
export const SELECT_CARD_MEDIA_URLS_SQL = `
  SELECT DISTINCT url FROM fc_media
  WHERE card_id = $1 AND user_id = $2 AND url IS NOT NULL
`;
