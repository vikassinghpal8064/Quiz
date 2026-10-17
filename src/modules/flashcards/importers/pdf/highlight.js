// Highlighter detection for Mode B.
//
// A page is rasterised small, every pixel is classified as one of the chosen
// marker colours, and the resulting mask is labelled into connected regions.
// Regions that sit close together (the several strokes of one highlighted
// phrase) are merged into blocks, which are returned in normalised page
// coordinates so they survive being re-rendered at export resolution.

import { highlightMask, labelRegions, mergeBoxes } from "./arrays.js";
import { context2d, downscaleCanvas } from "./imaging.js";

export const DETECT_WIDTH = 900;
export const MIN_HIGHLIGHT_AREA = 14;
export const HIGHLIGHT_GAP = 12;
export const BLOCK_MERGE_GAP = 14;

export function detectHighlights(canvas, { colors, maxDim = DETECT_WIDTH } = {}) {
  const small = downscaleCanvas(canvas, maxDim);
  const width = small.width;
  const height = small.height;
  const ctx = context2d(small);
  const { data } = ctx.getImageData(0, 0, width, height);

  const mask = highlightMask(data, colors);
  const regions = labelRegions(mask, width, height, {
    minArea: MIN_HIGHLIGHT_AREA,
    dilate: HIGHLIGHT_GAP,
  });
  const blocks = mergeBoxes(regions, { gap: BLOCK_MERGE_GAP });

  const toNormalised = (box) => ({
    x: box.x / width,
    y: box.y / height,
    width: box.width / width,
    height: box.height / height,
    area: box.area ?? box.width * box.height,
  });

  return {
    width,
    height,
    count: regions.length,
    blocks: blocks.map(toNormalised),
  };
}
