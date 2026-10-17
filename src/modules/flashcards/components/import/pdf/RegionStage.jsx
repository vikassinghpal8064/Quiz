import { useCallback, useEffect, useMemo, useState } from "react";
import { diffMask, labelRegions, similarity } from "../../../importers/pdf/arrays.js";
import { cropNormalized, fixedLuma, maskNormalized } from "../../../importers/pdf/imaging.js";
import { buildPairPlan } from "../../../importers/pdf/pairPlan.js";
import { buildImageCandidates, renderPageForExport } from "../../../importers/pdf/build.js";
import { SOURCES } from "../../../importers/candidate.js";

// Mode E: split a front/back pair into one card per changed region.
//
// The two pages of each pair are diffed; the connected areas where they differ
// are the "answers". Every region becomes a card whose front is the back page
// with just that region masked and whose back is the full back page. Regions
// can be merged or deleted before import.

const COMPARE_WIDTH = 700;
const PREVIEW_WIDTH = 140;
const MIN_REGION_AREA = 40;
const REGION_DILATE = 6;

let sequence = 0;
function nextId() {
  sequence += 1;
  return `reg-${sequence}`;
}

export default function RegionStage({ source, chosenPages, notify, onContinue }) {
  const pages = chosenPages ?? [];
  const [offset, setOffset] = useState(0);
  const [regionsByPair, setRegionsByPair] = useState(() => new Map());
  const [selected, setSelected] = useState(() => new Set());
  const [analyzing, setAnalyzing] = useState(null);
  const [building, setBuilding] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRegionsByPair(new Map());
    setSelected(new Set());
    setError(null);
  }, [source]);

  const plan = useMemo(
    () => buildPairPlan({ pages, blank: new Set(), offset, skipBlank: false }),
    [pages, offset]
  );

  const totalRegions = useMemo(
    () => [...regionsByPair.values()].reduce((sum, list) => sum + list.length, 0),
    [regionsByPair]
  );

  async function analyze() {
    if (analyzing) return;
    setError(null);
    setRegionsByPair(new Map());
    setSelected(new Set());

    try {
      const result = new Map();
      setAnalyzing({ done: 0, total: plan.pairs.length });

      for (let i = 0; i < plan.pairs.length; i += 1) {
        const pair = plan.pairs[i];
        // eslint-disable-next-line no-await-in-loop
        const [frontCanvas, backCanvas] = await Promise.all([
          source.render(pair.front, { targetWidth: COMPARE_WIDTH }),
          source.render(pair.back, { targetWidth: COMPARE_WIDTH }),
        ]);
        const frontLuma = fixedLuma(frontCanvas, 320);
        const backLuma = fixedLuma(backCanvas, 320);
        const score = similarity(frontLuma, backLuma, { threshold: 40 });

        let regions = [];
        // A pair whose pages are nearly identical has no answers to split out.
        if (score < 0.98) {
          const size = 320;
          const mask = diffMask(frontLuma, backLuma, { threshold: 40 });
          const boxes = labelRegions(mask, size, size, { minArea: MIN_REGION_AREA, dilate: REGION_DILATE });
          regions = boxes.map((box) => {
            const rect = { x: box.x / size, y: box.y / size, width: box.width / size, height: box.height / size };
            const sized = cropNormalized(backCanvas, rect);
            const crop = cropNormalized(backCanvas, rect, { scale: PREVIEW_WIDTH / Math.max(1, sized.width) });
            return { id: nextId(), rect, area: box.area, previewUrl: crop.toDataURL("image/webp", 0.6) };
          });
        }

        result.set(pair.key, { pair, regions });
        setRegionsByPair(new Map(result));
        setAnalyzing({ done: i + 1, total: plan.pairs.length });
      }

      setAnalyzing(null);
      if ([...result.values()].every((entry) => entry.regions.length === 0)) {
        notify?.("No changed regions found between the paired pages.", "info");
      }
    } catch (err) {
      setAnalyzing(null);
      setError(err?.message ?? "Could not analyse the pages");
      notify?.("Could not analyse the pages.", "error");
    }
  }

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function deleteRegion(pairKey, id) {
    setRegionsByPair((prev) => {
      const next = new Map(prev);
      const entry = next.get(pairKey);
      if (!entry) return prev;
      next.set(pairKey, { ...entry, regions: entry.regions.filter((r) => r.id !== id) });
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function mergeSelected(pairKey) {
    setRegionsByPair((prev) => {
      const next = new Map(prev);
      const entry = next.get(pairKey);
      if (!entry) return prev;
      const chosen = entry.regions.filter((r) => selected.has(r.id));
      if (chosen.length < 2) return prev;
      const x = Math.min(...chosen.map((r) => r.rect.x));
      const y = Math.min(...chosen.map((r) => r.rect.y));
      const right = Math.max(...chosen.map((r) => r.rect.x + r.rect.width));
      const bottom = Math.max(...chosen.map((r) => r.rect.y + r.rect.height));
      const merged = { id: nextId(), rect: { x, y, width: right - x, height: bottom - y }, area: chosen.reduce((s, r) => s + r.area, 0), previewUrl: chosen[0].previewUrl };
      next.set(pairKey, { ...entry, regions: [merged, ...entry.regions.filter((r) => !selected.has(r.id))] });
      return next;
    });
    setSelected(new Set());
  }

  async function build() {
    if (building) return;
    setError(null);
    const entries = [...regionsByPair.entries()].filter(([, entry]) => entry.regions.length);
    if (!entries.length) {
      setError("Analyse the pages first.");
      return;
    }

    try {
      const regions = [];
      for (const [, entry] of entries) {
        for (const region of entry.regions) {
          regions.push({
            key: region.id,
            front: {
              render: async () => {
                const backCanvas = await renderPageForExport(source, entry.pair.back);
                return cropNormalized(maskNormalized(backCanvas, region.rect), region.rect);
              },
              filename: `region-p${entry.pair.back + 1}.webp`,
              sourceKind: "crop",
            },
            back: {
              render: () => renderPageForExport(source, entry.pair.back),
              filename: `answer-p${entry.pair.back + 1}.webp`,
            },
            sourceRef: `pdf:region-p${entry.pair.back + 1}`,
          });
        }
      }

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
        <button
          type="button"
          onClick={() => setOffset((o) => (o ? 0 : 1))}
          aria-pressed={offset === 1}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
            offset === 1 ? "border-lavender bg-lavender/10" : "border-ink/15 bg-white"
          }`}
        >
          Shift pairing by one page
        </button>
        <button
          type="button"
          onClick={analyze}
          disabled={Boolean(analyzing)}
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
        >
          Find changed regions
        </button>
        {analyzing && (
          <span className="text-xs text-ink/55">
            Analysing {analyzing.done}/{analyzing.total}…
          </span>
        )}
        {!analyzing && totalRegions > 0 && <span className="text-xs text-ink/55">{totalRegions} regions found</span>}
      </div>

      {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto">
        {[...regionsByPair.values()].map(({ pair, regions }) => (
          <div key={pair.key} className="rounded-lg border border-ink/10 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink/60">
                Pages {pair.front + 1} &amp; {pair.back + 1}
              </span>
              <div className="flex items-center gap-2">
                {regions.some((r) => selected.has(r.id)) && regions.filter((r) => selected.has(r.id)).length >= 2 && (
                  <button
                    type="button"
                    onClick={() => mergeSelected(pair.key)}
                    className="rounded border border-ink/15 bg-white px-2 py-0.5 text-[10px] font-semibold text-ink/70"
                  >
                    Merge selected
                  </button>
                )}
                <span className="text-[10px] text-ink/45">{regions.length} regions</span>
              </div>
            </div>
            {regions.length === 0 ? (
              <p className="text-xs text-ink/40">No changes between these pages.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {regions.map((region) => (
                  <li key={region.id} className="w-28">
                    <label className="block cursor-pointer">
                      <img src={region.previewUrl} alt="changed region" className="w-full rounded border border-ink/10" />
                      <span className="mt-1 flex items-center justify-between text-[10px] text-ink/50">
                        <span className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={selected.has(region.id)}
                            onChange={() => toggleSelect(region.id)}
                            className="h-3 w-3"
                          />
                          keep
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteRegion(pair.key, region.id)}
                          className="font-semibold text-red-600 hover:underline"
                        >
                          remove
                        </button>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {!analyzing && regionsByPair.size === 0 && !error && (
        <p className="mt-3 text-xs text-ink/50">
          Pair the pages, then “Find changed regions”. Each region becomes a card that hides one answer.
        </p>
      )}

      <div className="mt-3 flex items-center justify-end border-t border-ink/10 pt-3">
        {building ? (
          <span className="text-xs text-ink/55">{building.done} of {building.total} uploaded…</span>
        ) : (
          <button
            type="button"
            onClick={build}
            disabled={totalRegions === 0}
            className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
          >
            Build {totalRegions} cards
          </button>
        )}
      </div>
    </div>
  );
}
