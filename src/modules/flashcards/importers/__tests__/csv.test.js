import { describe, it, expect } from "vitest";
import csvImporter, {
  CSV_IMPORTER_ID,
  NO_COLUMN,
  PREVIEW_ROWS,
  buildCandidates,
  delimiterLabel,
  inspectCsv,
} from "../csv.js";
import { SOURCES } from "../candidate.js";

const WITH_HEADER = "Front,Back,Tags\nWhat is 2+2?,4,math\nCapital of France,Paris,geo\n";
const WITH_CATEGORY = "Front,Back,Category\nQ1,A1,Biology\nQ2,A2,Chemistry\n";
const NO_HEADER = "alpha,beta\none,two\n";

describe("delimiterLabel", () => {
  it("names the delimiters the picker offers", () => {
    expect(delimiterLabel("\t")).toBe("tab");
    expect(delimiterLabel(",")).toBe("comma");
    expect(delimiterLabel(";")).toBe("semicolon");
    expect(delimiterLabel("?")).toBe("unknown");
  });
});

describe("inspectCsv", () => {
  it("auto-detects a comma", () => {
    expect(inspectCsv(WITH_HEADER).delimiter).toBe(",");
  });

  it("auto-detects a tab", () => {
    const inspected = inspectCsv("Front\tBack\nQ\tA\n");
    expect(inspected.delimiter).toBe("\t");
    expect(inspected.hadHeader).toBe(true);
  });

  it("maps columns from the header names", () => {
    expect(inspectCsv(WITH_HEADER).columns).toEqual({ front: 0, back: 1, tags: 2, category: NO_COLUMN });
  });

  it("finds an optional category column", () => {
    expect(inspectCsv(WITH_CATEGORY).columns.category).toBe(2);
  });

  it("falls back to positional columns when there is no header", () => {
    const inspected = inspectCsv(NO_HEADER);
    expect(inspected.hadHeader).toBe(false);
    expect(inspected.columns).toEqual({ front: 0, back: 1, tags: NO_COLUMN, category: NO_COLUMN });
  });

  it("honours an explicit header choice", () => {
    expect(inspectCsv(NO_HEADER, { header: true }).hadHeader).toBe(true);
    expect(inspectCsv(WITH_HEADER, { header: false }).hadHeader).toBe(false);
  });

  it("honours an explicit column mapping over the header guess", () => {
    const inspected = inspectCsv(WITH_HEADER, { frontColumn: 1, backColumn: 0 });
    expect(inspected.columns.front).toBe(1);
    expect(inspected.columns.back).toBe(0);
    expect(inspected.rows[0].front).toBe("4");
    expect(inspected.rows[0].back).toBe("What is 2+2?");
  });

  it("keeps the 1-based line number of each row", () => {
    expect(inspectCsv(WITH_HEADER).rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it("skips blank rows but still numbers from the original text", () => {
    const inspected = inspectCsv("Front,Back\nQ,A\n,,\nR,S\n");
    expect(inspected.rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it("splits a tags cell on the usual separators", () => {
    expect(inspectCsv(WITH_HEADER).rows[0].tags).toEqual(["math"]);
  });

  it("reports the row count", () => {
    expect(inspectCsv(WITH_HEADER).rowCount).toBe(2);
  });

  it("handles empty input without throwing", () => {
    const inspected = inspectCsv("");
    expect(inspected.rowCount).toBe(0);
    expect(inspected.rows).toEqual([]);
  });
});

describe("buildCandidates", () => {
  it("turns each row into a candidate", () => {
    const { candidates } = buildCandidates(WITH_HEADER);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].front.blocks[0].text).toBe("What is 2+2?");
    expect(candidates[0].back.blocks[0].text).toBe("4");
    expect(candidates[0].source).toBe(SOURCES.csv);
  });

  it("keys candidates by their line so React lists stay stable", () => {
    const { candidates } = buildCandidates(WITH_HEADER);
    expect(candidates.map((c) => c.key)).toEqual(["row-2", "row-3"]);
  });

  it("carries a mapped category name through", () => {
    const { candidates } = buildCandidates(WITH_CATEGORY);
    expect(candidates.map((c) => c.categoryName)).toEqual(["Biology", "Chemistry"]);
  });

  it("leaves categoryName null when no category column is mapped", () => {
    const { candidates } = buildCandidates(WITH_HEADER);
    expect(candidates[0].categoryName).toBe(null);
  });

  it("flags a row with a missing back as an error", () => {
    const { candidates } = buildCandidates("Front,Back\nQ,\n");
    expect(candidates[0].errors).toEqual(["missing back"]);
    expect(candidates[0].approved).toBe(false);
  });

  it("records the file name as source_ref", () => {
    const { candidates } = buildCandidates(WITH_HEADER, { sourceRef: "deck.csv" });
    expect(candidates[0].source_ref).toBe("deck.csv");
  });
});

describe("the importer descriptor", () => {
  it("exposes the registry shape", () => {
    expect(csvImporter.id).toBe(CSV_IMPORTER_ID);
    expect(typeof csvImporter.label).toBe("string");
    expect(typeof csvImporter.accepts).toBe("function");
    expect(typeof csvImporter.parse).toBe("function");
    expect(typeof csvImporter.inspect).toBe("function");
  });

  it("accepts a file-like object by extension", () => {
    expect(csvImporter.accepts({ name: "deck.csv" })).toBe(true);
    expect(csvImporter.accepts({ name: "deck.tsv" })).toBe(true);
    expect(csvImporter.accepts({ name: "deck.json" })).toBe(false);
  });

  it("accepts raw text", () => {
    expect(csvImporter.accepts("front,back")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(csvImporter.accepts(null)).toBe(false);
    expect(csvImporter.accepts(42)).toBe(false);
    expect(csvImporter.accepts({})).toBe(false);
  });

  it("parses a file-like object to candidates", async () => {
    const file = { name: "deck.csv", text: async () => WITH_HEADER };
    const candidates = await csvImporter.parse(file);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].source_ref).toBe("deck.csv");
  });

  it("parses raw text to candidates", async () => {
    const candidates = await csvImporter.parse(WITH_HEADER);
    expect(candidates).toHaveLength(2);
  });

  it("honours a mapping passed in options", async () => {
    const candidates = await csvImporter.parse(WITH_HEADER, { backColumn: 0, frontColumn: 1 });
    expect(candidates[0].front.blocks[0].text).toBe("4");
  });

  it("publishes a preview size of 20 rows", () => {
    expect(PREVIEW_ROWS).toBe(20);
  });
});
