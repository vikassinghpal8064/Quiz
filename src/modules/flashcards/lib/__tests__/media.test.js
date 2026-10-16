import { describe, it, expect } from "vitest";
import { fitWithin } from "../image";
import { extensionFor, mediaPathname } from "../media";
import { downsamplePeaks, rollingLevel } from "../waveform";

describe("image.fitWithin", () => {
  it("leaves an image already inside the box untouched", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("scales the longest edge down to the limit and keeps the aspect ratio", () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1600, 3200, 1600)).toEqual({ width: 800, height: 1600 });
  });

  it("never produces a zero dimension", () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 1, height: 1 });
  });
});

describe("media pathnames", () => {
  it("prefers a real file extension", () => {
    expect(extensionFor("audio", "Clip.WAV", "audio/webm")).toBe("wav");
  });

  it("falls back to the mime type, then the kind", () => {
    expect(extensionFor("image", "", "image/png")).toBe("png");
    expect(extensionFor("audio", "", "")).toBe("webm");
    expect(extensionFor("image", "", "")).toBe("webp");
  });

  it("scopes the path under fc/<kind>/ with a generated name", () => {
    const pathname = mediaPathname("image", { mime: "image/webp" });
    expect(pathname).toMatch(/^fc\/image\/[A-Za-z0-9]+\.webp$/);
  });
});

describe("waveform", () => {
  it("reduces samples to the requested number of peaks", () => {
    const peaks = downsamplePeaks([0, 0.5, 1, -1, 0.2, 0], 3);
    expect(peaks).toHaveLength(3);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(1);
    expect(peaks[2]).toBeCloseTo(0.2);
  });

  it("handles empty input and clamps to 0..1", () => {
    expect(downsamplePeaks([], 4)).toEqual([0, 0, 0, 0]);
    expect(downsamplePeaks([2, -3], 2).every((p) => p <= 1)).toBe(true);
  });

  it("averages a rolling level", () => {
    expect(rollingLevel([0, 1])).toBe(0.5);
    expect(rollingLevel([])).toBe(0);
  });
});
