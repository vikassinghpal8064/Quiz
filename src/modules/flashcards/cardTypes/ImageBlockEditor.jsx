import { useEffect, useRef, useState } from "react";
import Icon from "../../../components/Icon";
import { compressImage } from "../lib/image";
import { loadImageQuality } from "../lib/imageQuality";
import { removeMediaPaths, uploadMediaBlob } from "../lib/media";

// Editor for one image block. Three ways in, as required: a file picker, a
// camera capture input (mobile), and pasting from the clipboard. Whatever comes
// in is resized + converted to WebP in the browser (lib/image.js) and uploaded
// through the storage adapter (lib/media.js); the block only stores the
// resulting public URL, object path plus a little metadata.
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageBlockEditor({ block, onChange, onRemove, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const previewRef = useRef(null);
  const sessionPathsRef = useRef([]);

  // Object URLs we create are ours to revoke.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  function setPreviewUrl(url) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }

  async function handleFile(file) {
    if (!file || disabled || busy) return;
    if (!String(file.type).startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setError(null);
    setBusy(true);
    setProgress(0);
    try {
      const quality = await loadImageQuality();
      const prepared = await compressImage(file, { quality });
      setPreviewUrl(URL.createObjectURL(prepared.blob));
      const uploaded = await uploadMediaBlob(prepared.blob, {
        kind: "image",
        filename: file.name,
        mime: prepared.mime,
        hash: prepared.hash,
        onProgress: ({ percentage }) => setProgress(Math.round(percentage ?? 0)),
      });
      // A superseded upload from this same editing session is no longer needed;
      // drop it from the bucket. A value loaded from a saved card is left alone -
      // the server reconciles that on save.
      if (sessionPathsRef.current.length) {
        removeMediaPaths(sessionPathsRef.current).catch(() => {});
      }
      sessionPathsRef.current = uploaded.path ? [uploaded.path] : [];
      onChange?.({
        url: uploaded.url,
        path: uploaded.path,
        mime: uploaded.mime,
        bytes: uploaded.bytes,
        hash: uploaded.hash ?? prepared.hash ?? null,
        width: prepared.width,
        height: prepared.height,
      });
      setProgress(100);
    } catch (err) {
      setError(err?.message ?? "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function handlePaste(event) {
    const file = [...(event.clipboardData?.files ?? [])].find((f) =>
      String(f.type).startsWith("image/")
    );
    if (!file) return;
    event.preventDefault();
    handleFile(file);
  }

  const src = block?.url || preview;
  const locked = disabled || busy;

  return (
    <div
      role="group"
      aria-label="Image block"
      tabIndex={0}
      onPaste={handlePaste}
      className="rounded-xl border border-ink/10 bg-white p-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink/40">
          <Icon name="image" size={13} />
          Image
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={locked}
            className="text-xs font-semibold text-ink/45 transition hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      {src ? (
        <img
          src={src}
          alt={block?.alt || "Card image"}
          className="max-h-64 w-full rounded-lg border border-ink/10 object-contain"
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink/20 bg-stone-50 px-4 py-6 text-center">
          <p className="text-sm text-ink/55">
            Choose an image, take a photo, or paste from the clipboard.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={locked}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              Choose image
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={locked}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
            >
              <Icon name="camera" size={14} />
              Camera
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />

      {busy && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink/45">Uploading… {progress}%</p>
        </div>
      )}

      {block?.url && !busy && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={block.alt ?? ""}
            onChange={(e) => onChange?.({ alt: e.target.value })}
            disabled={disabled}
            placeholder="Alt text (describes the image)"
            aria-label="Image alt text"
            className="field min-w-0 flex-1 px-2.5 py-1.5 text-xs"
          />
          {block.bytes ? (
            <span className="text-xs text-ink/40">{formatBytes(block.bytes)}</span>
          ) : null}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={locked}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
          >
            Replace
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
