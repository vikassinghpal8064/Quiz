import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { loadApkgFile } from "../load.js";

// End-to-end over the real path: build a tiny deck (a zipped SQLite collection
// plus a `media` map and an image), then read it back with loadApkgFile(). This
// covers the jszip navigation and the wasm `?url` resolution that the pure
// helpers cannot.
const require = createRequire(import.meta.url);
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");

let SQL;

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => wasmPath });
});

async function makeApkg() {
  const db = new SQL.Database();
  db.run("CREATE TABLE col (models TEXT)");
  db.run("CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT)");
  db.run("INSERT INTO col (models) VALUES (?)", [
    JSON.stringify({ 7: { name: "Basic", flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }] } }),
  ]);
  db.run("INSERT INTO notes (id, mid, flds, tags) VALUES (1, 7, ?, ?)", ["q\u001fa", " math "]);
  db.run("INSERT INTO notes (id, mid, flds, tags) VALUES (2, 7, ?, ?)", ["q2\u001fa2", ""]);
  const collection = db.export();
  db.close();

  const zip = new JSZip();
  zip.file("collection.anki2", collection);
  zip.file("media", JSON.stringify({ 0: "cat.png" }));
  zip.file("0", new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: "uint8array" });
}

describe("loadApkgFile", () => {
  it("unzips a deck and returns its notetypes, notes and media map", async () => {
    const bytes = await makeApkg();
    const loaded = await loadApkgFile(bytes);

    expect(loaded.collectionName).toBe("collection.anki2");
    expect(loaded.notes).toHaveLength(2);
    expect(Object.keys(loaded.notetypes)).toEqual(["7"]);
    expect(loaded.mediaMap).toEqual({ 0: "cat.png" });
  });

  it("throws a clear error when the .apkg has no collection", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "nothing here");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(loadApkgFile(bytes)).rejects.toThrow(/does not contain an Anki collection/i);
  });
});
