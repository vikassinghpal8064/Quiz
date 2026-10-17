import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLANK_STDDEV,
  diffMask,
  differingFraction,
  dilate,
  highlightColorFor,
  highlightMask,
  imageStats,
  isBlankStats,
  labelRegions,
  looksUnrelated,
  mean,
  mergeBoxes,
  similarity,
  stddev,
} from "../arrays.js";

describe("mean / stddev", () => {
  it("averages numbers", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("treats an empty input as zero rather than NaN", () => {
    expect(mean([])).toBe(0);
    expect(stddev([])).toBe(0);
  });

  it("is zero for a uniform signal", () => {
    expect(stddev([2, 2, 2, 2])).toBe(0);
  });
});

describe("imageStats / blank pages", () => {
  it("flags a uniform page as blank", () => {
    const stats = imageStats(new Uint8ClampedArray(100).fill(255));
    expect(stats.stddev).toBe(0);
    expect(isBlankStats(stats)).toBe(true);
  });

  it("flags a page with ink as not blank", () => {
    const luma = new Uint8ClampedArray(100).fill(255);
    for (let i = 0; i < 20; i += 1) luma[i] = 10;
    const stats = imageStats(luma);
    expect(isBlankStats(stats)).toBe(false);
  });

  it("treats a fully dark page as blank too", () => {
    const stats = imageStats(new Uint8ClampedArray(64).fill(0));
    expect(isBlankStats(stats)).toBe(true);
  });

  it("honours a custom threshold", () => {
    const luma = new Uint8ClampedArray(64);
    for (let i = 0; i < 64; i += 1) luma[i] = i % 2 ? 250 : 255;
    const stats = imageStats(luma);
    expect(isBlankStats(stats, { stddev: 1 })).toBe(false);
    expect(DEFAULT_BLANK_STDDEV).toBeGreaterThan(1);
  });
});

describe("differingFraction / similarity", () => {
  it("is zero for identical pages", () => {
    const a = new Uint8ClampedArray([1, 2, 3, 4]);
    expect(differingFraction(a, a)).toBe(0);
    expect(similarity(a, a)).toBe(1);
  });

  it("is one when every pixel changed a lot", () => {
    const a = new Uint8ClampedArray([0, 0, 0, 0]);
    const b = new Uint8ClampedArray([255, 255, 255, 255]);
    expect(differingFraction(a, b)).toBe(1);
    expect(similarity(a, b)).toBe(0);
  });

  it("ignores small differences under the threshold", () => {
    const a = new Uint8ClampedArray([100, 100]);
    const b = new Uint8ClampedArray([110, 110]);
    expect(differingFraction(a, b, { threshold: 40 })).toBe(0);
  });

  it("warns only below the threshold", () => {
    expect(looksUnrelated(0.9)).toBe(false);
    expect(looksUnrelated(0.1)).toBe(true);
  });
});

describe("diffMask / dilate / labelRegions", () => {
  it("marks changed pixels", () => {
    const a = new Uint8ClampedArray([0, 0, 0, 0]);
    const b = new Uint8ClampedArray([0, 255, 0, 0]);
    const mask = diffMask(a, b);
    expect([...mask]).toEqual([0, 1, 0, 0]);
  });

  it("dilates a single pixel into its neighbourhood", () => {
    const mask = new Uint8Array(25);
    mask[12] = 1; // centre of a 5x5
    const grown = dilate(mask, 5, 5, 1);
    let count = 0;
    for (const value of grown) count += value;
    expect(count).toBe(9);
  });

  it("labels separated blobs as distinct regions", () => {
    const mask = new Uint8Array(100);
    mask[0] = 1;
    mask[99] = 1;
    const regions = labelRegions(mask, 10, 10);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect(regions[1]).toMatchObject({ x: 9, y: 9 });
  });

  it("drops regions below the minimum area", () => {
    const mask = new Uint8Array(100);
    mask[0] = 1;
    mask[55] = 1;
    mask[56] = 1;
    expect(labelRegions(mask, 10, 10, { minArea: 2 })).toHaveLength(1);
  });

  it("merges nearby marks when dilated", () => {
    const mask = new Uint8Array(100);
    mask[0] = 1;
    mask[3] = 1; // two pixels, 3 apart, on one row
    expect(labelRegions(mask, 10, 10, { minArea: 1 })).toHaveLength(2);
    expect(labelRegions(mask, 10, 10, { minArea: 1, dilate: 2 })).toHaveLength(1);
  });
});

describe("highlight colours", () => {
  it("classifies the four marker colours", () => {
    expect(highlightColorFor(250, 240, 120)).toBe("yellow");
    expect(highlightColorFor(240, 150, 60)).toBe("orange");
    expect(highlightColorFor(140, 220, 140)).toBe("green");
    expect(highlightColorFor(245, 150, 200)).toBe("pink");
  });

  it("leaves paper and ink unclassified", () => {
    expect(highlightColorFor(255, 255, 255)).toBeNull();
    expect(highlightColorFor(10, 10, 10)).toBeNull();
  });

  it("masks only the enabled colours", () => {
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255, // paper
      250, 240, 120, 255, // yellow
      140, 220, 140, 255, // green
    ]);
    const mask = highlightMask(rgba, new Set(["yellow"]));
    expect([...mask]).toEqual([0, 1, 0]);
  });
});

describe("mergeBoxes", () => {
  it("fuses boxes that overlap or sit close together", () => {
    const merged = mergeBoxes(
      [
        { x: 0, y: 0, width: 10, height: 10, area: 100 },
        { x: 5, y: 5, width: 10, height: 10, area: 100 },
        { x: 100, y: 100, width: 5, height: 5, area: 25 },
      ],
      { gap: 4 }
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ x: 0, y: 0, width: 15, height: 15 });
  });
});
