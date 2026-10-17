// One page rendered into an in-flow canvas, only when it scrolls near the
// viewport. This is the workhorse behind every PDF mode: a 150-page document
// keeps 150 lightweight placeholders in the DOM but only rasterises the handful
// that are actually on screen.
//
// The placeholder reserves the page's aspect ratio immediately (from the cheap
// getSize call) so the scroll height never jumps while pages render.

import { useEffect, useRef, useState } from "react";

export default function LazyPage({
  source,
  index,
  targetWidth,
  alt,
  className = "",
  overlay,
  onClick,
  eager = false,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [aspect, setAspect] = useState(null);
  const [visible, setVisible] = useState(eager);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!source) return undefined;
    let active = true;
    source
      .getSize(index)
      .then((size) => {
        if (active && size?.width) setAspect(size.width / size.height);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [source, index]);

  useEffect(() => {
    if (eager || visible) return undefined;
    const el = wrapRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      // Pre-render a screenful above and below so scrolling feels instant.
      { rootMargin: "800px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, visible]);

  useEffect(() => {
    if (!visible || !source) return undefined;
    let cancelled = false;
    const width = Math.max(1, Math.round(targetWidth || 900));

    source
      .render(index, { targetWidth: width })
      .then((renderedCanvas) => {
        const el = canvasRef.current;
        if (!el || cancelled) return;
        el.width = renderedCanvas.width;
        el.height = renderedCanvas.height;
        const ctx = el.getContext("2d");
        ctx.drawImage(renderedCanvas, 0, 0);
        setRendered(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [visible, source, index, targetWidth]);

  return (
    <div
      ref={wrapRef}
      onClick={onClick}
      className={`relative overflow-hidden rounded-lg border border-ink/10 bg-white ${className}`}
      style={aspect ? { aspectRatio: String(aspect) } : undefined}
    >
      <canvas
        ref={canvasRef}
        aria-label={alt}
        role="img"
        className="block h-full w-full object-contain"
      />
      {!rendered && (
        <div className="absolute inset-0 grid place-items-center bg-stone-50 text-xs text-ink/30">
          {index + 1}
        </div>
      )}
      {rendered && index != null && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-ink/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {index + 1}
        </span>
      )}
      {overlay}
    </div>
  );
}
