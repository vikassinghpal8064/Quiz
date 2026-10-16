// Maps settings.scheduler to an implementation. Each implementation exposes
// the same interface: { name, schedule, previewIntervals, getRetrievability }.

import fsrsScheduler from "./fsrsScheduler.js";
import sm2Scheduler from "./sm2Scheduler.js";
import { DEFAULT_SETTINGS, SCHEDULER_NAMES } from "./constants.js";

export const SCHEDULERS = Object.freeze({
  [SCHEDULER_NAMES.FSRS]: fsrsScheduler,
  [SCHEDULER_NAMES.SM2]: sm2Scheduler,
});

export const DEFAULT_SCHEDULER = DEFAULT_SETTINGS.scheduler;

// Unknown or missing names fall back to the default (FSRS).
export function getScheduler(settings) {
  const name = settings?.scheduler;
  return SCHEDULERS[name] ?? SCHEDULERS[DEFAULT_SCHEDULER];
}
