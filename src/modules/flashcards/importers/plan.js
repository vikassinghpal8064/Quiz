// Pure planning for the import run: what to import, into which category, in
// what batches.
//
// The wizard calls these between the review step and the POSTs so that all the
// interesting decisions - which rows are duplicates, which category each row
// lands in, how the work is split into batches of 200 - are testable without a
// network, a database or a DOM.

import { isImportable, toCardPayload } from "./candidate.js";
import { isSignatureComparable } from "./signature.js";

// POST /api/flash/cards/bulk accepts up to 500 per call; the wizard deliberately
// sends smaller batches so progress is visible and a single failure costs at
// most 200 cards. (The endpoint's own ceiling lives in lib/importParse.js.)
export const BATCH_SIZE = 200;

export const DUPLICATE_EXISTING = "existing";
export const DUPLICATE_BATCH = "batch";

// Flag candidates that already exist in the target category, plus repeats
// within the import itself. Flagged rows start unticked: the user opts back in
// rather than silently creating a second copy of something they already have.
//
// existingSignatures come from GET /api/flash/import/duplicates. A candidate
// with no comparable signature (empty front) is never flagged.
export function markDuplicates(candidates = [], existingSignatures = []) {
  const existing = new Set((existingSignatures ?? []).filter(isSignatureComparable));
  const seen = new Map();

  return (candidates ?? []).map((candidate) => {
    const signature = candidate?.signature;
    if (!isSignatureComparable(signature)) return { ...candidate, duplicate: null };
    if (existing.has(signature)) {
      return { ...candidate, duplicate: DUPLICATE_EXISTING, approved: false };
    }
    if (seen.has(signature)) {
      return { ...candidate, duplicate: DUPLICATE_BATCH, approved: false };
    }
    seen.set(signature, candidate.key);
    return { ...candidate, duplicate: null };
  });
}

// Group the approved, valid candidates by the category they should land in.
//
// A candidate may carry a `categoryName` (from a mapped CSV category column);
// names that already exist in the target folder resolve to those categories,
// and anything left over is returned with categoryId: null so the run step can
// create it. Candidates with no categoryName go straight to targetCategoryId.
export function groupCandidates(candidates = [], { targetCategoryId, categories = [] } = {}) {
  const byName = new Map(
    (categories ?? []).map((category) => [String(category?.name ?? "").trim().toLowerCase(), category])
  );

  const groups = new Map();

  for (const candidate of candidates ?? []) {
    if (!isImportable(candidate)) continue;

    const name = String(candidate?.categoryName ?? "").trim();
    const key = name.toLowerCase();

    if (!groups.has(key)) {
      const match = name ? byName.get(key) : null;
      groups.set(key, {
        key,
        name: name || null,
        categoryId: match ? match.id : name ? null : targetCategoryId,
        candidates: [],
      });
    }
    groups.get(key).candidates.push(candidate);
  }

  return [...groups.values()];
}

// Split the groups into batches of at most `batchSize` cards, preserving order.
// Every card is already reduced to the shape the bulk endpoint accepts.
export function toBatches(groups = [], { batchSize = BATCH_SIZE } = {}) {
  const batches = [];

  for (const group of groups) {
    const { candidates } = group;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const slice = candidates.slice(i, i + batchSize);
      batches.push({
        categoryId: group.categoryId,
        categoryName: group.name,
        size: slice.length,
        cards: slice.map((candidate) => toCardPayload(candidate, group.categoryId)),
      });
    }
  }

  return batches;
}

// The counts the preview, review and summary steps all report from.
export function summarise(candidates = []) {
  const list = candidates ?? [];
  const withErrors = list.filter((candidate) => (candidate?.errors?.length ?? 0) > 0);

  return {
    total: list.length,
    importable: list.filter(isImportable).length,
    excluded: list.length - list.filter(isImportable).length,
    invalid: withErrors.length,
    duplicates: list.filter((candidate) => candidate?.duplicate).length,
    warnings: list.filter((candidate) => (candidate?.warnings?.length ?? 0) > 0).length,
  };
}

// Progress for the run step and for fc_import_jobs.created / .total.
export function progressOf(done, total) {
  const safeTotal = total > 0 ? total : 0;
  const percent = safeTotal > 0 ? Math.round((done / safeTotal) * 100) : 0;
  return { done, total: safeTotal, percent: Math.max(0, Math.min(100, percent)) };
}
