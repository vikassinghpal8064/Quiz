import { describe, it, expect } from "vitest";
import {
  candidateQuery,
  cardStateFromRow,
  focusLimit,
  newCapRemaining,
  orderQueue,
  rollingAverage,
  settingsFromRows,
  summarizeRatings,
  planReview,
} from "../flashStudy.js";
import { DEFAULT_SETTINGS, RATINGS } from "../../../src/modules/flashcards/lib/scheduler/index.js";

// The study flow reuses the client's pure scheduler on the server. These cover
// the thin server-side wrapper (settings mapping, focus sizing, the review plan)
// without a database.

describe("settingsFromRows", () => {
  it("overlays stored rows on the documented defaults", () => {
    const settings = settingsFromRows([
      { key: "scheduler", value: "sm2" },
      { key: "focus_fraction", value: 0.5 },
      { key: "focus_min", value: 2 },
    ]);
    expect(settings.scheduler).toBe("sm2");
    expect(settings.focus_fraction).toBe(0.5);
    expect(settings.focus_min).toBe(2);
    // untouched keys keep their default
    expect(settings.new_cards_per_day).toBe(DEFAULT_SETTINGS.new_cards_per_day);
  });

  it("is defensive about missing / malformed rows", () => {
    expect(settingsFromRows(undefined).scheduler).toBe("fsrs");
    expect(settingsFromRows([null, {}, { value: 1 }]).scheduler).toBe("fsrs");
  });
});

describe("focusLimit", () => {
  it("never invents cards for an empty queue", () => {
    expect(focusLimit(0)).toBe(0);
  });

  it("rounds a fraction of what is due", () => {
    // 100 due * 0.25 = 25, inside the default [10, 60] window.
    expect(focusLimit(100)).toBe(25);
  });

  it("honours focus_min when it is the binding constraint", () => {
    // 20 * 0.25 = 5, lifted to the floor of 10.
    expect(focusLimit(20, { focus_fraction: 0.25, focus_min: 10, focus_max: 60 })).toBe(10);
    // Floor of 3 still applies when only 4 are due: max(3, round(4 * 0.5)) = 3.
    expect(focusLimit(4, { focus_fraction: 0.5, focus_min: 3, focus_max: 60 })).toBe(3);
  });

  it("clamps down to focus_max", () => {
    expect(focusLimit(1000)).toBe(60); // above the default ceiling
    expect(focusLimit(100, { focus_fraction: 1, focus_min: 1, focus_max: 30 })).toBe(30);
  });

  it("never queues more than what is actually due", () => {
    // The floor cannot invent cards: 8 due with a floor of 10 stays 8.
    expect(focusLimit(8)).toBe(8);
    expect(focusLimit(1, { focus_fraction: 0.25, focus_min: 3, focus_max: 60 })).toBe(1);
    expect(focusLimit(3, { focus_min: 1, focus_max: 60, focus_fraction: 1 })).toBe(3);
  });
});

describe("rollingAverage", () => {
  it("seeds from the first reading", () => {
    expect(rollingAverage(null, 0, 4000)).toBe(4000);
  });

  it("weights by the number of prior reps", () => {
    // (2000 * 3 + 6000) / 4 = 3000
    expect(rollingAverage(2000, 3, 6000)).toBe(3000);
  });

  it("keeps the previous value when the reading is unusable", () => {
    expect(rollingAverage(2500, 4, undefined)).toBe(2500);
    expect(rollingAverage(null, 0, undefined)).toBe(null);
  });
});

describe("summarizeRatings", () => {
  it("buckets rating counts by name and totals them", () => {
    const summary = summarizeRatings([
      { rating: RATINGS.Again, n: 2 },
      { rating: RATINGS.Good, n: 5 },
      { rating: RATINGS.Easy, n: 1 },
    ]);
    expect(summary).toEqual({ again: 2, hard: 0, good: 5, easy: 1, total: 8 });
  });

  it("returns zeroes for no rows", () => {
    expect(summarizeRatings(null)).toEqual({ again: 0, hard: 0, good: 0, easy: 0, total: 0 });
  });
});

describe("planReview", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("advances a new card and reports the struggle score", () => {
    const plan = planReview({
      context: {
        card_type: "basic",
        state: 0,
        reps: 0,
        lapses: 0,
        avg_think_ms: null,
        recent: [],
      },
      rating: "good",
      thinkMs: 5000,
      now,
      settings: { scheduler: "fsrs" },
    });

    expect(plan.rating).toBe(RATINGS.Good);
    expect(plan.after.state).toBe(1); // Learning
    expect(new Date(plan.after.due).getTime()).toBeGreaterThan(now.getTime());
    expect(plan.struggleScore).toBeGreaterThanOrEqual(0);
    expect(plan.struggleScore).toBeLessThanOrEqual(1);
    expect(plan.avgThinkMs).toBe(5000);
  });

  it("rejects an out-of-range rating", () => {
    expect(() =>
      planReview({
        context: { state: 0, reps: 0, lapses: 0, recent: [] },
        rating: 9,
        now,
        settings: {},
      })
    ).toThrow();
  });
});

describe("cardStateFromRow", () => {
  it("back-fills a missing state row into the scheduler shape", () => {
    const state = cardStateFromRow(null);
    expect(state).toMatchObject({ state: 0, reps: 0, lapses: 0, stability: 0, difficulty: 0 });
  });
});

describe("candidateQuery", () => {
  it("scopes a tag with an array-containment filter", () => {
    const query = candidateQuery({ uid: "u", scopeType: "tag", tag: "grammar", mode: "due" });
    expect(query.text).toContain("c.tags @> ARRAY[$2]::text[]");
    expect(query.params).toEqual(["u", "grammar"]);
  });

  it("scopes a folder to its categories", () => {
    const query = candidateQuery({ uid: "u", scopeType: "folder", scopeId: 7, mode: "due" });
    expect(query.text).toContain("folder_id = $2");
    expect(query.params).toEqual(["u", 7]);
  });
});

describe("newCapRemaining", () => {
  it("subtracts what has already been introduced today", () => {
    expect(newCapRemaining({ new_cards_per_day: 20 }, 5)).toBe(15);
    expect(newCapRemaining({ new_cards_per_day: 20 }, 25)).toBe(0);
    expect(newCapRemaining({}, 3)).toBe(DEFAULT_SETTINGS.new_cards_per_day - 3);
    expect(newCapRemaining({ new_cards_per_day: 0 }, 0)).toBe(0);
  });
});

describe("orderQueue", () => {
  const now = new Date("2026-03-01T00:00:00.000Z");
  const dayMs = 86_400_000;

  const reviewed = (id, daysAgo, stability = 5) => ({
    id,
    state: 2,
    due: new Date(now.getTime() - 1000).toISOString(),
    stability,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    last_review: new Date(now.getTime() - daysAgo * dayMs).toISOString(),
  });
  const fresh = (id) => ({
    id,
    state: 0,
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
  });

  it("puts the least-retrievable due card first, then new cards", () => {
    const ids = orderQueue([reviewed(1, 1), fresh(9), reviewed(2, 30)], { mode: "due", now });
    expect(ids[0]).toBe(2); // 30 days since review -> lowest retrievability
    expect(ids[ids.length - 1]).toBe(9); // new card is appended last
  });

  it("caps the new-card tail at newCap", () => {
    const ids = orderQueue([reviewed(1, 5), fresh(2), fresh(3), fresh(4)], {
      mode: "due",
      now,
      newCap: 1,
    });
    expect(ids).toEqual([1, 2]);
  });

  it("keeps the SQL order for other modes", () => {
    expect(orderQueue([fresh(3), reviewed(1, 1)], { mode: "all", now })).toEqual([3, 1]);
  });
});
