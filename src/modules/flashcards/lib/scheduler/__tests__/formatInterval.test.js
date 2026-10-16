import { describe, it, expect } from "vitest";
import { formatInterval, parseIntervalText } from "../index.js";

const MIN = 60_000;
const DAY = 86_400_000;

describe("formatInterval", () => {
  it("formats each magnitude readably", () => {
    expect(formatInterval(30_000)).toBe("30s");
    expect(formatInterval(10 * MIN)).toBe("10m");
    expect(formatInterval(90 * MIN)).toBe("2h");
    expect(formatInterval(3 * DAY)).toBe("3d");
    expect(formatInterval(76 * DAY)).toBe("2.5mo");
    expect(formatInterval(400 * DAY)).toBe("1.1y");
  });

  it("treats zero and negative spans as now", () => {
    expect(formatInterval(0)).toBe("now");
    expect(formatInterval(-5)).toBe("now");
    expect(formatInterval(Number.NaN)).toBe("now");
  });

  it("round-trips through parseIntervalText", () => {
    expect(parseIntervalText("10m")).toBe(10 * MIN);
    expect(parseIntervalText("3d")).toBe(3 * DAY);
    expect(parseIntervalText("2.5mo")).toBeCloseTo(2.5 * 30.44 * DAY, 0);
    expect(parseIntervalText("1.2y")).toBeCloseTo(1.2 * 365.25 * DAY, 0);
    expect(Number.isNaN(parseIntervalText("nonsense"))).toBe(true);
  });
});
