import { describe, expect, it } from "vitest";
import apkgImporter, { APKG_IMPORTER_ID, acceptedApkgFiles } from "../apkg.js";
import { PDF_IMPORTER_ID } from "../pdf.js";
import { getImporter, importerFor, listImporters } from "../registry.js";
import { NOTETYPE_LOAD_HINT, readNotetypes, readNotes } from "../apkg/read.js";

function file(name, type = "") {
  return { name, type, size: 1024 };
}

describe("apkg importer descriptor", () => {
  it("follows the registry contract", () => {
    expect(apkgImporter.id).toBe(APKG_IMPORTER_ID);
    expect(typeof apkgImporter.label).toBe("string");
    expect(typeof apkgImporter.accepts).toBe("function");
    expect(typeof apkgImporter.parse).toBe("function");
    expect(apkgImporter.interactive).toBe(true);
  });

  it("is registered", () => {
    expect(getImporter(APKG_IMPORTER_ID)).toBeTruthy();
    expect(listImporters().map((i) => i.id)).toContain(APKG_IMPORTER_ID);
  });

  it("parse is a no-op (the View builds the candidates)", () => {
    expect(apkgImporter.parse()).toEqual([]);
  });
});

describe("acceptedApkgFiles", () => {
  it("accepts a single .apkg, case-insensitively", () => {
    expect(acceptedApkgFiles(file("deck.apkg"))).toHaveLength(1);
    expect(acceptedApkgFiles(file("DECK.APKG"))).toHaveLength(1);
  });

  it("rejects batches, other types and empty input", () => {
    expect(acceptedApkgFiles([file("a.apkg"), file("b.apkg")])).toEqual([]);
    expect(acceptedApkgFiles(file("rows.csv"))).toEqual([]);
    expect(acceptedApkgFiles(file("doc.pdf", "application/pdf"))).toEqual([]);
    expect(acceptedApkgFiles([])).toEqual([]);
    expect(acceptedApkgFiles(null)).toEqual([]);
  });
});

describe("apkg routing", () => {
  it("routes an .apkg to the apkg importer, not csv", () => {
    expect(importerFor({ name: "deck.apkg" })?.id).toBe(APKG_IMPORTER_ID);
  });

  it("still routes a PDF and a CSV to their own importers", () => {
    expect(importerFor({ name: "doc.pdf" })?.id).toBe(PDF_IMPORTER_ID);
    expect(importerFor({ name: "rows.csv" })?.id).toBe("csv");
  });
});

// A stand-in for the sql.js handle: it only ever needs exec().
function fakeDb(tables) {
  return { exec: (sql) => tables[sql] ?? [] };
}

describe("readNotetypes / readNotes", () => {
  const models = { 7: { name: "Basic", flds: [{ name: "Front", ord: 0 }] } };

  it("parses the models JSON blob", () => {
    const db = fakeDb({ "SELECT models FROM col": [{ values: [[JSON.stringify(models)]] }] });
    expect(readNotetypes(db)).toEqual(models);
  });

  it("returns {} for a missing or broken models blob", () => {
    expect(readNotetypes(fakeDb({}))).toEqual({});
    expect(readNotetypes(fakeDb({ "SELECT models FROM col": [{ values: [["not json"]] }] }))).toEqual({});
  });

  it("maps the notes rows to plain objects", () => {
    const db = fakeDb({
      "SELECT id, mid, flds, tags FROM notes": [
        { values: [[12, 7, "q\u001fa", " math "]] },
      ],
    });
    expect(readNotes(db)).toEqual([{ id: "12", mid: "7", flds: "q\u001fa", tags: " math " }]);
  });

  it("returns [] when there are no notes", () => {
    expect(readNotes(fakeDb({}))).toEqual([]);
  });

  it("documents the compressed-collection limitation", () => {
    expect(NOTETYPE_LOAD_HINT).toMatch(/anki21/);
  });
});
