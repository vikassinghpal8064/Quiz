// The card-state shape the schedulers read and write. It is a plain,
// JSON-serialisable object so it can travel over the API and live in
// fc_card_state without any conversion layer.
//
//   state           0 New | 1 Learning | 2 Review | 3 Relearning
//   due             ISO string (or null)
//   stability       number, FSRS stability in days (SM-2 reuses it as the
//                   current interval in days)
//   difficulty      number, FSRS difficulty 1-10 (SM-2 reuses it as the ease
//                   factor)
//   reps/lapses     integers
//   last_review     ISO string (or null)
//   scheduled_days  last interval, in days
//   learning_steps  index into the (re)learning steps
//   elapsed_days    days since last_review
//
// No imports: conversion to/from ts-fsrs' Card happens in fsrsScheduler.js.

export const DAY_MS = 86_400_000;

// Coerce Date | number | ISO string to a valid Date, or null.
export function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Whole (or fractional) days from `from` to `to`.
export function diffDays(to, from) {
  const a = toDate(to);
  const b = toDate(from);
  if (!a || !b) return 0;
  return (a.getTime() - b.getTime()) / DAY_MS;
}

function asFiniteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// Fill in every field with a sane default so schedulers never see undefined.
export function normalizeCardState(state = {}) {
  const source = state ?? {};
  return {
    state: asFiniteNumber(source.state, 0),
    due: source.due ?? null,
    stability: asFiniteNumber(source.stability, 0),
    difficulty: asFiniteNumber(source.difficulty, 0),
    reps: asFiniteNumber(source.reps, 0),
    lapses: asFiniteNumber(source.lapses, 0),
    last_review: source.last_review ?? null,
    scheduled_days: asFiniteNumber(source.scheduled_days, 0),
    learning_steps: asFiniteNumber(source.learning_steps, 0),
    elapsed_days: asFiniteNumber(source.elapsed_days, 0),
  };
}

// A brand-new, never-reviewed card, due immediately.
export function newCardState(now) {
  const at = toDate(now) ?? new Date();
  return {
    state: 0,
    due: at.toISOString(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    scheduled_days: 0,
    learning_steps: 0,
    elapsed_days: 0,
  };
}
