// The PDF import modes, in the order they appear in the picker. D is first and
// is the default because it matches how flash-card exports are laid out
// (question on one page, answer on the next).

export const PDF_MODE_PAIRS = "D";
export const PDF_MODE_PAGE = "C";
export const PDF_MODE_CROP = "A";
export const PDF_MODE_HIGHLIGHT = "B";
export const PDF_MODE_REGIONS = "E";

export const DEFAULT_PDF_MODE = PDF_MODE_PAIRS;

export const PDF_MODES = [
  {
    id: PDF_MODE_PAIRS,
    label: "Front / back pairs",
    short: "Pairs",
    hint: "Pages 1+2, 3+4 … become one card each (odd page front, even page back).",
  },
  {
    id: PDF_MODE_PAGE,
    label: "One card per page",
    short: "Pages",
    hint: "Every chosen page becomes its own card.",
  },
  {
    id: PDF_MODE_CROP,
    label: "Crop to card",
    short: "Crop",
    hint: "Draw rectangles on a page; each becomes a card.",
  },
  {
    id: PDF_MODE_HIGHLIGHT,
    label: "Highlight extract",
    short: "Highlight",
    hint: "Find highlighter marks, OCR the blocks and propose cloze cards.",
  },
  {
    id: PDF_MODE_REGIONS,
    label: "Split by changed regions",
    short: "Regions",
    hint: "Diff each front/back pair; one card per changed region.",
  },
];

export function modeLabel(id) {
  return PDF_MODES.find((mode) => mode.id === id)?.label ?? id;
}
