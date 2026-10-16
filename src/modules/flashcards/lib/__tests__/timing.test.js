import { describe, it, expect } from "vitest";
import { cleanSample, createStopwatch, MAX_IDLE_MS } from "../timing.js";

describe("cleanSample", () => {
  it("keeps a plausible reading, rounded to whole ms", () => {
    expect(cleanSample(4321.6)).toBe(4322);
    expect(cleanSample(0)).toBe(0);
  });

  it("discards an idle reading over the cut-off", () => {
    expect(cleanSample(MAX_IDLE_MS)).toBe(MAX_IDLE_MS);
    expect(cleanSample(MAX_IDLE_MS + 1)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(cleanSample(undefined)).toBeNull();
    expect(cleanSample(-5)).toBeNull();
    expect(cleanSample(Number.NaN)).toBeNull();
    expect(cleanSample(Infinity)).toBeNull();
    expect(cleanSample("1000")).toBeNull();
  });
});

describe("createStopwatch", () => {
  it("accumulates only while running", () => {
    let t = 1000;
    const sw = createStopwatch(() => t);

    sw.start();
    t = 1500;
    expect(sw.read()).toBe(500);

    sw.pause();
    t = 9999;
    expect(sw.read()).toBe(500); // frozen while paused
    expect(sw.isRunning()).toBe(false);

    sw.resume(); // resumes at t = 9999
    t = 10_200;
    expect(sw.read()).toBe(701); // 500 banked + 201 running
  });

  it("restarts from zero", () => {
    let t = 0;
    const sw = createStopwatch(() => t);

    sw.start();
    t = 100;
    sw.pause();
    expect(sw.read()).toBe(100);

    sw.start();
    t = 150;
    expect(sw.read()).toBe(50);
  });

  it("ignores pause/resume without a matching call", () => {
    const sw = createStopwatch(() => 0);
    sw.pause();
    expect(sw.read()).toBe(0);
    sw.resume();
    sw.resume();
    expect(sw.isRunning()).toBe(true);
  });
});
