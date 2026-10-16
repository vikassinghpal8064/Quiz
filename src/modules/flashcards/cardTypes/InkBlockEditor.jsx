import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_INK_COLOR,
  DEFAULT_INK_HEIGHT,
  DEFAULT_INK_WIDTH,
  ERASER_TOOLS,
  INK_BACKGROUNDS,
  INK_PALETTE,
  INK_TOOLS,
  clampPoint,
  createStroke,
  erasePoints,
  eraseStrokes,
  fitTransform,
  historyCanRedo,
  historyCanUndo,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  isStrokeInPolygon,
  layerForTool,
  pushRecentColor,
  simplifyPoints,
  strokesBounds,
  toolMeta,
  translateStroke,
} from "../lib/ink";
import {
  canvasToPngBlob,
  drawAll,
  drawFreehand,
  drawStroke,
  paintBackground,
  renderToCanvas,
} from "../lib/inkRender";
import { uploadMediaBlob } from "../lib/media";

// Full handwriting editor for an ink block.
//
// Three stacked canvases so a stroke never repaints the whole picture:
//   background - the paper (blank / ruled / grid / dotted / image) + highlighter
//   ink        - pen, fine pen, marker, shapes
//   overlay    - pointer capture, plus the lasso path, shape rubber band and
//                selection box
// A pointer move only appends the newest segment to the layer it belongs to; a
// full re-draw happens only when the picture really changes (undo/redo, erase,
// pan / zoom, resize, background change).
//
// Points live in the block's logical coordinates (0..width, 0..height) so the
// same drawing renders identically in the editor, the study viewer and the PNG
// preview. After an edit settles a PNG preview is rendered and uploaded, but
// only as a cache: the vector strokes are always the source of truth, so a card
// stays editable and still shows when Blob storage is not configured.

const PREVIEW_UPLOAD_DELAY = 1200;
const PREVIEW_SCALE = 1.5;
const SIMPLIFY_TOLERANCE = 1.4;
const PEN_PALM_WINDOW_MS = 600;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

const SHAPE_TOOLS = ["line", "rect", "ellipse"];
const TOOL_ORDER = [
  "pen",
  "fine",
  "marker",
  "highlighter",
  "eraser",
  "strokeEraser",
  "lasso",
  "line",
  "rect",
  "ellipse",
];

function pressureOf(event) {
  const p = Number(event.pressure);
  return p > 0 && p <= 1 ? p : 0.5;
}

function rgbToInput(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_INK_COLOR;
}

export default function InkBlockEditor({ block, onChange, onRemove, disabled = false }) {
  const width = Number.isFinite(block?.width) ? block.width : DEFAULT_INK_WIDTH;
  const height = Number.isFinite(block?.height) ? block.height : DEFAULT_INK_HEIGHT;
  const background = block?.background ?? "blank";
  const bgImageUrl = block?.bgImage?.url ?? null;

  const [history, setHistory] = useState(() =>
    historyInit(Array.isArray(block?.strokes) ? block.strokes : [])
  );
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(DEFAULT_INK_COLOR);
  const [size, setSize] = useState(INK_TOOLS.pen.width);
  const [recent, setRecent] = useState(() => [DEFAULT_INK_COLOR]);
  const [selection, setSelection] = useState(() => new Set());
  const [uploadError, setUploadError] = useState(null);

  const strokes = history.present;

  // ---------- refs ----------
  const containerRef = useRef(null);
  const bgRef = useRef(null);
  const inkRef = useRef(null);
  const overlayRef = useRef(null);
  const dprRef = useRef(1);
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const viewportRef = useRef({ width: 1, height: 1 });
  const strokesRef = useRef(strokes);
  const selRef = useRef(selection);
  const bgImageElRef = useRef(null);
  const pointersRef = useRef(new Map());
  const activePointerRef = useRef(null);
  const drawRef = useRef(null);
  const eraseRef = useRef(null);
  const lassoRef = useRef(null);
  const moveRef = useRef(null);
  const gestureRef = useRef(null);
  const penDownRef = useRef(false);
  const lastPenUpRef = useRef(0);
  const shiftRef = useRef(false);
  const previewTimerRef = useRef(null);
  const rafRef = useRef(0);
  const fileRef = useRef(null);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);
  useEffect(() => {
    selRef.current = selection;
  }, [selection]);

  // ---------- drawing ----------

  const bgContext = useCallback(() => bgRef.current?.getContext("2d") ?? null, []);
  const inkContext = useCallback(() => inkRef.current?.getContext("2d") ?? null, []);

  const clearOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const drawLayers = useCallback(
    (list) => {
      const bg = bgRef.current;
      const ink = inkRef.current;
      if (!bg || !ink) return;
      const view = viewRef.current;

      const bgCtx = bg.getContext("2d");
      if (bgCtx) {
        bgCtx.clearRect(0, 0, bg.width, bg.height);
        paintBackground(
          bgCtx,
          { background, width, height, image: bgImageElRef.current },
          view
        );
        // The highlighter blends into the paper beneath the ink.
        drawAll(
          bgCtx,
          list.filter((s) => toolMeta(s.tool).highlight),
          view,
          { clear: false }
        );
      }

      const inkCtx = ink.getContext("2d");
      if (inkCtx) {
        inkCtx.clearRect(0, 0, ink.width, ink.height);
        drawAll(
          inkCtx,
          list.filter((s) => !toolMeta(s.tool).highlight),
          view,
          { clear: false }
        );
      }
    },
    [background, width, height]
  );

  const drawSelection = useCallback(() => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const selected = strokesRef.current.filter((s) => selRef.current.has(s.id));
    const bounds = strokesBounds(selected);
    if (!bounds) return;
    const view = viewRef.current;
    const x = bounds.minX * view.scale + view.offsetX;
    const y = bounds.minY * view.scale + view.offsetY;
    const w = (bounds.maxX - bounds.minX) * view.scale;
    const h = (bounds.maxY - bounds.minY) * view.scale;
    ctx.save();
    ctx.strokeStyle = "#3b82f6";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    ctx.restore();
  }, []);

  const redraw = useCallback(() => {
    drawLayers(strokesRef.current);
    drawSelection();
  }, [drawLayers, drawSelection]);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      redraw();
    });
  }, [redraw]);

  const applyView = useCallback(
    (view) => {
      viewRef.current = view;
      scheduleRedraw();
    },
    [scheduleRedraw]
  );

  // ---------- preview upload ----------

  const uploadPreview = useCallback(async () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (disabled) return;
    const list = strokesRef.current;
    if (!list || list.length === 0) {
      onChange?.({ preview: null });
      return;
    }
    try {
      const canvas = renderToCanvas({
        strokes: list,
        background,
        width,
        height,
        image: bgImageElRef.current,
        scale: PREVIEW_SCALE,
      });
      const blob = await canvasToPngBlob(canvas);
      const uploaded = await uploadMediaBlob(blob, {
        kind: "ink",
        filename: "ink.png",
        mime: "image/png",
      });
      setUploadError(null);
      onChange?.({
        preview: {
          url: uploaded.url,
          pathname: uploaded.pathname,
          mime: uploaded.mime,
          bytes: uploaded.bytes,
          width,
          height,
        },
      });
    } catch (err) {
      // A missing Blob token only means "no preview"; the strokes still save.
      setUploadError(err?.message ?? "Preview upload failed.");
    }
  }, [background, disabled, height, onChange, width]);

  const schedulePreview = useCallback(() => {
    if (disabled) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      uploadPreview();
    }, PREVIEW_UPLOAD_DELAY);
  }, [disabled, uploadPreview]);

  // ---------- commits ----------

  const commit = useCallback(
    (next) => {
      setHistory((h) => historyPush(h, next));
      strokesRef.current = next;
      onChange?.({ strokes: next });
      schedulePreview();
    },
    [onChange, schedulePreview]
  );

  const stepHistory = useCallback(
    (next) => {
      setHistory(next);
      strokesRef.current = next.present;
      onChange?.({ strokes: next.present });
      const empty = new Set();
      setSelection(empty);
      selRef.current = empty;
      scheduleRedraw();
    },
    [onChange, scheduleRedraw]
  );

  const undo = useCallback(() => {
    if (historyCanUndo(history)) stepHistory(historyUndo(history));
  }, [history, stepHistory]);

  const redo = useCallback(() => {
    if (historyCanRedo(history)) stepHistory(historyRedo(history));
  }, [history, stepHistory]);

  const clearAll = useCallback(() => {
    commit([]);
    const empty = new Set();
    setSelection(empty);
    selRef.current = empty;
    redraw();
  }, [commit, redraw]);

  const deleteSelection = useCallback(() => {
    if (!selRef.current.size) return;
    const next = strokesRef.current.filter((s) => !selRef.current.has(s.id));
    const empty = new Set();
    setSelection(empty);
    selRef.current = empty;
    commit(next);
    redraw();
  }, [commit, redraw]);

  // ---------- fit ----------

  const fitToContent = useCallback(() => {
    const target = strokesBounds(strokesRef.current);
    if (!target) {
      applyView({ scale: viewportRef.current.width / width, offsetX: 0, offsetY: 0 });
      return;
    }
    const t = fitTransform(target, viewportRef.current, 24);
    applyView({ scale: t.scale, offsetX: t.offsetX, offsetY: t.offsetY });
  }, [applyView, width]);

  // ---------- size + view ----------

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;

    const resize = () => {
      const cssWidth = el.clientWidth || width;
      const cssHeight = el.clientHeight || (cssWidth * height) / width;
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
      dprRef.current = dpr;
      viewportRef.current = {
        width: Math.round(cssWidth * dpr),
        height: Math.round(cssHeight * dpr),
      };
      for (const canvas of [bgRef.current, inkRef.current, overlayRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.max(1, Math.round(cssWidth * dpr));
        canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      }
      applyView({ scale: (cssWidth * dpr) / width, offsetX: 0, offsetY: 0 });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyView, width, height]);

  useEffect(() => {
    // Redraw when the background option changes.
    scheduleRedraw();
  }, [background, scheduleRedraw]);

  // Load the background image, then paint it.
  useEffect(() => {
    if (!bgImageUrl) {
      bgImageElRef.current = null;
      scheduleRedraw();
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      bgImageElRef.current = image;
      scheduleRedraw();
    };
    image.onerror = () => {
      if (!cancelled) bgImageElRef.current = null;
    };
    image.src = bgImageUrl;
    return () => {
      cancelled = true;
    };
  }, [bgImageUrl, scheduleRedraw]);

  useEffect(
    () => () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // ---------- pointer maths ----------

  const toLogical = useCallback((event) => {
    const overlay = overlayRef.current;
    const view = viewRef.current;
    const rect = overlay.getBoundingClientRect();
    const dpr = dprRef.current;
    const deviceX = (event.clientX - rect.left) * dpr;
    const deviceY = (event.clientY - rect.top) * dpr;
    return {
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      p: pressureOf(event),
    };
  }, []);

  // ---------- two-finger pan + pinch zoom ----------

  function touchPoints() {
    return [...pointersRef.current.values()].filter((p) => p.type === "touch");
  }

  function beginGesture() {
    const [a, b] = touchPoints();
    if (!a || !b) return;
    gestureRef.current = {
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      start: { ...viewRef.current },
    };
  }

  function updateGesture() {
    const g = gestureRef.current;
    if (!g) return;
    const [a, b] = touchPoints();
    if (!a || !b) return;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (g.start.scale * dist) / g.dist));
    const ratio = scale / g.start.scale;
    applyView({
      scale,
      offsetX: midX - (g.midX - g.start.offsetX) * ratio,
      offsetY: midY - (g.midY - g.start.offsetY) * ratio,
    });
  }

  // ---------- helpers used by the handlers ----------

  function drawShapePreview(stroke) {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (stroke.points.length >= 2) drawStroke(ctx, stroke, viewRef.current);
  }

  function drawLassoPath(polygon, additive) {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (!overlay || !ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (polygon.length < 2) return;
    const view = viewRef.current;
    ctx.save();
    ctx.strokeStyle = additive ? "#22c55e" : "#3b82f6";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    polygon.forEach((p, i) => {
      const x = p.x * view.scale + view.offsetX;
      const y = p.y * view.scale + view.offsetY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function applyErase(point) {
    const ref = eraseRef.current;
    if (!ref) return;
    const radius = size / 2 + (toolMeta(tool).width ?? 0) / 4;
    ref.strokes = ref.strokeMode
      ? eraseStrokes(ref.strokes, point, radius)
      : erasePoints(ref.strokes, point, radius);
    strokesRef.current = ref.strokes;
    scheduleRedraw();
  }

  function startLassoOrMove(point, pointerId) {
    const selected = strokesRef.current.filter((s) => selRef.current.has(s.id));
    const bounds = strokesBounds(selected);
    const inside =
      bounds &&
      point.x >= bounds.minX - 6 &&
      point.x <= bounds.maxX + 6 &&
      point.y >= bounds.minY - 6 &&
      point.y <= bounds.maxY + 6;
    if (inside) {
      moveRef.current = { pointerId, last: point };
      return;
    }
    if (selRef.current.size) {
      const empty = new Set();
      setSelection(empty);
      selRef.current = empty;
      clearOverlay();
    }
    const additive = shiftRef.current;
    lassoRef.current = { pointerId, polygon: [point], additive };
    drawLassoPath(lassoRef.current.polygon, additive);
  }

  // ---------- pointer handlers ----------

  function onPointerDown(event) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const dpr = dprRef.current;
    pointersRef.current.set(event.pointerId, {
      x: (event.clientX - rect.left) * dpr,
      y: (event.clientY - rect.top) * dpr,
      type: event.pointerType,
    });
    activePointerRef.current = event.pointerId;

    if (event.pointerType === "pen") penDownRef.current = true;

    // Two fingers always means pan / zoom, whatever the tool.
    if (touchPoints().length >= 2) {
      const hadPartial = Boolean(drawRef.current);
      drawRef.current = null;
      eraseRef.current = null;
      lassoRef.current = null;
      moveRef.current = null;
      overlay.setPointerCapture?.(event.pointerId);
      // Drop any half-drawn stroke so it does not linger on the canvas without
      // ever being committed.
      if (hadPartial) redraw();
      beginGesture();
      return;
    }

    // Palm rejection: while a stylus is in play (or just was), a touch must not
    // draw - it may still pan once a second finger joins.
    const recentPen = Date.now() - lastPenUpRef.current < PEN_PALM_WINDOW_MS;
    if (event.pointerType === "touch" && (penDownRef.current || recentPen)) return;

    if (disabled) return;
    overlay.setPointerCapture?.(event.pointerId);
    const point = toLogical(event);

    if (layerForTool(tool) === "none") {
      startLassoOrMove(point, event.pointerId);
      return;
    }

    if (ERASER_TOOLS.includes(tool)) {
      eraseRef.current = { strokes: strokesRef.current, strokeMode: tool === "strokeEraser" };
      applyErase(point);
      return;
    }

    const isShape = SHAPE_TOOLS.includes(tool);
    const stroke = createStroke({
      tool,
      color,
      width: size,
      shape: isShape ? toolMeta(tool).shape : undefined,
      points: isShape ? [point, point] : [point],
    });
    drawRef.current = { stroke, pointerId: event.pointerId };
    const meta = toolMeta(tool);
    if (isShape) drawShapePreview(stroke);
    else if (meta.highlight) drawFreehand(bgContext(), stroke, viewRef.current, meta, 0);
    else drawFreehand(inkContext(), stroke, viewRef.current, meta, 0);
  }

  function onPointerMove(event) {
    const entry = pointersRef.current.get(event.pointerId);
    if (entry) {
      const rect = overlayRef.current.getBoundingClientRect();
      entry.x = (event.clientX - rect.left) * dprRef.current;
      entry.y = (event.clientY - rect.top) * dprRef.current;
    }

    if (gestureRef.current) {
      updateGesture();
      return;
    }

    const point = toLogical(event);

    if (eraseRef.current && activePointerRef.current === event.pointerId) {
      applyErase(point);
      return;
    }

    const lasso = lassoRef.current;
    if (lasso && lasso.pointerId === event.pointerId) {
      lasso.polygon.push(point);
      drawLassoPath(lasso.polygon, lasso.additive);
      return;
    }

    const move = moveRef.current;
    if (move && move.pointerId === event.pointerId) {
      const dx = point.x - move.last.x;
      const dy = point.y - move.last.y;
      move.last = point;
      const ids = selRef.current;
      strokesRef.current = strokesRef.current.map((s) =>
        ids.has(s.id) ? translateStroke(s, dx, dy) : s
      );
      scheduleRedraw();
      return;
    }

    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;

    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : null;
    const list = samples && samples.length ? samples : [event];
    const meta = toolMeta(draw.stroke.tool);
    for (const ev of list) {
      const pt = toLogical(ev);
      if (draw.stroke.shape) {
        draw.stroke.points[1] = clampPoint(pt, width, height);
        drawShapePreview(draw.stroke);
        continue;
      }
      const last = draw.stroke.points[draw.stroke.points.length - 1];
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.6) continue;
      draw.stroke.points.push(pt);
      // Incremental: paint only the segment just added.
      const ctx = meta.highlight ? bgContext() : inkContext();
      drawFreehand(ctx, draw.stroke, viewRef.current, meta, draw.stroke.points.length - 1);
    }
  }

  function onPointerUp(event) {
    pointersRef.current.delete(event.pointerId);
    if (event.pointerType === "pen") {
      penDownRef.current = false;
      lastPenUpRef.current = Date.now();
    }
    if (activePointerRef.current === event.pointerId) activePointerRef.current = null;

    if (gestureRef.current) {
      if (touchPoints().length < 2) gestureRef.current = null;
      return;
    }

    if (eraseRef.current) {
      eraseRef.current = null;
      commit(strokesRef.current);
      redraw();
      return;
    }

    const lasso = lassoRef.current;
    if (lasso && lasso.pointerId === event.pointerId) {
      const polygon = lasso.polygon;
      const base = lasso.additive ? new Set(selRef.current) : new Set();
      if (polygon.length >= 3) {
        for (const s of strokesRef.current) {
          if (isStrokeInPolygon(s, polygon)) base.add(s.id);
        }
      }
      setSelection(base);
      selRef.current = base;
      lassoRef.current = null;
      drawSelection();
      return;
    }

    const move = moveRef.current;
    if (move && move.pointerId === event.pointerId) {
      moveRef.current = null;
      commit(strokesRef.current);
      return;
    }

    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    drawRef.current = null;

    const stroke = draw.stroke;
    if (stroke.shape) {
      clearOverlay();
      const far =
        Math.hypot(stroke.points[1].x - stroke.points[0].x, stroke.points[1].y - stroke.points[0].y) >= 2;
      if (!far) return;
      // Paint the finished shape on the ink layer without a full re-draw.
      drawStroke(inkContext(), stroke, viewRef.current);
      commit([...strokesRef.current, stroke]);
      return;
    }

    stroke.points = simplifyPoints(stroke.points, SIMPLIFY_TOLERANCE);
    // The segment-by-segment paint already put it on screen.
    commit([...strokesRef.current, stroke]);
  }

  // ---------- toolbar actions ----------

  function chooseColor(next) {
    setColor(next);
    setRecent((r) => pushRecentColor(r, next));
  }

  function chooseTool(next) {
    setTool(next);
    setSize(toolMeta(next).width ?? size);
    if (next !== "lasso" && selRef.current.size) {
      const empty = new Set();
      setSelection(empty);
      selRef.current = empty;
      clearOverlay();
    }
  }

  async function handleBackgroundImage(file) {
    if (!file || disabled) return;
    setUploadError(null);
    try {
      const uploaded = await uploadMediaBlob(file, {
        kind: "image",
        filename: file.name,
        mime: file.type || "image/png",
      });
      onChange?.({
        background: "image",
        bgImage: {
          url: uploaded.url,
          pathname: uploaded.pathname,
          mime: uploaded.mime,
          bytes: uploaded.bytes,
        },
      });
    } catch (err) {
      setUploadError(err?.message ?? "Image upload failed.");
    }
  }

  function onKeyDown(event) {
    shiftRef.current = event.shiftKey;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
  }

  const canUndo = historyCanUndo(history);
  const canRedo = historyCanRedo(history);
  const hasSelection = selection.size > 0;
  const strokeLabel = `${strokes.length} stroke${strokes.length === 1 ? "" : "s"}${
    hasSelection ? ` · ${selection.size} selected` : ""
  }`;
  const toolButtons = useMemo(() => TOOL_ORDER.map((id) => ({ id, ...INK_TOOLS[id] })), []);

  return (
    <div
      role="group"
      aria-label="Handwriting block"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        shiftRef.current = e.shiftKey;
      }}
      className="rounded-xl border border-ink/10 bg-white p-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">
          ✍️ Handwriting
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="text-xs font-semibold text-ink/45 transition hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      {/* tools + history */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {toolButtons.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => chooseTool(b.id)}
            disabled={disabled}
            aria-pressed={tool === b.id}
            title={b.label}
            className={`rounded-lg border px-2 py-1 text-sm transition disabled:opacity-50 ${
              tool === b.id ? "border-emerald-500 bg-emerald-50" : "border-ink/10 bg-white hover:bg-stone-100"
            }`}
          >
            {b.icon}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-ink/10" />

        <button
          type="button"
          onClick={undo}
          disabled={disabled || !canUndo}
          title="Undo (Ctrl+Z)"
          className="rounded-lg border border-ink/10 px-2 py-1 text-sm transition hover:bg-stone-100 disabled:opacity-40"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={disabled || !canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="rounded-lg border border-ink/10 px-2 py-1 text-sm transition hover:bg-stone-100 disabled:opacity-40"
        >
          ↷
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={disabled || strokes.length === 0}
          title="Clear"
          className="rounded-lg border border-ink/10 px-2 py-1 text-sm transition hover:bg-stone-100 disabled:opacity-40"
        >
          🗑️
        </button>
        <button
          type="button"
          onClick={fitToContent}
          disabled={disabled || strokes.length === 0}
          title="Fit to content"
          className="rounded-lg border border-ink/10 px-2 py-1 text-sm transition hover:bg-stone-100 disabled:opacity-40"
        >
          ⤢
        </button>
        {hasSelection && (
          <button
            type="button"
            onClick={deleteSelection}
            disabled={disabled}
            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          >
            Delete selection
          </button>
        )}
      </div>

      {/* colour + size */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {INK_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => chooseColor(c)}
              disabled={disabled}
              aria-label={`Colour ${c}`}
              aria-pressed={color.toLowerCase() === c.toLowerCase()}
              className={`h-5 w-5 rounded-full border transition disabled:opacity-50 ${
                color.toLowerCase() === c.toLowerCase() ? "border-ink ring-2 ring-emerald-400" : "border-ink/20"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={rgbToInput(color)}
            onChange={(e) => chooseColor(e.target.value)}
            disabled={disabled}
            aria-label="Custom colour"
            className="h-5 w-6 cursor-pointer rounded border border-ink/20 bg-white disabled:opacity-50"
          />
          {recent.slice(0, 4).map((c) => (
            <button
              key={`recent-${c}`}
              type="button"
              onClick={() => chooseColor(c)}
              disabled={disabled}
              aria-label={`Recent colour ${c}`}
              className="h-4 w-4 rounded-full border border-ink/20 transition disabled:opacity-50"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs text-ink/60">
          <span
            aria-hidden="true"
            className="inline-block rounded-full border border-ink/30"
            style={{
              width: Math.max(4, Math.min(size, 28)),
              height: Math.max(4, Math.min(size, 28)),
              backgroundColor: color,
            }}
          />
          <input
            type="range"
            min="1"
            max="48"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            disabled={disabled}
            aria-label="Stroke size"
            className="w-24 accent-emerald-600 disabled:opacity-50"
          />
          <span className="w-6 text-right tabular-nums">{Math.round(size)}</span>
        </label>
      </div>

      {/* background */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink/60">
        <label>
          Background
          <select
            value={background}
            onChange={(e) => {
              if (e.target.value === "image" && !bgImageUrl) {
                fileRef.current?.click();
                return;
              }
              onChange?.({ background: e.target.value });
            }}
            disabled={disabled}
            className="field ml-1 px-2 py-1 text-xs disabled:opacity-50"
          >
            {INK_BACKGROUNDS.filter((bg) => bg.id !== "image" || bgImageUrl).map((bg) => (
              <option key={bg.id} value={bg.id}>
                {bg.label}
              </option>
            ))}
            {!bgImageUrl && <option value="image">Image…</option>}
          </select>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleBackgroundImage(file);
          }}
        />
        {bgImageUrl && (
          <button
            type="button"
            onClick={() => onChange?.({ background: "blank", bgImage: null })}
            disabled={disabled}
            className="text-xs font-semibold text-ink/45 transition hover:text-red-600 disabled:opacity-50"
          >
            Remove image
          </button>
        )}
      </div>

      {/* canvas stack */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border border-ink/10 bg-white"
        style={{ touchAction: "none", aspectRatio: `${width} / ${height}` }}
      >
        <canvas ref={bgRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas ref={inkRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink/40">
          {strokeLabel}
          <span className="ml-2 hidden sm:inline">Two fingers pan &amp; zoom · stylus pressure supported</span>
        </span>
        {uploadError && <span className="text-xs text-amber-600">Preview: {uploadError}</span>}
      </div>
    </div>
  );
}
