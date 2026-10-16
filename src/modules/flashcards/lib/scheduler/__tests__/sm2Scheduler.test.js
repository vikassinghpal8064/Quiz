import { describe, it, expect } from "vitest";
import {
  schedule,
  previewIntervals,
  getRetrievability,
  newCardState,
  getScheduler,
  sm2Scheduler,
  parseIntervalText,
  RATINGS,
  STATES,
} from "../index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const MIN = 60_000;
const settings = { scheduler: "sm2" };

describe("sm2 scheduler", () => {
  it("schedules a new card into review a few days out", () => {
    const card = schedule(newCardState(NOW), RATINGS.Good, NOW, settings);
    expect(card.state).toBe(STATES.Review);
    expect(card.stability).toBe(3);
    expect(card.difficulty).toBeCloseTo(2.5, 5);
    expect(new Date(card.due).getTime()).toBe(NOW.getTime() + 3 * DAY);
    expect(card.reps).toBe(1);
    expect(card.lapses).toBe(0);
  });

  it("records a lapse, resets reps and relearns soon", () => {
    const card = schedule(newCardState(NOW), RATINGS.Good, NOW, settings);
    const reviewedAt = new Date(card.due);

    const lapsed = schedule(card, RATINGS.Again, reviewedAt, settings);
    expect(lapsed.state).toBe(STATES.Relearning);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.stability).toBe(0);
    expect(new Date(lapsed.due).getTime() - reviewedAt.getTime()).toBe(10 * MIN);
  });

  it("orders preview intervals again < hard < good < easy", () => {
    const preview = previewIntervals(newCardState(NOW), NOW, settings);
    expect(preview.again).toBe("10m");
    const values = ["again", "hard", "good", "easy"].map((k) => parseIntervalText(preview[k]));
    expect(values[0]).toBeLessThan(values[1]);
    expect(values[1]).toBeLessThan(values[2]);
    expect(values[2]).toBeLessThan(values[3]);
  });

  it("grows the interval on success and exposes retrievability", () => {
    let card = schedule(newCardState(NOW), RATINGS.Good, NOW, settings);
    const first = card.stability;
    card = schedule(card, RATINGS.Good, new Date(card.due), settings);
    expect(card.stability).toBeGreaterThan(first);

    const r = getRetrievability(card, new Date(card.due), settings);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(getRetrievability(newCardState(NOW), NOW, settings)).toBe(0);
  });

  it("is reachable through the registry", () => {
    expect(getScheduler(settings)).toBe(sm2Scheduler);
  });
});
