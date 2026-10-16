// Canvas rendering for the ink block.
//
// Kept apart from lib/ink.js (which is pure) because everything here needs a 2D
// context. The shapes drawn match the model exactly, so the editor, the study
// viewer and the PNG preview all agree. Nothing touches the DOM at import time,
// which keeps the module safe to load during server rendering.
//
// `view` is a { scale, offsetX, offsetY } transform from the block's logical
// coordinates to device pixels. `dpr` is only used by the editor to size its
// backing store; drawing always works in logical units through `view`.

import {
  DOT_SPACING,
  GRID_SPACING,
  RULED_SPACING,
  toolMeta,
} from "./ink.js";

const BACKGROUND_COLOR = "#ffffff";
const RULED_COLOR = "#dbe3ee";
const GRID_COLOR = "#e2e8f0";
const DOT_COLOR = "#cbd5e1";

function device(point, view) {
  return {
    x: point.x * view.scale + view.offsetX,
    y: point.y * view.scale + view.offsetY,
  };
}

// A portion of the logical surface, in device pixels.
export function surfaceTransform(width, height, scale = 1) {
  return { scale, offsetX: 0, offsetY: 0, width: width * scale, height: height * scale };
}

// ---------- background ----------

export function paintBackground(ctx, { background = "blank", width, height, image }, view) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(view.offsetX, view.offsetY, width * view.scale, height * view.scale);

  if (background === "ruled") {
    ctx.strokeStyle = RULED_COLOR;
    ctx.lineWidth = Math.max(1, view.scale);
    ctx.beginPath();
    for (let y = RULED_SPACING; y < height; y += RULED_SPACING) {
      const d = device({ x: 0, y }, view);
      ctx.moveTo(view.offsetX, d.y);
      ctx.lineTo(view.offsetX + width * view.scale, d.y);
    }
    ctx.stroke();
  } else if (background === "grid") {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = Math.max(1, view.scale);
    ctx.beginPath();
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      const d = device({ x, y: 0 }, view);
      ctx.moveTo(d.x, view.offsetY);
      ctx.lineTo(d.x, view.offsetY + height * view.scale);
    }
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      const d = device({ x: 0, y }, view);
      ctx.moveTo(view.offsetX, d.y);
      ctx.lineTo(view.offsetX + width * view.scale, d.y);
    }
    ctx.stroke();
  } else if (background === "dotted") {
    ctx.fillStyle = DOT_COLOR;
    const r = Math.max(1, 1.4 * view.scale);
    for (let x = DOT_SPACING; x < width; x += DOT_SPACING) {
      for (let y = DOT_SPACING; y < height; y += DOT_SPACING) {
        const d = device({ x, y }, view);
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (background === "image" && image) {
    // Annotate an imported picture: cover the surface, preserving aspect ratio.
    const sw = image.width || width;
    const sh = image.height || height;
    const dw = width * view.scale;
    const dh = height * view.scale;
    const s = Math.max(dw / sw, dh / sh);
    const w = sw * s;
    const h = sh * s;
    ctx.drawImage(
      image,
      view.offsetX + (dw - w) / 2,
      view.offsetY + (dh - h) / 2,
      w,
      h
    );
  }
  ctx.restore();
}

// ---------- strokes ----------

function segmentWidth(stroke, meta, pressure, view) {
  const base = (stroke.width ?? meta.width ?? 3) * view.scale;
  if (!meta.pressure) return Math.max(1, base);
  // Pressure bends the width between 40% and 130% of the base.
  const p = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 0.5;
  return Math.max(1, base * (0.4 + 0.9 * p));
}

function applyStyle(ctx, stroke, meta) {
  ctx.globalCompositeOperation = meta.blend ?? "source-over";
  ctx.globalAlpha = meta.alpha ?? 1;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

// Draw one freehand stroke. `fromIndex` lets the editor draw only the newest
// segment while the pointer is down (incremental drawing, no full redraw).
export function drawFreehand(ctx, stroke, view, meta, fromIndex = 0) {
  const points = stroke.points ?? [];
  if (points.length === 0) return;
  applyStyle(ctx, stroke, meta);

  if (points.length === 1) {
    const d = device(points[0], view);
    ctx.beginPath();
    ctx.arc(d.x, d.y, segmentWidth(stroke, meta, points[0].p, view) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const start = Math.max(1, fromIndex);
  for (let i = start; i < points.length; i += 1) {
    const a = device(points[i - 1], view);
    const b = device(points[i], view);
    if (a.x === b.x && a.y === b.y) continue;
    const pressure = (Number(points[i - 1].p ?? 0.5) + Number(points[i].p ?? 0.5)) / 2;
    ctx.lineWidth = segmentWidth(stroke, meta, pressure, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// Draw a straight line, rectangle or ellipse between the stroke's two points.
export function drawShapeStroke(ctx, stroke, view, meta) {
  const [a, b] = stroke.points ?? [];
  if (!a || !b) {
    if (a) drawFreehand(ctx, { ...stroke, points: [a] }, view, meta, 0);
    return;
  }
  applyStyle(ctx, stroke, meta);
  ctx.lineWidth = Math.max(1, (stroke.width ?? meta.width ?? 3) * view.scale);
  const da = device(a, view);
  const db = device(b, view);
  ctx.beginPath();
  if (stroke.shape === "line") {
    ctx.moveTo(da.x, da.y);
    ctx.lineTo(db.x, db.y);
  } else if (stroke.shape === "rect") {
    ctx.rect(da.x, da.y, db.x - da.x, db.y - da.y);
  } else if (stroke.shape === "ellipse") {
    const cx = (da.x + db.x) / 2;
    const cy = (da.y + db.y) / 2;
    ctx.ellipse(cx, cy, Math.abs(db.x - da.x) / 2, Math.abs(db.y - da.y) / 2, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
}

export function drawStroke(ctx, stroke, view) {
  if (!stroke) return;
  const meta = toolMeta(stroke.tool);
  ctx.save();
  if (stroke.shape) drawShapeStroke(ctx, stroke, view, meta);
  else drawFreehand(ctx, stroke, view, meta, 0);
  ctx.restore();
}

// Replace a canvas' contents with `strokes`. Used when the layer has to change
// wholesale (undo/redo, erase, pan/zoom, resize) - never while a pointer is
// drawing, which appends instead.
export function drawAll(ctx, strokes, view, { clear = true } = {}) {
  if (clear) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas?.width ?? 0, ctx.canvas?.height ?? 0);
    ctx.restore();
  }
  for (const stroke of strokes ?? []) drawStroke(ctx, stroke, view);
}

// ---------- composed render (editor background + PNG preview) ----------

// Paint background, then highlighter strokes (multiply, beneath), then ink.
export function renderComposite(ctx, { strokes = [], background, width, height, image, scale = 1 }) {
  const view = { scale, offsetX: 0, offsetY: 0 };
  paintBackground(ctx, { background, width, height, image }, view);
  for (const stroke of strokes) {
    if (toolMeta(stroke.tool).highlight) drawStroke(ctx, stroke, view);
  }
  for (const stroke of strokes) {
    if (!toolMeta(stroke.tool).highlight) drawStroke(ctx, stroke, view);
  }
}

// Split a stroke list into the two layers the editor draws.
export function splitLayers(strokes) {
  const highlight = [];
  const ink = [];
  for (const stroke of strokes ?? []) {
    if (toolMeta(stroke.tool).highlight) highlight.push(stroke);
    else ink.push(stroke);
  }
  return { highlight, ink };
}

// Draw everything into a fresh canvas at `scale`x and return it. The caller can
// turn it into a PNG with canvasToPngBlob.
export function renderToCanvas({ strokes, background, width, height, image, scale = 1 }) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(1, 1);
  renderComposite(ctx, { strokes, background, width, height, image, scale });
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas?.toBlob !== "function") {
      reject(new Error("Canvas export is not supported here."));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not render the preview image."));
    }, "image/png");
  });
}
