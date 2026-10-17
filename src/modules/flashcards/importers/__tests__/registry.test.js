import { describe, it, expect } from "vitest";
import {
  CSV_IMPORTER_ID,
  QUIZ_IMPORTER_ID,
  getImporter,
  importerFor,
  listImporters,
  registerImporter,
} from "../registry.js";

describe("the registry", () => {
  it("ships the CSV and quiz-bridge importers", () => {
    const ids = listImporters().map((i) => i.id);
    expect(ids).toContain(CSV_IMPORTER_ID);
    expect(ids).toContain(QUIZ_IMPORTER_ID);
  });

  it("gives every importer the registry shape", () => {
    for (const importer of listImporters()) {
      expect(typeof importer.id).toBe("string");
      expect(importer.label.length).toBeGreaterThan(0);
      expect(typeof importer.accepts).toBe("function");
      expect(typeof importer.parse).toBe("function");
    }
  });

  it("looks an importer up by id", () => {
    expect(getImporter(CSV_IMPORTER_ID).id).toBe(CSV_IMPORTER_ID);
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(getImporter("nope")).toBe(null);
  });
});

describe("registerImporter", () => {
  // The registry is a module-level Map, so a descriptor registered here stays
  // registered for the rest of the file. The stub only ever claims
  // { claim: true } - an input neither shipped importer accepts - so it cannot
  // leak into the importerFor() expectations below.
  const valid = () => ({
    id: "test",
    label: "Test",
    accepts: (input) => Boolean(input && input.claim === true),
    parse: async () => [],
  });

  it("rejects a descriptor with no id", () => {
    expect(() => registerImporter({ ...valid(), id: "" })).toThrow(/non-empty id/);
  });

  it("rejects a descriptor with no label", () => {
    expect(() => registerImporter({ ...valid(), label: "" })).toThrow(/label/);
  });

  it("rejects a descriptor with no accepts()", () => {
    expect(() => registerImporter({ ...valid(), accepts: undefined })).toThrow(/accepts/);
  });

  it("rejects a descriptor with no parse()", () => {
    expect(() => registerImporter({ ...valid(), parse: undefined })).toThrow(/parse/);
  });

  it("accepts a well-formed descriptor and makes it findable", () => {
    const importer = valid();
    expect(registerImporter(importer)).toBe(importer);
    expect(getImporter("test")).toBe(importer);
    expect(importerFor({ claim: true })?.id).toBe("test");
  });
});

describe("importerFor", () => {
  it("picks the CSV importer for a .csv file", () => {
    expect(importerFor({ name: "deck.csv" })?.id).toBe(CSV_IMPORTER_ID);
  });

  it("picks nothing for something no importer claims", () => {
    expect(importerFor({ name: "deck.bin" })).toBe(null);
    expect(importerFor(null)).toBe(null);
    expect(importerFor(undefined)).toBe(null);
  });
});
