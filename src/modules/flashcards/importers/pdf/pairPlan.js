// Mode D planning: decide which pages pair up, which are blank, and which pairs
// look like they do not belong together.
//
// Pure: the caller supplies a similarity score per pair (computed from rendered
// pixels elsewhere). Keeping this separate is what makes the pairing controls -
// "shift by one page", "swap front/back", "skip blank pages" - trivially
// testable.

import { looksUnrelated, similarity } from "./arrays.js";
import { pairPages } from "./paging.js";

export const PAIR_WARNING_UNRELATED = "Linked pages look unrelated";

// pages: ordered 0-based page indexes (the user's selection).
// blank: Set of page indexes detected blank (skipped when skipBlank).
export function buildPairPlan({ pages = [], blank = new Set(), offset = 0, swap = false, skipBlank = true } = {}) {
  const blankSet = blank instanceof Set ? blank : new Set(blank);
  const usable = skipBlank ? pages.filter((page) => !blankSet.has(page)) : [...pages];
  const { pairs, unpaired } = pairPages(usable, { offset, swap });
  return { pairs, unpaired, usable, skippedBlank: pages.length - usable.length };
}

// Warnings for one pair given its pixel similarity (0..1) or null if unknown.
export function warningsForPair(pairSim, { minSimilarity } = {}) {
  const warnings = [];
  if (pairSim != null && looksUnrelated(pairSim, { min: minSimilarity })) {
    warnings.push(PAIR_WARNING_UNRELATED);
  }
  return warnings;
}

// The score for a pair from the two pages' luma arrays (already downscaled to
// the same dimensions by the caller).
export function pairSimilarity(frontLuma, backLuma, opts) {
  if (!frontLuma || !backLuma) return null;
  return similarity(frontLuma, backLuma, opts);
}
