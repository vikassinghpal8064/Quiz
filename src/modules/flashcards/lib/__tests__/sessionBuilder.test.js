import { describe, it, expect } from "vitest";
import {
  buildFocusQueue,
  focusTarget,
  FOCUS_DUE_SHARE,
  FOCUS_STRUGGLE_SHARE,
  FOCUS_NEW_SHARE,
  REASONS,
} from "../sessionBuilder.js";

// The focus builder is pure: it takes the active cards in scope and returns the
// ordered queue plus what each pool contributed. These tests pin the sizing
// rule, the pool caps, the leftover-due figure and the ordering aids.

const NOW = new Date("2026-05-01T12:00:00.000Z");
const PAST = new Date(NOW.getTime() - 86_400_000).toISOString();
const FUTURE = new Date(NOW.getTime() + 10 * 86_400_000).toISOString();

function due(id, overrides = {}) {
  return {
    id,
    category_id: 1,
    state: 2,
    due: PAST,
    stability: 5,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    last_review: PAST,
    struggle_score: 0,
    last_seen_session: null,
    ...overrides,
  };
}

function fresh(id, overrides = {}) {
  return {
    id,
    category_id: 1,
    state: 0,
    due: NOW.toISOString(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    struggle_score: 0,
    last_seen_session: null,
    ...overrides,
  };
}

const settings = (overrides = {}) => ({
  focus_fraction: 0.25,
  focus_min: 1,
  focus_max: 60,
  ...overrides,
});

const countOf = (entries, reason) => entries.filter((e) => e.reason === reason).length;

describe("focusTarget", () => {
  it("never invents cards for an empty deck", () => {
    expect(focusTarget(0, settings())).toBe(0);
  });

  it("takes a fraction of the active deck, rounded up", () => {
    expect(focusTarget(100, settings())).toBe(25);
    expect(focusTarget(4, settings({ focus_fraction: 0.5 }))).toBe(2);
    expect(focusTarget(5, settings({ focus_fraction: 0.5 }))).toBe(3); // ceil
  });

  it("honours focus_min and focus_max", () => {
    expect(focusTarget(20, settings({ focus_fraction: 0.1, focus_min: 10 }))).toBe(10);
    expect(focusTarget(1000, settings())) .toBe(60);
  });

  it("never exceeds the deck, even when focus_min asks for more", () => {
    expect(focusTarget(3, settings({ focus_fraction: 0.25, focus_min: 10 }))).toBe(3);
  });
});

describe("buildFocusQueue", () => {
  it("returns nothing for an empty deck", () => {
    const { entries, meta } = buildFocusQueue({ cards: [], settings: settings(), now: NOW });
    expect(entries).toEqual([]);
    expect(meta.target).toBe(0);
    expect(meta.leftover_due).toBe(0);
  });

  it("caps each pool and reports the leftover due cards", () => {
    const cards = [
      ...Array.from({ length: 20 }, (_, i) => due(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => due(100 + i, { due: FUTURE, struggle_score: 0.9 })),
      ...Array.from({ length: 10 }, (_, i) => fresh(200 + i)),
    ];
    const { entries, meta } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 0.25 }), // 40 cards -> N = 10
      now: NOW,
      newCap: 20,
    });

    expect(entries.length).toBe(10);
    expect(meta.target).toBe(10);
    // 45% / 30% / 15% of 10 -> 4 / 3 / 1, coverage takes the last 2.
    expect(countOf(entries, REASONS.Due)).toBe(Math.floor(10 * FOCUS_DUE_SHARE));
    expect(countOf(entries, REASONS.Struggle)).toBe(Math.floor(10 * FOCUS_STRUGGLE_SHARE));
    expect(countOf(entries, REASONS.New)).toBe(Math.floor(10 * FOCUS_NEW_SHARE));
    // 20 due cards: 4 queued as due, 2 more rescued by the coverage fill.
    expect(meta.leftover_due).toBe(20 - Math.floor(10 * FOCUS_DUE_SHARE) - 2);
  });

  it("never queues more new cards than the daily budget allows", () => {
    const cards = [
      ...Array.from({ length: 4 }, (_, i) => due(i + 1)),
      ...Array.from({ length: 6 }, (_, i) => fresh(100 + i)),
    ];
    const { entries, meta } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 1 }), // N = 10
      now: NOW,
      newCap: 1,
    });
    expect(countOf(entries, REASONS.New)).toBe(1);
    // Coverage must not smuggle new cards past the exhausted budget.
    expect(countOf(entries, REASONS.Stale)).toBe(0);
    expect(meta.due).toBe(4);
    expect(entries.length).toBe(5);
  });

  it("keeps a card's struggle slot even when it is not due", () => {
    const cards = [
      due(1, { due: FUTURE, struggle_score: 0.8 }),
      due(2, { due: FUTURE, struggle_score: 0.6 }),
      due(3),
      due(4),
    ];
    const { entries } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 1, focus_min: 4, focus_max: 4 }),
      now: NOW,
      newCap: 0,
    });
    // The higher-scored, not-yet-due card earns the single struggle slot.
    const struggled = entries.find((e) => e.id === 1);
    expect(struggled?.reason).toBe(REASONS.Struggle);
    expect(entries.find((e) => e.id === 2)?.reason).not.toBe(REASONS.Struggle);
  });

  it("fills the coverage slots from the oldest last_seen_session first", () => {
    const cards = [
      due(1, { due: FUTURE, last_seen_session: 30 }),
      due(2, { due: FUTURE, last_seen_session: null }),
      due(3, { due: FUTURE, last_seen_session: 10 }),
    ];
    const { entries } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 1, focus_min: 3, focus_max: 3 }),
      now: NOW,
      newCap: 0,
    });
    // Never-seen first, then the smallest session id.
    expect(entries.map((e) => e.id)).toEqual([2, 3, 1]);
    expect(entries.every((e) => e.reason === REASONS.Stale)).toBe(true);
  });

  it("interleaves categories for a folder-wide queue", () => {
    const cards = [
      due(1, { category_id: 1 }),
      due(2, { category_id: 1 }),
      due(3, { category_id: 2 }),
      due(4, { category_id: 2 }),
    ];
    const { entries } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 1, focus_min: 4, focus_max: 4 }),
      now: NOW,
      interleave: true,
    });
    const categories = entries.map((e) => e.category_id);
    // No two consecutive cards from the same category.
    for (let i = 1; i < categories.length; i += 1) {
      expect(categories[i]).not.toBe(categories[i - 1]);
    }
  });

  it("spreads struggle cards apart", () => {
    const cards = [
      due(1, { due: FUTURE, struggle_score: 0.9 }),
      due(2, { due: FUTURE, struggle_score: 0.9 }),
      due(3, { due: FUTURE, struggle_score: 0.9 }),
      due(4),
      due(5),
      due(6),
      due(7),
      due(8),
      due(9),
      due(10),
    ];
    const { entries } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 1 }),
      now: NOW,
    });
    const positions = entries
      .map((e, i) => (e.reason === REASONS.Struggle ? i : -1))
      .filter((i) => i >= 0);
    expect(positions.length).toBe(3);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i] - positions[i - 1]).toBeGreaterThan(1);
    }
  });

  it("stops once the daily new-card budget is spent", () => {
    const cards = Array.from({ length: 8 }, (_, i) => fresh(i + 1));
    const { entries } = buildFocusQueue({
      cards,
      settings: settings({ focus_fraction: 1 }),
      now: NOW,
      // newCapRemaining({ new_cards_per_day: 20 }, 18) === 2.
      newCap: 2,
    });
    expect(countOf(entries, REASONS.New)).toBe(2);
    // Nothing but new cards exist, so the queue stops at the budget.
    expect(entries.length).toBe(2);
  });
});
