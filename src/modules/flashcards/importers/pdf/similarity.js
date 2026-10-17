// Pixel-level comparison of two pages from a page source.
//
// Used by Mode D ("do these two paired pages look like one card?") and Mode E
// (diff the front and back to find the changed regions). Both pages are
// rasterised small, squashed to a fixed grid and compared sample by sample.

import { similarity } from "./arrays.js";
import { fixedLuma } from "./imaging.js";

export const COMPARE_SIZE = 64;

// 1 = the two pages look the same, 0 = completely different, null when either
// page is missing.
export async function pageSimilarity(source, frontIndex, backIndex, { size = COMPARE_SIZE } = {}) {
  if (!source || frontIndex == null || backIndex == null) return null;
  const width = size * 2;
  const [front, back] = await Promise.all([
    source.render(frontIndex, { targetWidth: width }),
    source.render(backIndex, { targetWidth: width }),
  ]);
  return similarity(fixedLuma(front, size), fixedLuma(back, size), { threshold: 40 });
}
