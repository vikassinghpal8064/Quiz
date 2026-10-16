// Pure model + geometry for the handwriting (ink) block.
//
// An ink block stores its drawings as vector data so a card stays editable:
//
//   { type: "ink", width, height, background, strokes: [...], preview: {...} }
//
// A stroke is either freehand
//   { id, tool, color, width, points: [{ x, y, p }, ...] }
// or a shape assist (drag from one point to another)
//   { id, tool, color, width, shape: "line" | "rect" | "ellipse", points: [from, to] }
//
// Points are in the block's logical coordinate space (0..width, 0..height), not
// screen pixels, so a drawing looks the same whether it is shown in the editor
// canvas, a study card or a rendered PNG. Nothing here touches the DOM or React,
// so the whole model is unit-testable.

export const DEFAULT_INK_WIDTH = 1200;
export const DEFAULT_INK_HEIGHT = 800;

// Undo/redo keeps at least 100 steps; roomy enough that a careful sketch survives.
export const MAX_HISTORY = 200;

// ---------- tools ----------

// `alpha` and `blend` are how the tool paints. The highlighter multiplies into
// the layer beneath it (so it never hides the ink on top) and is drawn on its
// own layer below the ink.
export const INK_TOOLS = {
  pen: { label: "Pen", icon: "🖊️", width: 4, alpha: 1, blend: "source-over", pressure: true },
  fine: { label: "Fine pen", icon: "✒️", width: 2, alpha: 1, blend: "source-over", pressure: true },
  marker: { label: "Marker", icon: "🖌️", width: 14, alpha: 0.9, blend: "source-over", pressure: false },
  highlighter: {
    label: "Highlighter",
    icon: "🖍️",
    width: 26,
    alpha: 0.32,
    blend: "multiply",
    pressure: false,
    highlight: true,
  },
  eraser: { label: "Eraser", icon: "🧽", width: 28, alpha: 1, blend: "destination-out", eraser: true },
  strokeEraser: { label: "Stroke eraser", icon: "🩹", width: 24, alpha: 1, eraser: "stroke" },
  lasso: { label: "Lasso", icon: "🔗", select: true },
  line: { label: "Line", icon: "📏", shape: "line", width: 4, alpha: 1, pressure: false },
  rect: { label: "Rectangle", icon: "▭", shape: "rect", width: 4, alpha: 1, pressure: false },
  ellipse: { label: "Ellipse", icon: "⬭", shape: "ellipse", width: 4, alpha: 1, pressure: false },
};

export const DRAW_TOOLS = ["pen", "fine", "marker", "highlighter", "line", "rect", "ellipse"];
export const ERASER_TOOLS = ["eraser", "strokeEraser"];

export function toolMeta(tool) {
  return INK_TOOLS[tool] ?? INK_TOOLS.pen;
}

export function isHighlightTool(tool) {
  return toolMeta(tool).highlight === true;
}

export function isEraserTool(tool) {
  return Boolean(toolMeta(tool).eraser);
}

// A tool paints on the lower (highlight) layer, the upper (ink) layer, or not at
// all (selection tools).
export function layerForTool(tool) {
  if (isHighlightTool(tool)) return "highlight";
  if (toolMeta(tool).select) return "none";
  if (isEraserTool(tool)) return "ink";
  return "ink";
}

// ---------- colour ----------

// Twelve presets, ordered dark -> warm -> cool -> neutral.
export const INK_PALETTE = [
  "#111827",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
];

export const DEFAULT_INK_COLOR = INK_PALETTE[0];

export function isHexColor(value) {
  return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
}

// Recent colours are most-recent-first and never hold duplicates (case-insensitive).
export function pushRecentColor(recent, color, max = 8) {
  if (!isHexColor(color)) return recent ?? [];
  const key = color.trim().toLowerCase();
  const next = [color.trim(), ...(recent ?? []).filter((c) => c.toLowerCase() !== key)];
  return next.slice(0, max);
}

// ---------- backgrounds ----------

export const INK_BACKGROUNDS = [
  { id: "blank", label: "Blank" },
  { id: "ruled", label: "Ruled" },
  { id: "grid", label: "Grid" },
  { id: "dotted", label: "Dotted" },
  { id: "image", label: "Image" },
];

export const RULED_SPACING = 48;
export const GRID_SPACING = 40;
export const DOT_SPACING = 40;

export function isBackgroundId(id) {
  return INK_BACKGROUNDS.some((bg) => bg.id === id);
}

// ---------- stroke helpers ----------

export function newStrokeId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createStroke({ id, tool = "pen", color = DEFAULT_INK_COLOR, width, points = [], shape } = {}) {
  const meta = toolMeta(tool);
  const stroke = {
    id: id ?? newStrokeId(),
    tool,
    color,
    width: Number.isFinite(width) ? width : meta.width ?? 3,
    points,
  };
  if (shape) stroke.shape = shape;
  return stroke;
}

// ---------- geometry ----------

export function distance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

// Distance from a point to the segment ab.
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// Squared distance, used by the simplify pass to avoid a sqrt per point.
function sqSegDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return px * px + py * py;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

// Ramer-Douglas-Peucker. Keeps the first and last point and drops points that
// sit within `tolerance` of the line they would otherwise describe - how a raw
// pointer path becomes a compact stored stroke.
export function simplifyPoints(points, tolerance = 1) {
  if (!Array.isArray(points) || points.length <= 2) return points ?? [];
  const tolSq = tolerance * tolerance;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxSq = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = sqSegDistance(points[i], points[start], points[end]);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (index !== -1 && maxSq > tolSq) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function strokeBounds(stroke) {
  const points = stroke?.points;
  if (!points || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = (stroke.width ?? 2) / 2;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

// The union bounds of a list of strokes, or null when there is nothing drawn.
export function strokesBounds(strokes) {
  let box = null;
  for (const stroke of strokes ?? []) {
    const b = strokeBounds(stroke);
    if (!b) continue;
    if (!box) box = { ...b };
    else {
      box.minX = Math.min(box.minX, b.minX);
      box.minY = Math.min(box.minY, b.minY);
      box.maxX = Math.max(box.maxX, b.maxX);
      box.maxY = Math.max(box.maxY, b.maxY);
    }
  }
  return box;
}

export function isPointInStroke(point, stroke, radius = 0) {
  const points = stroke?.points;
  if (!points || points.length === 0) return false;
  const pad = radius + (stroke.width ?? 0) / 2;
  if (points.length === 1) return distance(point, points[0]) <= pad;
  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegment(point, points[i - 1], points[i]) <= pad) return true;
  }
  return false;
}

// Ray-casting point-in-polygon. `polygon` is an array of { x, y }.
export function isPointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

// True when a stroke has any point inside the lasso or crosses one of its edges.
export function isStrokeInPolygon(stroke, polygon) {
  const points = stroke?.points;
  if (!points || points.length === 0) return false;
  if (points.some((p) => isPointInPolygon(p, polygon))) return true;
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i += 1) {
    for (let j = 0, k = polygon.length - 1; j < polygon.length; k = j, j += 1) {
      if (segmentsIntersect(points[i - 1], points[i], polygon[j], polygon[k])) return true;
    }
  }
  return false;
}

export function translateStroke(stroke, dx, dy) {
  return {
    ...stroke,
    points: (stroke?.points ?? []).map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
}

// Keep a stroke's points inside the logical surface.
export function clampPoint(point, width, height) {
  return {
    ...point,
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
}

// A view transform that scales `bounds` to fit `viewport` with padding, centred.
// Used by "fit to content" and by the PNG renderer.
export function fitTransform(bounds, viewport, padding = 24) {
  if (!bounds || !viewport) return { scale: 1, offsetX: 0, offsetY: 0 };
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const scale = Math.min(availW / w, availH / h);
  return {
    scale,
    offsetX: padding + (availW - w * scale) / 2 - bounds.minX * scale,
    offsetY: padding + (availH - h * scale) / 2 - bounds.minY * scale,
  };
}

// ---------- erasing ----------

// Stroke eraser: drop every stroke the eraser disc touches.
export function eraseStrokes(strokes, point, radius) {
  return (strokes ?? []).filter((stroke) => !isPointInStroke(point, stroke, radius));
}

// Pixel eraser: remove the points inside the eraser disc, splitting a stroke into
// the pieces that survive. Pure, so it is undoable like any other edit.
export function erasePoints(strokes, point, radius) {
  const out = [];
  for (const stroke of strokes ?? []) {
    if (stroke?.shape) {
      // Shapes are atomic: erase the whole shape when touched, else keep it.
      if (!isPointInStroke(point, stroke, radius)) out.push(stroke);
      continue;
    }
    const points = stroke?.points ?? [];
    let run = [];
    const flush = () => {
      if (run.length >= 2) out.push({ ...stroke, id: newStrokeId(), points: run });
      run = [];
    };
    for (const p of points) {
      if (distance(p, point) <= radius + (stroke.width ?? 0) / 2) flush();
      else run.push(p);
    }
    flush();
  }
  return out;
}

// ---------- undo / redo ----------

// An immutable history over a list of strokes. `present` is the current list;
// `past`/`future` are the undo/redo stacks, capped at MAX_HISTORY.
export function historyInit(present = [], limit = MAX_HISTORY) {
  return { past: [], present, future: [], limit };
}

export function historyPush(history, present) {
  if (!history) return historyInit(present);
  if (present === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > history.limit) past.splice(0, past.length - history.limit);
  return { ...history, past, present, future: [] };
}

export function historyUndo(history) {
  if (!history || history.past.length === 0) return history;
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1];
  return { ...history, past, present, future: [history.present, ...history.future] };
}

export function historyRedo(history) {
  if (!history || history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { ...history, past: [...history.past, history.present], present, future };
}

export function historyCanUndo(history) {
  return Boolean(history && history.past.length > 0);
}

export function historyCanRedo(history) {
  return Boolean(history && history.future.length > 0);
}

export function historyReset(present = [], limit = MAX_HISTORY) {
  return historyInit(present, limit);
}
