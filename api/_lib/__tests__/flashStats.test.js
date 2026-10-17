import { describe, it, expect } from "vitest";
import {
  DEFAULT_HARDEST,
  FORECAST_DAYS,
  HEATMAP_DAYS,
  MAX_HARDEST,
  activityDaysQuery,
  clampRangeDays,
  dailyReviewsQuery,
  dueForecastQuery,
  dueTodayQuery,
  hardestCardsQuery,
  newTodayQuery,
  parseScope,
  retentionQuery,
  reviewsTodayQuery,
  stateBreakdownQuery,
  thinkTimeTrendQuery,
} from "../flashStats.js";

// The stats endpoints build parameterised SQL in one shared module. These assert
// the shapes (scope, placeholders, ORDER BY, clamping) without a database, the
// same way flashStudy.test.js covers candidateQuery.

describe("parseScope", () => {
  it("reads a folder or a category", () => {
    expect(parseScope({})).toEqual({ folderId: null, categoryId: null });
    expect(parseScope({ folderId: "7" })).toEqual({ folderId: 7, categoryId: null });
    expect(parseScope({ categoryId: 9 })).toEqual({ folderId: null, categoryId: 9 });
  });

  it("keeps both when given both (the category is the narrower scope)", () => {
    expect(parseScope({ folderId: 7, categoryId: 9 })).toEqual({ folderId: 7, categoryId: 9 });
  });

  it("rejects a non-positive id", () => {
    expect(parseScope({ folderId: "0" }).error).toMatch(/folderId/);
    expect(parseScope({ categoryId: "-2" }).error).toMatch(/categoryId/);
  });
});

describe("dailyReviewsQuery", () => {
  it("scopes to the user and the heatmap window", () => {
    const query = dailyReviewsQuery({ uid: "u" });
    expect(query.params).toEqual(["u", HEATMAP_DAYS]);
    expect(query.text).toContain("r.user_id = $1");
    expect(query.text).toContain("GROUP BY 1");
  });

  it("adds a folder predicate after the window parameter", () => {
    const query = dailyReviewsQuery({ uid: "u", scope: { folderId: 7 } });
    expect(query.params).toEqual(["u", HEATMAP_DAYS, 7]);
    expect(query.text).toContain("folder_id = $3");
  });

  it("adds a recursive category predicate", () => {
    const query = dailyReviewsQuery({ uid: "u", scope: { categoryId: 9 } });
    expect(query.params).toEqual(["u", HEATMAP_DAYS, 9]);
    expect(query.text).toContain("WITH RECURSIVE sub");
    expect(query.text).toContain("child.parent_id = sub.id");
    expect(query.text).toContain("id = $3");
  });
});

describe("retentionQuery", () => {
  it("splits by state_before and maturity over the selected range", () => {
    const query = retentionQuery({ uid: "u", days: 90 });
    expect(query.params).toEqual(["u", 90]);
    expect(query.text).toContain("r.state_before");
    expect(query.text).toContain("stability_before >= 21");
    expect(query.text).toContain("r.rating >= 3");
    expect(query.text).toContain("r.rating IS NOT NULL");
  });
});

describe("dueForecastQuery", () => {
  it("counts unsuspended due cards within the horizon", () => {
    const query = dueForecastQuery({ uid: "u" });
    expect(query.params).toEqual(["u", FORECAST_DAYS]);
    expect(query.text).toContain("c.suspended = false");
    expect(query.text).toContain("s.due < date_trunc");
  });
});

describe("stateBreakdownQuery", () => {
  it("counts cards by state, split by maturity", () => {
    const query = stateBreakdownQuery({ uid: "u" });
    expect(query.params).toEqual(["u"]);
    expect(query.text).toContain("s.state");
    expect(query.text).toContain("s.stability >= 21");
    expect(query.text).toContain("c.suspended = false");
  });
});

describe("thinkTimeTrendQuery", () => {
  it("averages only positive timings over the range", () => {
    const query = thinkTimeTrendQuery({ uid: "u", days: 14 });
    expect(query.params).toEqual(["u", 14]);
    expect(query.text).toContain("r.think_ms > 0");
    expect(query.text).toContain("round(avg(r.think_ms))");
  });
});

describe("hardestCardsQuery", () => {
  it("orders by struggle score and clamps the limit", () => {
    const query = hardestCardsQuery({ uid: "u" });
    expect(query.params).toEqual(["u", DEFAULT_HARDEST]);
    expect(query.text).toContain("ORDER BY s.struggle_score DESC NULLS LAST");
    expect(query.text).toContain("LIMIT $2");
  });

  it("never asks for more than the cap", () => {
    expect(hardestCardsQuery({ uid: "u", limit: 999 }).params).toEqual(["u", MAX_HARDEST]);
  });
});

describe("dashboard queries", () => {
  it("counts today's reviews, new cards and due cards", () => {
    expect(reviewsTodayQuery({ uid: "u" }).text).toContain("date_trunc('day', now())");
    expect(newTodayQuery({ uid: "u" }).text).toContain("state_before = 0");
    expect(dueTodayQuery({ uid: "u" }).text).toContain("interval '1 day'");
    expect(activityDaysQuery({ uid: "u" }).params).toEqual(["u", HEATMAP_DAYS]);
  });
});

describe("clampRangeDays", () => {
  it("falls back to the default for bad input and caps the maximum", () => {
    expect(clampRangeDays(undefined)).toBe(30);
    expect(clampRangeDays("abc")).toBe(30);
    expect(clampRangeDays(7)).toBe(7);
    expect(clampRangeDays(99999)).toBe(730);
  });
});
