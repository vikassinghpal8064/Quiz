// Read an Anki `.apkg` in the browser: unzip it with jszip, open the SQLite
// collection with sql.js, and hand back the notetypes + notes the View maps.
//
// Everything runs client-side. jszip and sql.js (plus its wasm) are imported
// lazily so they land in their own chunks and are only fetched when someone
// actually picks an .apkg. Anki has shipped two collection layouts:
//
//   collection.anki2   plain SQLite   (older exports)
//   collection.anki21  zstd SQLite    (newer exports)
//
// We look for the plain `.anki2` first and fall back to `.anki21`; if only the
// compressed one is present and it cannot be read as SQLite, the caller gets a
// clear error rather than a stack trace.

import {
  openCollection,
  readNotetypes,
  readNotes,
} from "./read.js";
import { parseMediaMap } from "../anki.js";

export const COLLECTION_NAMES = ["collection.anki2", "collection.anki21"];

async function loadDeps() {
  const [jszipModule, sqlModule, wasmModule] = await Promise.all([
    import("jszip"),
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  const JSZip = jszipModule.default ?? jszipModule;
  const initSqlJs = sqlModule.default ?? sqlModule;
  const wasmUrl = wasmModule.default ?? wasmModule;
  return { JSZip, initSqlJs, wasmUrl };
}

async function readMediaMap(zip) {
  const entry = zip.file("media");
  if (!entry) return {};
  try {
    const text = await entry.async("string");
    return parseMediaMap(text);
  } catch {
    // A newer .apkg stores media in a SQLite db, not a JSON file; images simply
    // will not resolve for those, which is a soft failure.
    return {};
  }
}

// file -> { zip, db, notetypes, notes, mediaMap, collectionName }
export async function loadApkgFile(file) {
  const { JSZip, initSqlJs, wasmUrl } = await loadDeps();

  const zip = await JSZip.loadAsync(file);
  const collectionName = COLLECTION_NAMES.find((name) => zip.file(name));
  if (!collectionName) {
    throw new Error("This .apkg does not contain an Anki collection.");
  }

  const bytes = await zip.file(collectionName).async("uint8array");
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  const db = openCollection(SQL, bytes, { collectionName });

  const notetypes = readNotetypes(db);
  const notes = readNotes(db);
  const mediaMap = await readMediaMap(zip);

  return { zip, db, notetypes, notes, mediaMap, collectionName };
}
