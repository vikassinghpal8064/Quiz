// The PDF / page-image importer.
//
// Unlike the CSV and quiz importers, this one cannot be reduced to a single
// parse() call: pages have to be rendered, browsed and cropped before anything
// can become a card. So the descriptor is marked `interactive` and carries a
// View that the wizard renders in place of the preview table; the View owns the
// flow and calls back with finished candidates.
//
// accepts() still works: it claims a single PDF, or a batch of page images.

import { lazy } from "react";

export const PDF_IMPORTER_ID = "pdf";

const PdfImportView = lazy(() => import("../components/import/pdf/PdfImportView.jsx"));

const PDF_EXTENSION = /\.pdf$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i;

function isPdf(file) {
  return Boolean(file) && (file.type === "application/pdf" || PDF_EXTENSION.test(file.name ?? ""));
}

function isImage(file) {
  return Boolean(file) && ((file.type ?? "").startsWith("image/") || IMAGE_EXTENSION.test(file.name ?? ""));
}

export function acceptedPageFiles(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  if (list.length === 1 && isPdf(list[0])) return list;
  if (list.length > 0 && list.every(isImage)) return list;
  return [];
}

const pdfImporter = {
  id: PDF_IMPORTER_ID,
  label: "PDF / page images",
  interactive: true,

  accepts(input) {
    return acceptedPageFiles(input).length > 0;
  },

  // Interactive importers build their candidates in the View, not here; the
  // registry contract still requires a parse(), so this returns nothing.
  parse() {
    return [];
  },

  View: PdfImportView,
};

export default pdfImporter;
