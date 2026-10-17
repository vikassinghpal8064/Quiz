import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { openCollection, readNotetypes, readNotes } from "../read.js";

// A real sql.js database, not a fake: this exercises the actual SQL the .apkg
// importer runs, so a schema or column-name mistake cannot hide behind a stub.
const require = createRequire(import.meta.url);
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");

let SQL;

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => wasmPath });
});

function makeCollection({ models, notes }) {
  const db = new SQL.Database();
  db.run("CREATE TABLE col (models TEXT)");
  db.run("CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT)");
  db.run("INSERT INTO col (models) VALUES (?)", [JSON.stringify(models)]);
  for (const note of notes) {
    db.run("INSERT INTO notes (id, mid, flds, tags) VALUES (?, ?, ?, ?)", [
      note.id,
      note.mid,
      note.flds,
      note.tags,
    ]);
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

const MODELS = { 7: { name: "Basic", flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }] } };
const NOTES = [
  { id: 1, mid: 7, flds: "q\u001fa", tags: " math " },
  { id: 2, mid: 7, flds: "q2\u001fa2", tags: "" },
];

describe("openCollection + reads against a real sql.js database", () => {
  it("opens a valid collection and reads its notetypes and notes", () => {
    const db = openCollection(SQL, makeCollection({ models: MODELS, notes: NOTES }));
    expect(readNotetypes(db)).toEqual(MODELS);
    expect(readNotes(db)).toEqual([
      { id: "1", mid: "7", flds: "q\u001fa", tags: " math " },
      { id: "2", mid: "7", flds: "q2\u001fa2", tags: "" },
    ]);
  });

  it("rejects bytes that are not a SQLite database", () => {
    expect(() => openCollection(SQL, new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/could not read/i);
  });

  it("explains the compressed anki21 case", () => {
    expect(() =>
      openCollection(SQL, new Uint8Array([1, 2, 3, 4, 5]), { collectionName: "collection.anki21" })
    ).toThrow(/anki21/);
  });
});
