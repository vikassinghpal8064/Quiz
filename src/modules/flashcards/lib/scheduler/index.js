// Public entry point for the scheduler module.
//
// Everything here is pure and runs unchanged on the client and the server. The
// top-level schedule / previewIntervals / getRetrievability dispatch to the
// implementation named by settings.scheduler (FSRS by default).

import { getScheduler } from "./registry.js";

export function schedule(cardState, rating, now, settings = {}) {
  return getScheduler(settings).schedule(cardState, rating, now, settings);
}

export function previewIntervals(cardState, now, settings = {}) {
  return getScheduler(settings).previewIntervals(cardState, now, settings);
}

export function getRetrievability(cardState, now, settings = {}) {
  return getScheduler(settings).getRetrievability(cardState, now, settings);
}

export * from "./constants.js";
export * from "./cardState.js";
export * from "./formatInterval.js";
export * from "./struggle.js";
export { SCHEDULERS, DEFAULT_SCHEDULER, getScheduler } from "./registry.js";
export { default as fsrsScheduler } from "./fsrsScheduler.js";
export { default as sm2Scheduler } from "./sm2Scheduler.js";
