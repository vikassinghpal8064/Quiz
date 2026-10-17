import { describe, expect, it } from "vitest";
import pdfImporter, { PDF_IMPORTER_ID, acceptedPageFiles } from "../pdf.js";
import { getImporter, importerFor, listImporters, PDF_IMPORTER_ID as REGISTRY_ID } from "../registry.js";

function file(name, type = "") {
  return { name, type, size: 1024 };
}

describe("pdf importer descriptor", () => {
  it("follows the registry contract", () => {
    expect(pdfImporter.id).toBe(PDF_IMPORTER_ID);
    expect(typeof pdfImporter.label).toBe("string");
    expect(typeof pdfImporter.accepts).toBe("function");
    expect(typeof pdfImporter.parse).toBe("function");
    expect(pdfImporter.interactive).toBe(true);
  });

  it("is registered", () => {
    expect(REGISTRY_ID).toBe(PDF_IMPORTER_ID);
    expect(getImporter(PDF_IMPORTER_ID)).toBeTruthy();
    expect(listImporters().map((i) => i.id)).toContain(PDF_IMPORTER_ID);
  });

  it("parse is a no-op (the View builds the candidates)", () => {
    expect(pdfImporter.parse()).toEqual([]);
  });
});

describe("acceptedPageFiles", () => {
  it("accepts a single PDF by type or extension", () => {
    expect(acceptedPageFiles(file("doc.pdf", "application/pdf"))).toHaveLength(1);
    expect(acceptedPageFiles(file("DOC.PDF"))).toHaveLength(1);
  });

  it("accepts a batch of page images", () => {
    expect(acceptedPageFiles([file("p1.png", "image/png"), file("p2.jpg", "image/jpeg")])).toHaveLength(2);
  });

  it("rejects a mixed or non-image batch", () => {
    expect(acceptedPageFiles([file("doc.pdf", "application/pdf"), file("p1.png", "image/png")])).toEqual([]);
    expect(acceptedPageFiles(file("rows.csv", "text/csv"))).toEqual([]);
  });

  it("accepts nothing for empty input", () => {
    expect(acceptedPageFiles([])).toEqual([]);
    expect(acceptedPageFiles(null)).toEqual([]);
  });
});

describe("importerFor routing", () => {
  it("routes a PDF to the pdf importer, not csv", () => {
    const textFn = { name: "doc.pdf", type: "application/pdf", text: async () => "" };
    expect(importerFor(textFn)?.id).toBe(PDF_IMPORTER_ID);
  });

  it("still routes a .csv file to csv", () => {
    expect(importerFor({ name: "rows.csv", type: "text/csv", text: async () => "" })?.id).toBe("csv");
  });
});
