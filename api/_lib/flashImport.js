// Shared helpers for the import endpoints (api/_flash/import/*).
//
// Lives in api/_lib/ on purpose: files here are shared libraries, not routes,
// so they are excluded from the "every handler must be wired into the router"
// and "count real Vercel functions" checks in scripts/verify_routing.mjs.
//
// Two jobs live here:
//   1. validating the fields PATCH/POST accept on an fc_import_jobs row, so
//      every import endpoint answers with the same { error } shape;
//   2. turning a category's existing card fronts into the signatures the
//      wizard's duplicate detection compares against. The signature function
//      itself is shared with the browser (src/modules/flashcards/importers/
//      signature.js) so a duplicate is recognised identically on both sides.

import { cardSignature } from "../../src/modules/flashcards/importers/signature.js";
import { optionalInt, requiredString } from "./flashCards.js";

// fc_import_jobs.status moves pending -> running -> done | failed. The column
// has no CHECK constraint (db/flash_001.sql is additive), so the allowed set is
// enforced here instead.
export const IMPORT_JOB_STATUSES = new Set(["pending", "running", "done", "failed"]);

export const MAX_SOURCE_TYPE_LENGTH = 50;
export const MAX_FILENAME_LENGTH = 200;

// error_log is JSONB, so anything JSON-shaped is legal; the cap keeps a single
// job row from growing without bound when a very large import fails row by row.
export const MAX_IMPORT_JOB_ERRORS = 500;

// How many card fronts one duplicate check will look at. A category bigger than
// this is scanned up to the cap - duplicate detection is a convenience, not a
// guarantee, and an unbounded scan would stall the wizard.
export const MAX_SIGNATURE_CARDS = 50_000;

// A non-empty source tag such as "csv" or "quiz".
export function validateSourceType(value) {
  const parsed = requiredString(value, "source_type", MAX_SOURCE_TYPE_LENGTH);
  if (parsed.error) return parsed;
  return { value: parsed.value };
}

export function validateFilename(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  return requiredString(value, "filename", MAX_FILENAME_LENGTH);
}

export function validateJobStatus(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string" || !IMPORT_JOB_STATUSES.has(value)) {
    return { error: `status must be one of ${[...IMPORT_JOB_STATUSES].join(", ")}` };
  }
  return { value };
}

export function validateCount(value, label) {
  return optionalInt(value, label, { min: 0, max: 1_000_000 });
}

// Normalises an error_log payload into a JSON-serialisable array. Accepts an
// array of strings or of objects; anything else is rejected, and the list is
// truncated to MAX_IMPORT_JOB_ERRORS so one row cannot bloat.
export function validateErrorLog(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === "") return { value: [] };
  if (!Array.isArray(value)) return { error: "error_log must be an array" };

  const out = [];
  for (const entry of value.slice(0, MAX_IMPORT_JOB_ERRORS)) {
    if (typeof entry === "string") {
      out.push(entry.slice(0, 1000));
    } else if (entry && typeof entry === "object") {
      out.push(entry);
    } else {
      return { error: "error_log entries must be strings or objects" };
    }
  }
  return { value: out };
}

// The fronts of every card already in a category. Capped so a huge category
// cannot stall the wizard; the caller turns these into signatures.
export const CATEGORY_CARD_FRONTS_SQL = `
  SELECT front FROM fc_cards
  WHERE category_id = $1 AND user_id = $2
  LIMIT $3
`;

export function categoryFrontsArgs(categoryId, uid) {
  return [categoryId, uid, MAX_SIGNATURE_CARDS];
}

// The comparable signatures for a set of card fronts. Blank fronts are dropped:
// an empty signature matches everything and must never be reported as a
// duplicate of another blank front.
export function signaturesFromFronts(rows) {
  const signatures = new Set();
  for (const row of rows ?? []) {
    const signature = cardSignature(row?.front);
    if (signature) signatures.add(signature);
  }
  return [...signatures];
}
