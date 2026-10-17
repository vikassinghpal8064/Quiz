import { useCallback, useEffect, useMemo, useState } from "react";
import { HIGHLIGHT_COLORS } from "../../../importers/pdf/arrays.js";
import { detectHighlights } from "../../../importers/pdf/highlight.js";
import { ocrCanvas } from "../../../importers/pdf/ocr.js";
import { cropNormalized, maskNormalized } from "../../../importers/pdf/imaging.js";
import { buildImageCandidates, renderPageForExport } from "../../../importers/pdf/build.js";
import { SOURCES } from "../../../importers/candidate.js";

// Mode B: highlight extract.
//
// Pages are scanned for highlighter colour, the marks are grouped into blocks,
// and each block is OCR'd. Every block becomes a proposed cloze card: the front
// is the crop with the highlighted words masked out, the back is the OCR text.
// The grid lets every proposal be edited, approved or discarded before upload.

const PREVIEW_WIDTH = 300;
const BLOCK_PADDING = 0.012;

let sequence = 0;
function nextId() {
  sequence += 1;
  return `hl-${sequence}`;
}

function padRect(rect, pad = BLOCK_PADDING) {
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const right = Math.min(1, rect.x + rect.width + pad);
  const bottom = Math.min(1, rect.y + rect.height + pad);
  return { x, y, width: right - x, height: bottom - y };
}

export default function HighlightStage({ source, chosenPages, notify, onContinue }) {
  const pages = chosenPages ?? [];
  const [colors, setColors] = useState(() => new Set(HIGHLIGHT_COLORS.map((c) => c.id)));
  const [proposals, setProposals] = useState([]);
  const [phase, setPhase] = useState(null); // { label, done, total }
  const [building, setBuilding] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProposals([]);
    setError(null);
  }, [source]);

  const toggleColor = useCallback((id) => {
    setColors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function analyze() {
    if (phase) return;
    setError(null);
    setProposals([]);
    if (colors.size === 0) {
      setError("Choose at least one highlighter colour.");
      return;
    }

    try {
      const found = [];
      setPhase({ label: "Scanning pages", done: 0, total: pages.length });

      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        // eslint-disable-next-line no-await-in-loop
        const canvas = await source.render(page, { targetWidth: 900 });
        const detected = detectHighlights(canvas, { colors, maxDim: 900 });
        for (const block of detected.blocks) {
          found.push({ id: nextId(), page, block: padRect(block), text: "", confidence: null, previewUrl: null, approved: true });
        }
        setPhase({ label: "Scanning pages", done: i + 1, total: pages.length });
      }

      if (found.length === 0) {
        setProposals([]);
        setPhase(null);
        notify?.("No highlighter marks found with those colours.", "info");
        return;
      }

      setProposals(found);

      // OCR pass, one page canvas reused across all of its blocks.
      const byPage = new Map();
      for (const proposal of found) {
        if (!byPage.has(proposal.page)) byPage.set(proposal.page, []);
        byPage.get(proposal.page).push(proposal);
      }

      let done = 0;
      setPhase({ label: "Reading text", done: 0, total: found.length });
      for (const [page, list] of byPage) {
        // eslint-disable-next-line no-await-in-loop
        const pageCanvas = await renderPageForExport(source, page);
        for (const proposal of list) {
          const crop = cropNormalized(pageCanvas, proposal.block);
          const preview = cropNormalized(pageCanvas, proposal.block, { scale: PREVIEW_WIDTH / Math.max(1, crop.width) });
          // eslint-disable-next-line no-await-in-loop
          const result = await ocrCanvas(crop);
          done += 1;
          setPhase({ label: "Reading text", done, total: found.length });
          setProposals((prev) =>
            prev.map((p) =>
              p.id === proposal.id
                ? { ...p, text: result.text, confidence: result.confidence, previewUrl: preview.toDataURL("image/webp", 0.6) }
                : p
            )
          );
        }
      }
      setPhase(null);
    } catch (err) {
      setPhase(null);
      setError(err?.message ?? "Highlight analysis failed");
      notify?.("Highlight analysis failed.", "error");
    }
  }

  const approved = useMemo(() => proposals.filter((p) => p.approved && p.text.trim()), [proposals]);

  const patch = useCallback((id, updater) => {
    setProposals((prev) => prev.map((p) => (p.id === id ? updater(p) : p)));
  }, []);

  async function build() {
    if (building || !approved.length) return;
    setError(null);
    try {
      const regions = approved.map((proposal) => ({
        key: proposal.id,
        front: {
          render: async () => {
            const pageCanvas = await renderPageForExport(source, proposal.page);
            const masked = maskNormalized(pageCanvas, proposal.block);
            return cropNormalized(masked, proposal.block);
          },
          filename: `cloze-p${proposal.page + 1}.webp`,
          sourceKind: "crop",
        },
        back: { text: proposal.text },
        sourceRef: `pdf:highlight-p${proposal.page + 1}`,
      }));

      setBuilding({ done: 0, total: regions.length });
      const candidates = await buildImageCandidates(regions, {
        source: SOURCES.pdf,
        onProgress: (done, total) => setBuilding({ done, total }),
      });
      onContinue(candidates);
    } catch (err) {
      setError(err?.message ?? "Could not build the cards");
    } finally {
      setBuilding(null);
    }
  }

  if (!pages.length) return <p className="text-sm text-ink/55">Choose at least one page.</p>;

  return (
    <div className="rounded-xl border border-ink/10 bg-stone-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-ink/60">Colours</span>
        {HIGHLIGHT_COLORS.map((color) => (
          <label key={color.id} className="flex items-center gap-1.5 text-xs text-ink/70">
            <input
              type="checkbox"
              checked={colors.has(color.id)}
              onChange={() => toggleColor(color.id)}
              className="h-3.5 w-3.5 rounded border-ink/20"
            />
            <span className="inline-block h-3 w-3 rounded-full border border-ink/10" style={{ background: color.swatch }} />
            {color.label}
          </label>
        ))}
        <button
          type="button"
          onClick={analyze}
          disabled={Boolean(phase)}
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
        >
          Find highlights
        </button>
      </div>

      {phase && (
        <p className="mt-2 text-xs text-ink/55">
          {phase.label}… {phase.done}/{phase.total}
        </p>
      )}
      {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {proposals.length > 0 && (
        <>
          <p className="mt-3 text-xs text-ink/55">
            {proposals.length} highlighted block{proposals.length === 1 ? "" : "s"} found · {approved.length} approved
          </p>

          <ul className="mt-2 max-h-[55vh] space-y-2 overflow-y-auto">
            {proposals.map((proposal) => (
              <li key={proposal.id} className="flex gap-3 rounded-lg border border-ink/10 bg-white p-2">
                <label className="mt-1 flex items-start">
                  <input
                    type="checkbox"
                    checked={proposal.approved}
                    onChange={(e) => patch(proposal.id, (p) => ({ ...p, approved: e.target.checked }))}
                    className="h-4 w-4 rounded border-ink/20"
                    aria-label={`Include block from page ${proposal.page + 1}`}
                  />
                </label>
                <div className="w-32 shrink-0">
                  {proposal.previewUrl ? (
                    <img src={proposal.previewUrl} alt={`Highlight on page ${proposal.page + 1}`} className="w-full rounded border border-ink/10" />
                  ) : (
                    <div className="grid h-20 place-items-center rounded border border-ink/10 text-[10px] text-ink/30">
                      page {proposal.page + 1}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <textarea
                    value={proposal.text}
                    onChange={(e) => patch(proposal.id, (p) => ({ ...p, text: e.target.value }))}
                    rows={2}
                    placeholder="OCR text (the answer side)…"
                    className="field w-full resize-y px-2.5 py-1.5 text-sm"
                  />
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-ink/45">
                    <span>Page {proposal.page + 1}</span>
                    {proposal.confidence != null && <span>OCR {Math.round(proposal.confidence)}%</span>}
                    <button
                      type="button"
                      onClick={() => setProposals((prev) => prev.filter((p) => p.id !== proposal.id))}
                      className="font-semibold text-red-600 hover:underline"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!phase && proposals.length === 0 && !error && (
        <p className="mt-3 text-xs text-ink/50">
          Turn on the colours you use, then “Find highlights”. Each highlighted block becomes a cloze card
          with the highlighted words hidden.
        </p>
      )}

      <div className="mt-3 flex items-center justify-end border-t border-ink/10 pt-3">
        {building ? (
          <span className="text-xs text-ink/55">{building.done} of {building.total} uploaded…</span>
        ) : (
          <button
            type="button"
            onClick={build}
            disabled={approved.length === 0}
            className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
          >
            Build {approved.length} cards
          </button>
        )}
      </div>
    </div>
  );
}
