import { describe, expect, it } from "vitest";
import {
  formatPageRange,
  pagesToSingles,
  pairKey,
  pairPages,
  parsePageRange,
  skipBlankPages,
} from "../paging.js";

describe("parsePageRange", () => {
  it("returns every page for an empty string or 'all'", () => {
    expect(parsePageRange("", 3).pages).toEqual([0, 1, 2]);
    expect(parsePageRange("all", 3).pages).toEqual([0, 1, 2]);
    expect(parsePageRange("ALL", 2).pages).toEqual([0, 1]);
  });

  it("parses ranges and singles into sorted 0-based indexes", () => {
    expect(parsePageRange("1-3, 5, 8-10", 10).pages).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it("dedupes and sorts", () => {
    expect(parsePageRange("3,1,3,2", 5).pages).toEqual([0, 1, 2]);
  });

  it("reports out-of-range pages", () => {
    const result = parsePageRange("1-99", 10);
    expect(result.error).toMatch(/between 1 and 10/);
    expect(result.pages).toEqual([]);
  });

  it("reports a non-numeric token", () => {
    expect(parsePageRange("1,abc", 10).error).toBeTruthy();
  });

  it("keeps what parsed before the bad token", () => {
    expect(parsePageRange("1,2,nope", 10).pages).toEqual([0, 1]);
  });
});

describe("formatPageRange", () => {
  it("collapses runs", () => {
    expect(formatPageRange([0, 1, 2, 4, 7, 8, 9])).toBe("1-3, 5, 8-10");
  });

  it("round-trips with parsePageRange", () => {
    const pages = parsePageRange("1-2, 4, 6-7", 8).pages;
    expect(parsePageRange(formatPageRange(pages), 8).pages).toEqual(pages);
  });

  it("is empty for no pages", () => {
    expect(formatPageRange([])).toBe("");
  });
});

describe("pairPages", () => {
  it("pairs consecutive pages by default", () => {
    const { pairs, unpaired } = pairPages([0, 1, 2, 3]);
    expect(pairs).toEqual([
      { key: "pair:0-1", front: 0, back: 1 },
      { key: "pair:2-3", front: 2, back: 3 },
    ]);
    expect(unpaired).toEqual([]);
  });

  it("leaves the last page unpaired on an odd count", () => {
    const { pairs, unpaired } = pairPages([0, 1, 2]);
    expect(pairs).toHaveLength(1);
    expect(unpaired).toEqual([2]);
  });

  it("shifts the pairing by one page", () => {
    const { pairs, unpaired } = pairPages([0, 1, 2, 3, 4], { offset: 1 });
    expect(unpaired).toEqual([0]);
    expect(pairs).toEqual([
      { key: "pair:1-2", front: 1, back: 2 },
      { key: "pair:3-4", front: 3, back: 4 },
    ]);
  });

  it("swaps front and back but keeps a stable key", () => {
    const { pairs } = pairPages([0, 1], { swap: true });
    expect(pairs[0]).toEqual({ key: "pair:0-1", front: 1, back: 0 });
  });

  it("builds a symmetric key", () => {
    expect(pairKey(5, 2)).toBe(pairKey(2, 5));
  });
});

describe("skipBlankPages", () => {
  it("removes blank pages preserving order", () => {
    expect(skipBlankPages([0, 1, 2, 3], new Set([1, 3]))).toEqual([0, 2]);
  });
});

describe("pagesToSingles", () => {
  it("makes one front-only card per page", () => {
    expect(pagesToSingles([2, 4])).toEqual([
      { key: "page:2", front: 2, back: null },
      { key: "page:4", front: 4, back: null },
    ]);
  });
});
