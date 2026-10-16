import { describe, it, expect } from "vitest";
import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  buildCards,
  chunkCards,
  detectDelimiter,
  importableRows,
  looksLikeHeader,
  parseDelimited,
  parseImport,
  splitTags,
} from "../importParse.js";

describe("detectDelimiter", () => {
  it("picks tab for tab-separated text", () => {
    expect(detectDelimiter("front\tback\ncat\tdog")).toBe("\t");
  });

  it("picks comma otherwise", () => {
    expect(detectDelimiter("front,back\na,b")).toBe(",");
  });

  it("prefers tab when a comma also appears inside fields", () => {
    expect(detectDelimiter("Paris, France\tParis\n")).toBe("\t");
  });
});

describe("parseDelimited", () => {
  it("splits plain rows", () => {
    expect(parseDelimited("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps delimiters and newlines inside quotes", () => {
    expect(parseDelimited('"a,b","c\nd",e')).toEqual([["a,b", "c\nd", "e"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseDelimited('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });

  it("handles CRLF and a trailing newline without a phantom row", () => {
    expect(parseDelimited("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a trailing empty field", () => {
    expect(parseDelimited("a,")).toEqual([["a", ""]]);
  });
});

describe("looksLikeHeader", () => {
  it("recognises the common column names", () => {
    expect(looksLikeHeader(["Front", "Back", "Tags"])).toBe(true);
    expect(looksLikeHeader(["Question", "Answer"])).toBe(true);
    expect(looksLikeHeader(["term", "definition", "topic"])).toBe(true);
  });

  it("does not treat a data row as a header", () => {
    expect(looksLikeHeader(["cat", "dog"])).toBe(false);
    expect(looksLikeHeader(["front", "dog"])).toBe(false); // only one hit
  });
});

describe("splitTags", () => {
  it("splits on comma, semicolon and pipe", () => {
    expect(splitTags("a, b;c|d")).toEqual(["a", "b", "c", "d"]);
  });

  it("trims, drops blanks and de-duplicates case-insensitively", () => {
    expect(splitTags(" French , french,,  ")).toEqual(["French"]);
  });

  it("caps the count and the length", () => {
    const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `t${i}`).join(",");
    expect(splitTags(many)).toHaveLength(MAX_TAGS);
    expect(splitTags("x".repeat(100))[0]).toHaveLength(MAX_TAG_LENGTH);
  });
});

describe("parseImport", () => {
  it("parses a headered CSV and reads the columns by name", () => {
    const parsed = parseImport("Question,Answer,Tags\nWhat is 2+2?,4,math;basics\nCapital of France,Paris,geo");
    expect(parsed.hadHeader).toBe(true);
    expect(parsed.columns).toEqual({ front: 0, back: 1, tags: 2 });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ line: 2, front: "What is 2+2?", back: "4", tags: ["math", "basics"] });
    expect(parsed.errors).toEqual([]);
  });

  it("parses headerless TSV positionally", () => {
    const parsed = parseImport("cat\tdog\tpets\nsun\tmoon");
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.hadHeader).toBe(false);
    expect(parsed.rows[0]).toMatchObject({ front: "cat", back: "dog", tags: ["pets"] });
    expect(parsed.rows[1].tags).toEqual([]);
  });

  it("honours a reordered header", () => {
    const parsed = parseImport("Back,Front\nParis,Capital of France");
    expect(parsed.columns.front).toBe(1);
    expect(parsed.columns.back).toBe(0);
    expect(parsed.rows[0]).toMatchObject({ front: "Capital of France", back: "Paris" });
  });

  it("reports rows that are missing a side", () => {
    const parsed = parseImport("only front,\n,\nonly back");
    // headerless, so row 1 = "only front" / "" and row 3 = "only back" / ""
    expect(parsed.errors.some((e) => /Line 1/.test(e) && /missing back/.test(e))).toBe(true);
    expect(importableRows(parsed)).toHaveLength(0);
  });

  it("ignores blank lines", () => {
    const parsed = parseImport("a,b\n\n\nc,d");
    expect(parsed.rows).toHaveLength(2);
  });

  it("can be told there is no header even when names look like one", () => {
    const parsed = parseImport("front,back\na,b", { header: false });
    expect(parsed.hadHeader).toBe(false);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ front: "front", back: "back" });
  });

  it("returns a friendly error for empty input", () => {
    const parsed = parseImport("   \n  ");
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]).toMatch(/nothing to import/i);
  });
});

describe("buildCards / chunkCards", () => {
  it("wraps each side as a text block and carries the target category", () => {
    const cards = buildCards([{ front: "Q", back: "A", tags: ["t"] }], { categoryId: 7 });
    expect(cards[0]).toEqual({
      category_id: 7,
      card_type: "basic",
      front: { blocks: [{ type: "text", text: "Q" }] },
      back: { blocks: [{ type: "text", text: "A" }] },
      tags: ["t"],
      source: "import",
    });
  });

  it("splits into batches that respect the bulk limit", () => {
    const cards = Array.from({ length: 1200 }, (_, i) => i);
    const batches = chunkCards(cards, 500);
    expect(batches.map((b) => b.length)).toEqual([500, 500, 200]);
  });
});
