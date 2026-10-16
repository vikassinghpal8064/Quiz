import { describe, it, expect } from "vitest";
import {
  INK_PALETTE,
  INK_TOOLS,
  MAX_HISTORY,
  clampPoint,
  createStroke,
  distanceToSegment,
  erasePoints,
  eraseStrokes,
  fitTransform,
  historyCanRedo,
  historyCanUndo,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  isBackgroundId,
  isEraserTool,
  isHexColor,
  isHighlightTool,
  isPointInPolygon,
  isPointInStroke,
  isStrokeInPolygon,
  layerForTool,
  pushRecentColor,
  simplifyPoints,
  strokeBounds,
  strokesBounds,
  translateStroke,
} from "../ink.js";

function p(x, y, pressure = 0.5) {
  return { x, y, p: pressure };
}

describe("palette / colours", () => {
  it("offers twelve presets", () => {
    expect(INK_PALETTE).toHaveLength(12);
  });

  it("validates hex colours", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#A1B2C3")).toBe(true);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
  });

  it("tracks recent colours, newest first and without duplicates", () => {
    let recent = [];
    recent = pushRecentColor(recent, "#111827");
    recent = pushRecentColor(recent, "#ef4444");
    recent = pushRecentColor(recent, "#111827");
    expect(recent).toEqual(["#111827", "#ef4444"]);
  });

  it("drops non-colours and caps the list", () => {
    expect(pushRecentColor([], "nope")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `#0000${(i % 10)}0`).filter(isHexColor);
    expect(pushRecentColor([], many[0], 3).length).toBeLessThanOrEqual(3);
  });
});

describe("tool metadata", () => {
  it("knows the highlighter blends and the erasers erase", () => {
    expect(isHighlightTool("highlighter")).toBe(true);
    expect(isHighlightTool("pen")).toBe(false);
    expect(isEraserTool("eraser")).toBe(true);
    expect(isEraserTool("pen")).toBe(false);
  });

  it("routes tools to the right canvas layer", () => {
    expect(layerForTool("highlighter")).toBe("highlight");
    expect(layerForTool("pen")).toBe("ink");
    expect(layerForTool("lasso")).toBe("none");
  });

  it("has a sensible default width per tool", () => {
    expect(INK_TOOLS.pen.width).toBeGreaterThan(0);
    expect(INK_TOOLS.marker.width).toBeGreaterThan(INK_TOOLS.pen.width);
  });
});

describe("backgrounds", () => {
  it("recognises the known ids only", () => {
    expect(isBackgroundId("ruled")).toBe(true);
    expect(isBackgroundId("image")).toBe(true);
    expect(isBackgroundId("nope")).toBe(false);
  });
});

describe("createStroke", () => {
  it("fills in the tool defaults", () => {
    const s = createStroke({ tool: "marker", points: [p(0, 0)] });
    expect(s.width).toBe(INK_TOOLS.marker.width);
    expect(s.id).toBeTruthy();
    expect(s.color).toBeTruthy();
  });

  it("keeps an explicit width and shape", () => {
    const s = createStroke({ tool: "line", shape: "line", width: 7, points: [p(0, 0), p(10, 10)] });
    expect(s.width).toBe(7);
    expect(s.shape).toBe("line");
  });
});

describe("distanceToSegment", () => {
  it("measures perpendicular distance", () => {
    expect(distanceToSegment(p(0, 5), p(-10, 0), p(10, 0))).toBeCloseTo(5);
  });

  it("clamps to the endpoints beyond the segment", () => {
    expect(distanceToSegment(p(20, 0), p(-10, 0), p(10, 0))).toBeCloseTo(10);
  });
});

describe("simplifyPoints", () => {
  it("drops collinear points within tolerance", () => {
    const line = [p(0, 0), p(1, 0.05), p(2, 0), p(3, 0.05), p(4, 0)];
    expect(simplifyPoints(line, 1)).toHaveLength(2);
  });

  it("keeps corners", () => {
    const corner = [p(0, 0), p(0, 10), p(10, 10)];
    expect(simplifyPoints(corner, 1)).toHaveLength(3);
  });

  it("passes short strokes through", () => {
    expect(simplifyPoints([p(0, 0), p(1, 1)], 5)).toHaveLength(2);
  });
});

describe("bounds", () => {
  it("wraps the points with a width pad", () => {
    const box = strokeBounds(createStroke({ width: 4, points: [p(10, 10), p(30, 20)] }));
    expect(box).toEqual({ minX: 8, minY: 8, maxX: 32, maxY: 22 });
  });

  it("unions many strokes", () => {
    const box = strokesBounds([
      createStroke({ width: 0, points: [p(0, 0), p(10, 10)] }),
      createStroke({ width: 0, points: [p(-5, 5), p(4, 40)] }),
    ]);
    expect(box).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 40 });
  });

  it("is null for nothing drawn", () => {
    expect(strokesBounds([])).toBeNull();
  });
});

describe("hit testing", () => {
  const stroke = createStroke({ width: 0, points: [p(0, 0), p(10, 0)] });

  it("hits a point near the stroke", () => {
    expect(isPointInStroke(p(5, 1), stroke, 2)).toBe(true);
    expect(isPointInStroke(p(5, 5), stroke, 2)).toBe(false);
  });

  it("point-in-polygon", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(isPointInPolygon(p(5, 5), square)).toBe(true);
    expect(isPointInPolygon(p(15, 5), square)).toBe(false);
  });

  it("selects a stroke that crosses the lasso", () => {
    const lasso = [p(4, -5), p(6, -5), p(6, 5), p(4, 5)];
    expect(isStrokeInPolygon(stroke, lasso)).toBe(true);
    const far = [p(100, 100), p(110, 100), p(110, 110), p(100, 110)];
    expect(isStrokeInPolygon(stroke, far)).toBe(false);
  });
});

describe("translateStroke / clampPoint", () => {
  it("moves every point", () => {
    const moved = translateStroke(createStroke({ points: [p(0, 0), p(10, 10)] }), 5, -3);
    expect(moved.points).toEqual([p(5, -3), p(15, 7)]);
  });

  it("clamps into the surface", () => {
    expect(clampPoint(p(-5, 99), 100, 50)).toEqual({ x: 0, y: 50, p: 0.5 });
  });
});

describe("fitTransform", () => {
  it("scales content to fit and centres it", () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, { width: 220, height: 120 }, 10);
    expect(t.scale).toBeCloseTo(2);
    expect(t.offsetX).toBeCloseTo(10);
    expect(t.offsetY).toBeCloseTo(10);
  });

  it("is a no-op without bounds", () => {
    expect(fitTransform(null, { width: 10, height: 10 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe("erasing", () => {
  const strokes = [
    createStroke({ width: 0, points: [p(0, 0), p(10, 0)] }),
    createStroke({ width: 0, points: [p(100, 100), p(110, 100)] }),
  ];

  it("stroke eraser removes whole strokes", () => {
    const left = eraseStrokes(strokes, p(5, 0), 3);
    expect(left).toHaveLength(1);
    expect(left[0].points[0]).toEqual(p(100, 100));
  });

  it("pixel eraser splits a stroke around the erased point", () => {
    const many = [p(0, 0), p(10, 0), p(20, 0), p(30, 0), p(40, 0)];
    const left = erasePoints([createStroke({ width: 0, points: many })], p(20, 0), 4);
    expect(left).toHaveLength(2);
    expect(left[0].points).toEqual([p(0, 0), p(10, 0)]);
    expect(left[1].points).toEqual([p(30, 0), p(40, 0)]);
  });

  it("pixel eraser drops a fully covered stroke", () => {
    const left = erasePoints([createStroke({ width: 0, points: [p(0, 0)] })], p(0, 0), 2);
    expect(left).toHaveLength(0);
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    let h = historyInit([1]);
    h = historyPush(h, [1, 2]);
    h = historyPush(h, [1, 2, 3]);
    expect(h.present).toEqual([1, 2, 3]);
    h = historyUndo(h);
    expect(h.present).toEqual([1, 2]);
    expect(historyCanRedo(h)).toBe(true);
    h = historyRedo(h);
    expect(h.present).toEqual([1, 2, 3]);
    expect(historyCanRedo(h)).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    let h = historyInit([]);
    h = historyPush(h, [1]);
    h = historyUndo(h);
    h = historyPush(h, [9]);
    expect(historyCanRedo(h)).toBe(false);
    expect(h.present).toEqual([9]);
  });

  it("caps the past at its limit", () => {
    let h = historyInit([], 3);
    for (let i = 1; i <= 10; i += 1) h = historyPush(h, Array.from({ length: i }, (_, n) => n));
    expect(h.past.length).toBe(3);
    expect(historyCanUndo(h)).toBe(true);
  });

  it("ignores a no-op push", () => {
    const present = [1];
    const h = historyInit(present);
    expect(historyPush(h, present)).toBe(h);
  });

  it("defaults to at least 100 steps", () => {
    expect(MAX_HISTORY).toBeGreaterThanOrEqual(100);
  });
});
