import { useEffect, useRef } from "react";
import { DEFAULT_INK_HEIGHT, DEFAULT_INK_WIDTH } from "../lib/ink";
import { drawAll, paintBackground } from "../lib/inkRender";

// Read-only rendering of an ink block.
//
// The fast path is the PNG preview the editor rendered and uploaded: a plain
// <img>, which also renders during server-side rendering. When there is no
// preview (an upload that never happened because Blob is not configured, or a
// card that predates previews) the vector strokes are re-drawn onto a canvas on
// the client. If neither is available nothing is shown.
//
// The canvas has the block's aspect ratio so the layout does not jump while the
// preview loads or the strokes paint. A shared empty array keeps `strokes`
// referentially stable when a block carries none.
const NO_STROKES = [];

export default function InkViewer({ block }) {
  const canvasRef = useRef(null);
  const width = Number.isFinite(block?.width) ? block.width : DEFAULT_INK_WIDTH;
  const height = Number.isFinite(block?.height) ? block.height : DEFAULT_INK_HEIGHT;
  const strokes = Array.isArray(block?.strokes) ? block.strokes : NO_STROKES;
  const previewUrl = block?.preview?.url;

  useEffect(() => {
    if (previewUrl || strokes.length === 0) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth || width;
    const cssHeight = (cssWidth * height) / width;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const view = { scale: (cssWidth / width) * dpr, offsetX: 0, offsetY: 0 };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintBackground(ctx, { background: block?.background, width, height }, view);
    drawAll(ctx, strokes, view, { clear: false });
    return undefined;
  }, [previewUrl, strokes, width, height, block?.background]);

  if (previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={block?.alt || "Handwriting"}
        className="max-h-64 rounded-lg border border-ink/10 bg-white"
        style={{ aspectRatio: `${width} / ${height}` }}
      />
    );
  }

  if (strokes.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={block?.alt || "Handwriting"}
      className="max-h-64 w-full rounded-lg border border-ink/10 bg-white"
      style={{ aspectRatio: `${width} / ${height}` }}
    />
  );
}
