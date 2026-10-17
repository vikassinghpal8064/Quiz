import { describe, expect, it } from "vitest";
import { PAIR_WARNING_UNRELATED, buildPairPlan, pairSimilarity, warningsForPair } from "../pairPlan.js";

describe("buildPairPlan", () => {
  it("pairs the chosen pages", () => {
    const plan = buildPairPlan({ pages: [0, 1, 2, 3], blank: new Set() });
    expect(plan.pairs.map((p) => [p.front, p.back])).toEqual([[0, 1], [2, 3]]);
    expect(plan.unpaired).toEqual([]);
  });

  it("skips blank pages before pairing", () => {
    const plan = buildPairPlan({ pages: [0, 1, 2, 3], blank: new Set([1]), skipBlank: true });
    expect(plan.usable).toEqual([0, 2, 3]);
    expect(plan.skippedBlank).toBe(1);
    expect(plan.pairs.map((p) => [p.front, p.back])).toEqual([[0, 2]]);
    expect(plan.unpaired).toEqual([3]);
  });

  it("keeps blank pages when skipping is off", () => {
    const plan = buildPairPlan({ pages: [0, 1], blank: new Set([0]), skipBlank: false });
    expect(plan.usable).toEqual([0, 1]);
    expect(plan.skippedBlank).toBe(0);
  });

  it("passes the offset and swap through", () => {
    const plan = buildPairPlan({ pages: [0, 1, 2], offset: 1, swap: true, blank: new Set() });
    expect(plan.unpaired).toEqual([0]);
    expect(plan.pairs[0]).toMatchObject({ front: 2, back: 1 });
  });
});

describe("warningsForPair", () => {
  it("warns when two pages look unrelated", () => {
    expect(warningsForPair(0.1)).toContain(PAIR_WARNING_UNRELATED);
  });

  it("stays quiet when they match", () => {
    expect(warningsForPair(0.95)).toEqual([]);
  });

  it("stays quiet when the score is unknown", () => {
    expect(warningsForPair(null)).toEqual([]);
  });
});

describe("pairSimilarity", () => {
  it("is 1 for identical arrays and 0 for opposites", () => {
    const a = new Uint8ClampedArray([0, 128, 255]);
    expect(pairSimilarity(a, a)).toBe(1);
    expect(pairSimilarity(new Uint8ClampedArray([0, 0, 0]), new Uint8ClampedArray([255, 255, 255]))).toBe(0);
  });

  it("returns null when a page is missing", () => {
    expect(pairSimilarity(null, new Uint8ClampedArray([0]))).toBeNull();
  });
});
