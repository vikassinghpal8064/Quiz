import { describe, it, expect } from "vitest";
import {
  computeBaseline,
  computeTimeRatio,
  computeRates,
  computeStruggleScore,
  isShakyCorrect,
  DEFAULT_BASELINE_MS,
  RATINGS,
} from "../index.js";

// 5 reviews: correct times 4000/6000/8000, plus one Again and one Hard.
const reviews = [
  { rating: RATINGS.Good, think_ms: 4000 },
  { rating: RATINGS.Good, think_ms: 6000 },
  { rating: RATINGS.Easy, think_ms: 8000 },
  { rating: RATINGS.Again, think_ms: 20000 },
  { rating: RATINGS.Hard, think_ms: 10000 },
];

describe("struggle scoring", () => {
  it("computeBaseline is the median think-time of correct answers", () => {
    expect(computeBaseline(reviews)).toBe(6000);
  });

  it("computeBaseline falls back when there is no usable history", () => {
    expect(computeBaseline([])).toBe(DEFAULT_BASELINE_MS);
    expect(computeBaseline([{ rating: RATINGS.Again, think_ms: 1000 }])).toBe(DEFAULT_BASELINE_MS);
  });

  it("computeBaseline can be scoped to a card type", () => {
    const typed = [
      { rating: RATINGS.Good, think_ms: 1000, card_type: "basic" },
      { rating: RATINGS.Good, think_ms: 9000, card_type: "cloze" },
      { rating: RATINGS.Good, think_ms: 3000, card_type: "basic" },
    ];
    expect(computeBaseline(typed, "basic")).toBe(2000);
  });

  it("computeTimeRatio reports think-time over baseline and is safe on bad input", () => {
    expect(computeTimeRatio(5000, 5000)).toBe(1);
    expect(computeTimeRatio(10000, 5000)).toBe(2);
    expect(computeTimeRatio(5000, 0)).toBe(0);
    expect(computeTimeRatio(-1, 5000)).toBe(0);
    expect(computeTimeRatio(5000, -5)).toBe(0);
  });

  it("computeRates summarises the last five reviews", () => {
    const { againRate5, hardRate5 } = computeRates(reviews);
    expect(againRate5).toBeCloseTo(1 / 5, 5);
    expect(hardRate5).toBeCloseTo(1 / 5, 5);
    expect(computeRates([])).toEqual({ againRate5: 0, hardRate5: 0 });
  });

  it("computeStruggleScore stays within [0,1] across extremes", () => {
    const settings = {};
    expect(computeStruggleScore({ timeRatio: 0, againRate5: 0, lapses: 0, hardRate5: 0, settings })).toBe(0);
    // Weights sum to 1 (up to float rounding), so the maximal inputs saturate.
    expect(
      computeStruggleScore({ timeRatio: 100, againRate5: 1, lapses: 100, hardRate5: 1, settings }),
    ).toBeCloseTo(1, 10);

    for (const timeRatio of [0, 0.5, 1, 2, 3, 10]) {
      for (const againRate5 of [0, 0.5, 1]) {
        for (const lapses of [0, 3, 6, 20]) {
          const score = computeStruggleScore({ timeRatio, againRate5, hardRate5: 0.3, lapses, settings });
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("applies weights from settings", () => {
    const settings = { struggle_weights: { time: 0, again: 0, lapse: 1, hard: 0 } };
    expect(
      computeStruggleScore({ timeRatio: 10, againRate5: 1, lapses: 3, hardRate5: 1, settings }),
    ).toBeCloseTo(0.5, 5);
    expect(
      computeStruggleScore({ timeRatio: 10, againRate5: 1, lapses: 6, hardRate5: 1, settings }),
    ).toBe(1);
  });

  it("derives its metrics from raw reviews when not supplied", () => {
    const score = computeStruggleScore({ reviews, thinkMs: 12000, lapses: 2, settings: {} });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("isShakyCorrect flags correct-but-slow answers only", () => {
    const baseline = 5000;
    expect(isShakyCorrect(RATINGS.Good, 4000, baseline)).toBe(false);
    expect(isShakyCorrect(RATINGS.Good, 5000, baseline)).toBe(false);
    expect(isShakyCorrect(RATINGS.Good, 9000, baseline)).toBe(true); // > 1.75 * baseline
    expect(isShakyCorrect(RATINGS.Easy, 9001, baseline)).toBe(true);

    // Wrong answers are never "shaky correct".
    expect(isShakyCorrect(RATINGS.Again, 20000, baseline)).toBe(false);
    expect(isShakyCorrect(RATINGS.Hard, 20000, baseline)).toBe(false);

    // Custom threshold.
    expect(isShakyCorrect(RATINGS.Good, 12000, baseline, 3)).toBe(false);
    expect(isShakyCorrect(RATINGS.Good, 16000, baseline, 3)).toBe(true);

    // No usable baseline -> never flag.
    expect(isShakyCorrect(RATINGS.Good, 20000, 0)).toBe(false);
  });
});
