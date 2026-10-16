// Study timing: the two measurements the review flow records.
//
//   think_ms - shown -> reveal   ("how long to recall")
//   total_ms - shown -> rating   ("how long the card took altogether")
//
// The clock pauses while the tab is hidden (document.hidden) and any single
// sample longer than MAX_IDLE_MS is discarded as idle - the phone was put down,
// the laptop slept, the train went into a tunnel. Pure and DOM-free, so the
// rules can be unit-tested without a browser.

export const MAX_IDLE_MS = 120_000;

// Discard an idle sample. A finite, non-negative value at or under the idle
// cut-off survives (rounded to whole ms); anything longer, or garbage, becomes
// null so the server stores "no reading" rather than a bogus one.
export function cleanSample(ms, { max = MAX_IDLE_MS } = {}) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms > max) return null;
  return Math.round(ms);
}

// A stopwatch that can be paused and resumed, built on an injectable clock so
// tests never depend on real time. read() reports accumulated milliseconds:
// while running it adds the live segment, while paused it is frozen.
export function createStopwatch(clock = Date.now) {
  let accumulated = 0;
  let startedAt = null;

  return {
    start() {
      accumulated = 0;
      startedAt = clock();
    },
    pause() {
      if (startedAt === null) return;
      accumulated += clock() - startedAt;
      startedAt = null;
    },
    resume() {
      if (startedAt !== null) return;
      startedAt = clock();
    },
    read() {
      return Math.max(0, accumulated + (startedAt === null ? 0 : clock() - startedAt));
    },
    reset() {
      accumulated = 0;
      startedAt = null;
    },
    isRunning() {
      return startedAt !== null;
    },
  };
}
