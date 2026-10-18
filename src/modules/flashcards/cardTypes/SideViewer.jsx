import { useEffect, useRef, useState } from "react";
import Icon from "../../../components/Icon";
import RichTextView from "./RichTextView";
import InkViewer from "./InkViewer";

// Read-only rendering of one card side. A text block with rich JSON renders
// through RichTextView; a legacy plain text block renders as pre-wrapped text;
// image and audio blocks render natively, with the two study-viewer behaviours:
// images open in a zoomable lightbox, and audio blocks whose per-card
// "auto-play when revealed" flag is set start playing when the side is revealed
// (autoPlay).

function ZoomableImage({ block }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const alt = block.alt || "Card image";

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openZoom() {
    setScale(1);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openZoom}
        title="Click to zoom"
        aria-label="Zoom image"
        className="block cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
      >
        <img src={block.url} alt={alt} className="max-h-64 rounded-lg border border-ink/10" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          className="fixed inset-0 z-[60] flex flex-col bg-ink/85 backdrop-blur-sm"
        >
          <div className="flex items-center justify-end gap-2 p-3">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))}
              aria-label="Zoom out"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <Icon name="minus" size={18} />
            </button>
            <button
              type="button"
              onClick={() => setScale(1)}
              aria-label="Reset zoom"
              className="min-w-[3.5rem] rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(4, Number((s + 0.25).toFixed(2))))}
              aria-label="Zoom in"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <Icon name="plus" size={18} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close image"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4" onClick={() => setOpen(false)}>
            <img
              src={block.url}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              style={{ transform: `scale(${scale})` }}
              className="mx-auto max-h-full origin-center rounded-lg transition-transform duration-150"
            />
          </div>
        </div>
      )}
    </>
  );
}

function AudioBlock({ block, autoPlay }) {
  const ref = useRef(null);
  const shouldAutoPlay = Boolean(autoPlay) && block.autoplay === true && Boolean(block.url);

  useEffect(() => {
    if (!shouldAutoPlay) return;
    const el = ref.current;
    if (!el) return;
    const played = el.play?.();
    if (played && typeof played.catch === "function") played.catch(() => {});
  }, [shouldAutoPlay, block.url]);

  return <audio ref={ref} controls src={block.url} className="w-full" />;
}

function MediaBlock({ block, autoPlay, zoomable }) {
  if (block.type === "image") {
    if (!block.url) return null;
    if (!zoomable) {
      return (
        <img
          src={block.url}
          alt={block.alt || "Card image"}
          className="max-h-64 rounded-lg border border-ink/10"
        />
      );
    }
    return <ZoomableImage block={block} />;
  }
  if (block.type === "audio") {
    if (!block.url) return null;
    return <AudioBlock block={block} autoPlay={autoPlay} />;
  }
  if (block.type === "ink") {
    return <InkViewer block={block} />;
  }
  return null;
}

export default function SideViewer({
  side,
  className = "",
  emptyLabel = "(empty)",
  autoPlay = false,
  zoomable = true,
}) {
  const blocks = Array.isArray(side?.blocks) ? side.blocks : [];
  if (!blocks.length) {
    return <p className={`text-sm italic text-ink/35 ${className}`.trim()}>{emptyLabel}</p>;
  }
  return (
    <div className={`space-y-2 text-ink ${className}`.trim()}>
      {blocks.map((block, i) => {
        if (!block) return null;
        if (block.type === "text") {
          if (block.doc) return <RichTextView key={i} doc={block.doc} />;
          return (
            <p key={i} className="whitespace-pre-wrap leading-relaxed">
              {block.text}
            </p>
          );
        }
        return <MediaBlock key={i} block={block} autoPlay={autoPlay} zoomable={zoomable} />;
      })}
    </div>
  );
}
