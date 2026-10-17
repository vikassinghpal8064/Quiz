// The Anki `.apkg` importer descriptor.
//
// Like the PDF importer this is `interactive`: it cannot be reduced to a
// synchronous parse() - the deck has to be unzipped, opened as SQLite, and its
// notetypes mapped before anything becomes a card. So the wizard renders the
// View in place of the preview table and the View calls back with candidates.
//
// accepts() still works on the dropped file, which is what lets importerFor()
// route a single .apkg here rather than to the CSV importer.

import { lazy } from "react";

export const APKG_IMPORTER_ID = "apkg";

const ApkgImportView = lazy(() => import("../components/import/apkg/ApkgImportView.jsx"));

const APKG_EXTENSION = /\.apkg$/i;

export function acceptedApkgFiles(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  if (list.length !== 1) return [];
  const file = list[0];
  return file && file.type !== "application/pdf" && APKG_EXTENSION.test(file.name ?? "") ? list : [];
}

const apkgImporter = {
  id: APKG_IMPORTER_ID,
  label: "Anki deck (.apkg)",
  interactive: true,

  accepts(input) {
    return acceptedApkgFiles(input).length > 0;
  },

  // Interactive importers build their candidates in the View; the registry
  // contract still requires a parse(), so this returns nothing.
  parse() {
    return [];
  },

  View: ApkgImportView,
};

export default apkgImporter;
