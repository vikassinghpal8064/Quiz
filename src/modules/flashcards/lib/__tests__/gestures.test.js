import { describe, it, expect } from "vitest";
import { classifySwipe } from "../gestures.js";

describe("classifySwipe", () => {
  it("reads a horizontal swipe", () => {
    expect(classifySwipe({ dx: 80, dy: 5 })).toBe("right");
    expect(classifySwipe({ dx: -80, dy: 5 })).toBe("left");
  });

  it("needs a longer vertical travel than horizontal", () => {
    expect(classifySwipe({ dx: 5, dy: -70 })).toBeNull();
    expect(classifySwipe({ dx: 5, dy: -120 })).toBe("up");
    expect(classifySwipe({ dx: 5, dy: 120 })).toBe("down");
  });

  it("ignores small movements", () => {
    expect(classifySwipe({ dx: 10, dy: 10 })).toBeNull();
    expect(classifySwipe()).toBeNull();
  });
});
