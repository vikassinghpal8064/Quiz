import { describe, it, expect } from "vitest";
import {
  schedule,
  previewIntervals,
  getRetrievability,
  newCardState,
  getScheduler,
  fsrsScheduler,
  parseIntervalText,
  RATINGS,
  STATES,
} from "../index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const MIN = 60_000;
const settings = { scheduler: "fsrs" };

function reviewedCard() {
  let card = newCardState(NOW);
  card = schedule(card, RATINGS.Good, NOW, settings); // New -> Learning
  card = schedule(card, RATINGS.Good, new Date(card.due), settings); // -> Review
  return card;
}

describe("fsrs scheduler", () => {
  it("progresses a new card through learning into review", () => {
    let card = newCardState(NOW);
    expect(card.state).toBe(STATES.New);
    expect(card.reps).toBe(0);

    card = schedule(card, RATINGS.Good, NOW, settings);
    expect(card.state).toBe(STATES.Learning);
    expect(new Date(card.due).getTime()).toBeGreaterThan(NOW.getTime());
    expect(card.reps).toBeGreaterThan(0);

    card = schedule(card, RATINGS.Good, new Date(card.due), settings);
    expect(card.state).toBe(STATES.Review);

    // Intervals (and stability) keep growing once the card is in review.
    const intervals = [card.scheduled_days];
    let previousStability = card.stability;
    for (let i = 0; i < 3; i += 1) {
      card = schedule(card, RATINGS.Good, new Date(card.due), settings);
      expect(card.state).toBe(STATES.Review);
      expect(card.stability).toBeGreaterThan(previousStability);
      intervals.push(card.scheduled_days);
      previousStability = card.stability;
    }
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
  });

  it("records a lapse and relearns soon after a failed review", () => {
    const card = reviewedCard();
    const reviewedAt = new Date(card.due);
    const beforeLapses = card.lapses;

    const lapsed = schedule(card, RATINGS.Again, reviewedAt, settings);
    expect(lapsed.state).toBe(STATES.Relearning);
    expect(lapsed.lapses).toBe(beforeLapses + 1);

    const delay = new Date(lapsed.due).getTime() - reviewedAt.getTime();
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(60 * MIN);
  });

  it("orders preview intervals again < hard < good < easy", () => {
    const assertOrdered = (card) => {
      const preview = previewIntervals(card, new Date(card.due), settings);
      expect(Object.keys(preview).sort()).toEqual(["again", "easy", "good", "hard"]);
      const [again, hard, good, easy] = ["again", "hard", "good", "easy"].map((k) =>
        parseIntervalText(preview[k]),
      );
      expect(again).toBeGreaterThan(0);
      expect(again).toBeLessThan(hard);
      expect(hard).toBeLessThan(good);
      expect(good).toBeLessThan(easy);
      return preview;
    };

    const fresh = assertOrdered(newCardState(NOW));
    expect(fresh.again).toBe("1m");
    assertOrdered(reviewedCard());
  });

  it("reports retrievability within [0,1], decaying over time", () => {
    const card = reviewedCard();
    const atDue = getRetrievability(card, new Date(card.due), settings);
    expect(atDue).toBeGreaterThan(0.8);
    expect(atDue).toBeLessThanOrEqual(1);

    const later = getRetrievability(card, new Date(new Date(card.due).getTime() + 30 * DAY), settings);
    expect(later).toBeLessThan(atDue);
    expect(later).toBeGreaterThanOrEqual(0);

    expect(getRetrievability(newCardState(NOW), NOW, settings)).toBe(0);
  });

  it("is the default scheduler and is reachable through the registry", () => {
    expect(getScheduler({})).toBe(fsrsScheduler);
    expect(getScheduler({ scheduler: "fsrs" })).toBe(fsrsScheduler);
    expect(getScheduler({ scheduler: "unknown" })).toBe(fsrsScheduler);
  });
});
