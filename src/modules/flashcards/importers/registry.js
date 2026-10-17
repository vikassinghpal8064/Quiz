// The importer registry behind the /flash/import wizard.
//
// An importer is a plain descriptor:
//
//   {
//     id,                 // stable key, shown in the URL and stored on a job
//     label,              // what the user clicks in step 1
//     accepts(input),     // can this importer handle that input?
//     parse(input, opts), // input -> candidate cards[]
//   }
//
// Importers are registered at module load, so adding a source means writing one
// descriptor and importing it here - the wizard, the preview step and the
// progress step never special-case a concrete importer.
//
// Four ship today: `csv` (a delimited file or pasted text), `quiz` (the
// read-only bridge to the quiz tables), `pdf` (render/crop/pair pages in the
// browser) and `apkg` (unzip an Anki deck and map its note fields). The first
// two are pure enough to exercise directly, which is what the tests under
// __tests__/ do; the interactive two are exercised through their pure helpers.

import csvImporter, { CSV_IMPORTER_ID } from "./csv.js";
import quizBridgeImporter, { QUIZ_IMPORTER_ID } from "./quizBridge.js";
import pdfImporter, { PDF_IMPORTER_ID } from "./pdf.js";
import apkgImporter, { APKG_IMPORTER_ID } from "./apkg.js";

const registry = new Map();

export function registerImporter(importer) {
  if (!importer || typeof importer.id !== "string" || !importer.id.trim()) {
    throw new Error("An importer needs a non-empty id");
  }
  if (typeof importer.label !== "string" || !importer.label.trim()) {
    throw new Error(`Importer "${importer.id}" needs a label`);
  }
  if (typeof importer.accepts !== "function") {
    throw new Error(`Importer "${importer.id}" needs an accepts() function`);
  }
  if (typeof importer.parse !== "function") {
    throw new Error(`Importer "${importer.id}" needs a parse() function`);
  }
  registry.set(importer.id, importer);
  return importer;
}

registerImporter(csvImporter);
registerImporter(quizBridgeImporter);
registerImporter(pdfImporter);
registerImporter(apkgImporter);

export function listImporters() {
  return [...registry.values()];
}

export function getImporter(id) {
  return registry.get(id) ?? null;
}

// The importer that would handle this input, or null. Used by the wizard to
// preselect a source once a file has been dropped on step 1.
export function importerFor(input) {
  return listImporters().find((importer) => {
    try {
      return importer.accepts(input);
    } catch {
      return false;
    }
  }) ?? null;
}

export { CSV_IMPORTER_ID, QUIZ_IMPORTER_ID, PDF_IMPORTER_ID, APKG_IMPORTER_ID };
