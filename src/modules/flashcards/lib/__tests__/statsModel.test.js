import { describe, it, expect } from "vitest";
import {
  addDays,
  arcPath,
  buildForecast,
  buildHeatmap,
  buildTrend,
  classifyState,
  computeStreak,
  countsByDay,
  dayKey,
  daysBetween,
  donutSegments,
  heatLevel,
  linePath,
  niceCeil,
  parseDay,
  scaleLinear,
  summarizeRetention,
  summarizeStates,
  todayKey,
} from "../statsModel.js";

// The stats screen's maths lives in one pure module shared by the server (which
// shapes the SQL rows) and the client (which draws the charts). These cover the
// behaviour a chart depends on, without a database or a DOM.

describe("day helpers", () => {
  it("normalises dates, timestamps and keys to a UTC day", () => {
    expect(dayKey("2026-03-15")).toBe("2026-03-15");
    expect(dayKey("2026-03-15T23:30:00.000Z")).toBe("2026-03-15");
    expect(dayKey(new Date("2026-03-15T05:00:00.000Z"))).toBe("2026-03-15");
    expect(dayKey(null)).toBe(null);
    expect(dayKey("nonsense")).toBe(null);
  });

  it("adds and subtracts whole days", () => {
    expect(addDays("2026-03-15", 1)).toBe("2026-03-16");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("parses a day to a UTC midnight Date", () => {
    expect(parseDay("2026-03-15").toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("counts whole days between two keys", () => {
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
    expect(daysBetween("2026-03-15", "2026-03-01")).toBe(-14);
    expect(daysBetween("bad", "2026-03-01")).toBe(null);
  });

  it("todayKey uses the UTC day of the given instant", () => {
    expect(todayKey(new Date("2026-03-15T23:59:59Z"))).toBe("2026-03-15");
  });
});

describe("heatLevel", () => {
  it("buckets a day's count against the range maximum", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(2, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(7, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(20, 10)).toBe(4);
  });

  it("never divides by a zero maximum", () => {
    expect(heatLevel(3, 0)).toBe(1);
  });
});

describe("computeStreak", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  it("counts consecutive days ending today", () => {
    const counts = { "2026-03-15": 1, "2026-03-14": 2, "2026-03-13": 1 };
    expect(computeStreak(counts, now)).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the streak alive until the day is over", () => {
    // Nothing today yet, but yesterday and the day before were studied.
    const counts = { "2026-03-14": 1, "2026-03-13": 1 };
    expect(computeStreak(counts, now).current).toBe(2);
  });

  it("breaks the current streak on a missed day but remembers the longest", () => {
    const counts = { "2026-03-15": 1, "2026-03-13": 1, "2026-02-01": 1, "2026-02-02": 1, "2026-02-03": 1, "2026-02-04": 1 };
    const streak = computeStreak(counts, now);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(4);
  });

  it("accepts a Map or an array of day keys", () => {
    expect(computeStreak(new Map([["2026-03-15", 1]]), now).current).toBe(1);
    expect(computeStreak(["2026-03-15", "2026-03-14"], now).current).toBe(2);
  });

  it("treats a zero-count day as inactive", () => {
    // Today has a row but no reviews, so it does not extend the streak; the run
    // still reaches back through yesterday and the day before.
    const streak = computeStreak({ "2026-03-15": 0, "2026-03-14": 1, "2026-03-13": 1 }, now);
    expect(streak.current).toBe(2);
  });
});

describe("buildHeatmap", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  it("lays out whole Sunday-to-Saturday weeks ending with today", () => {
    const heatmap = buildHeatmap(
      [
        { day: "2026-03-15", n: 5 },
        { day: "2026-03-14", n: 2 },
      ],
      { weeks: 53, now }
    );

    expect(heatmap.cells).toHaveLength(53 * 7);
    expect(heatmap.end).toBe("2026-03-15");
    expect(heatmap.total).toBe(7);
    expect(heatmap.max).toBe(5);
    // The final cell is the Saturday that closes today's week.
    const last = heatmap.cells[heatmap.cells.length - 1];
    expect(new Date(`${last.date}T00:00:00Z`).getUTCDay()).toBe(6);
    // Every day in the last column after today is flagged as a placeholder.
    expect(last.inFuture).toBe(true);
    expect(heatmap.current_streak).toBe(2);
    // 5 of the 5 maximum is the top intensity.
    const cell = heatmap.cells.find((c) => c.date === "2026-03-15");
    expect(cell.level).toBe(4);
    expect(cell.count).toBe(5);
  });

  it("survives an empty history", () => {
    const heatmap = buildHeatmap([], { now });
    expect(heatmap.total).toBe(0);
    expect(heatmap.max).toBe(0);
    expect(heatmap.current_streak).toBe(0);
    expect(heatmap.cells.every((c) => c.level === 0)).toBe(true);
  });
});

describe("countsByDay", () => {
  it("folds rows and tolerates the several field names", () => {
    const counts = countsByDay([
      { day: "2026-03-15", n: 2 },
      { date: "2026-03-15", count: 3 },
      { day: "2026-03-14", n: 1 },
      { day: null, n: 9 },
    ]);
    expect(counts.get("2026-03-15")).toBe(5);
    expect(counts.get("2026-03-14")).toBe(1);
  });
});

describe("cards by state", () => {
  it("classifies state and maturity into the four buckets", () => {
    expect(classifyState({ state: 0 })).toBe("new");
    expect(classifyState({ state: 1 })).toBe("learning");
    expect(classifyState({ state: 3 })).toBe("learning");
    expect(classifyState({ state: 2, stability: 5 })).toBe("review");
    expect(classifyState({ state: 2, stability: 40 })).toBe("mastered");
  });

  it("accepts the precomputed `mature` flag the aggregated SQL returns", () => {
    expect(classifyState({ state: 2, mature: true })).toBe("mastered");
    expect(classifyState({ state: 2, mature: false })).toBe("review");
  });

  it("sums rows into the buckets with a grand total", () => {
    const states = summarizeStates([
      { state: 0, n: 3 },
      { state: 1, n: 2 },
      { state: 3, n: 1 },
      { state: 2, stability: 30, n: 4 },
      { state: 2, stability: 5, n: 6 },
    ]);
    expect(states).toEqual({ new: 3, learning: 3, review: 6, mastered: 4, total: 16 });
  });

  it("uses the precomputed `mature` flag when the SQL groups by it", () => {
    const states = summarizeStates([
      { state: 0, n: 1 },
      { state: 1, n: 1 },
      { state: 2, mature: true, n: 1 },
      { state: 2, mature: false, n: 1 },
    ]);
    expect(states).toEqual({ new: 1, learning: 1, review: 1, mastered: 1, total: 4 });
  });
});

describe("summarizeRetention", () => {
  const rows = [
    { state_before: 2, stability_before: 30, total: 10, correct: 9 },
    { state_before: 2, stability_before: 5, total: 10, correct: 7 },
    { state_before: 1, stability_before: 0, total: 5, correct: 5 },
  ];

  it("measures true retention only on cards already in Review", () => {
    const retention = summarizeRetention(rows);
    expect(retention.overall).toEqual({ correct: 16, total: 20, rate: 0.8 });
    expect(retention.mature).toEqual({ correct: 9, total: 10, rate: 0.9 });
    expect(retention.young).toEqual({ correct: 7, total: 10, rate: 0.7 });
  });

  it("reports a null rate rather than dividing by zero", () => {
    expect(summarizeRetention([]).mature).toEqual({ correct: 0, total: 0, rate: null });
  });

  it("reads the precomputed `mature` flag from grouped rows", () => {
    const grouped = [
      { state_before: 2, mature: true, total: 10, correct: 9 },
      { state_before: 2, mature: false, total: 10, correct: 7 },
      { state_before: 1, mature: false, total: 5, correct: 5 },
    ];
    const retention = summarizeRetention(grouped);
    expect(retention.overall).toEqual({ correct: 16, total: 20, rate: 0.8 });
    expect(retention.mature).toEqual({ correct: 9, total: 10, rate: 0.9 });
    expect(retention.young).toEqual({ correct: 7, total: 10, rate: 0.7 });
  });
});

describe("buildForecast", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  it("folds overdue cards into the first day and pads the series", () => {
    const forecast = buildForecast(
      [
        { day: "2026-03-10", n: 3 },
        { day: "2026-03-15", n: 2 },
        { day: "2026-03-18", n: 4 },
      ],
      { days: 30, now }
    );

    expect(forecast.days).toHaveLength(30);
    expect(forecast.days[0]).toMatchObject({ date: "2026-03-15", count: 5, overdue: 3 });
    expect(forecast.days[3]).toMatchObject({ date: "2026-03-18", count: 4 });
    expect(forecast.overdue).toBe(3);
    expect(forecast.max).toBe(5);
    expect(forecast.total).toBe(9);
  });
});

describe("buildTrend", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  it("leaves gaps as null and reports a review-weighted average", () => {
    const trend = buildTrend(
      [
        { day: "2026-03-15", avg_ms: 4000, n: 2 },
        { day: "2026-03-14", avg_ms: 6000, n: 1 },
      ],
      { days: 3, now }
    );

    expect(trend.days.map((d) => d.date)).toEqual(["2026-03-13", "2026-03-14", "2026-03-15"]);
    expect(trend.days[0].avg_ms).toBe(null);
    expect(trend.days[1].avg_ms).toBe(6000);
    // (6000 * 1 + 4000 * 2) / 3
    expect(trend.average_ms).toBe(4667);
  });

  it("has no average when nothing was reviewed", () => {
    expect(buildTrend([], { days: 7, now }).average_ms).toBe(null);
  });
});

describe("chart geometry", () => {
  it("rounds a maximum up to a friendly ceiling", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(12)).toBe(20);
    expect(niceCeil(45)).toBe(50);
    expect(niceCeil(200)).toBe(200);
  });

  it("maps a domain onto a range linearly", () => {
    const scale = scaleLinear([0, 10], [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(100);
  });

  it("collapses a zero-width domain to the range midpoint", () => {
    expect(scaleLinear([4, 4], [0, 100])(4)).toBe(50);
  });

  it("builds a line path, lifting the pen over a gap", () => {
    const d = linePath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: null }, { x: 30, y: 5 }]);
    expect(d).toBe("M0,10 L10,0 M30,5");
  });

  it("splits a donut into slices, starting at the top", () => {
    const segments = donutSegments([1, 1]);
    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBeLessThan(segments[0].end);
    expect(segments[1].start).toBeGreaterThan(segments[0].start);
  });

  it("keeps a slot for a zero slice but draws nothing", () => {
    const segments = donutSegments([3, 0, 1]);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toBe(null);
    expect(segments[0]).not.toBe(null);
  });

  it("returns nulls when every value is zero", () => {
    expect(donutSegments([0, 0])).toEqual([null, null]);
  });

  it("draws a donut arc as a closed path", () => {
    const path = arcPath(50, 50, 40, 25, 0, Math.PI / 2);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).toContain("A40,40");
    expect(path).toContain("A25,25");
  });
});
