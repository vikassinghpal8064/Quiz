import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageSource } from "../../../importers/pdf/usePageSource.js";
import { parsePageRange } from "../../../importers/pdf/paging.js";
import { buildPairPlan, warningsForPair } from "../../../importers/pdf/pairPlan.js";
import { pageSimilarity } from "../../../importers/pdf/similarity.js";
import { PDF_MODES, DEFAULT_PDF_MODE, PDF_MODE_CROP, PDF_MODE_HIGHLIGHT, PDF_MODE_PAGE, PDF_MODE_PAIRS, PDF_MODE_REGIONS } from "../../../importers/pdf/modes.js";
import { buildImageCandidates, renderPageForExport } from "../../../importers/pdf/build.js";
import { SOURCES } from "../../../importers/candidate.js";
import LazyPage from "./LazyPage.jsx";
import CropStage from "./CropStage.jsx";
import HighlightStage from "./HighlightStage.jsx";
import RegionStage from "./RegionStage.jsx";

// The PDF / page-image importer, rendered inside step 3 of the wizard.
//
// It owns everything PDF-specific - loading the source, choosing pages, the
// mode stage, and building candidates - and hands the finished candidates back
// to the wizard with onContinue(). Nothing here talks to the network except the
// final WebP uploads (build.js).
//
// Heavy work is deliberately lazy: pages are rasterised only as they scroll
// into view (LazyPage) or when a card is actually built.

// Every exported card image is rendered at the pipeline's page scale (see
// importers/pdf/build.js renderPageForExport), independent of the on-screen zoom.

const THUMB_WIDTH = 260;

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink/60">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-lavender border-t-transparent" />
      {label}
    </div>
  );
}

// A windowed grid: it keeps a fixed-height placeholder for every page so the
// scrollbar is honest, but only mounts the cells near the viewport. Combined
// with LazyPage (which only rasterises when visible) a 400-page document keeps
// a few dozen DOM nodes alive.
function WindowedPages({ source, pages, cellHeight, columns, selected, onToggle, showCheckbox = true }) {
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight || 600));
    ro.observe(el);
    setViewport(el.clientHeight || 600);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, columns);
  const rows = Math.ceil(pages.length / cols);
  const overscan = 2;
  const firstRow = Math.max(0, Math.floor(scrollTop / cellHeight) - overscan);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewport) / cellHeight) + overscan);

  const visible = [];
  for (let row = firstRow; row <= lastRow && row >= 0; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = row * cols + col;
      if (i >= pages.length) break;
      visible.push({ i, page: pages[i] });
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="max-h-[60vh] overflow-y-auto rounded-xl border border-ink/10 bg-stone-50 p-3"
    >
      <div style={{ height: rows * cellHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: firstRow * cellHeight,
            left: 0,
            right: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 8,
          }}
        >
          {visible.map(({ i, page }) => (
            <div key={page} className="relative" style={{ height: cellHeight - 8 }}>
              <LazyPage
                source={source}
                index={page}
                targetWidth={THUMB_WIDTH}
                alt={`Page ${page + 1}`}
                className="h-full w-full"
              />
              {showCheckbox && (
                <label className="absolute right-1 top-1 flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-ink/70">
                  <input
                    type="checkbox"
                    checked={selected.has(page)}
                    onChange={() => onToggle(page)}
                    className="h-3 w-3"
                  />
                  {i + 1}
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// One Mode D pair: front beside back, with a warning if the two pages look
// unlike each other. The similarity is computed only once the card scrolls into
// view, so opening a 150-page PDF does not instantly rasterise all of it.
function PairCard({ source, pair, onSimilarity, similarity, excluded, onToggleExclude }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || similarity != null || pair.back == null) return undefined;
    let active = true;
    pageSimilarity(source, pair.front, pair.back)
      .then((score) => {
        if (active && score != null) onSimilarity(pair.key, score);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [seen, similarity, pair, source, onSimilarity]);

  const warnings = warningsForPair(similarity);

  return (
    <div
      ref={ref}
      className={`rounded-xl border p-3 ${excluded ? "border-ink/10 bg-stone-50 opacity-60" : "border-ink/10 bg-white"}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink/60">
          Card · pages {pair.front + 1} &amp; {pair.back + 1}
        </span>
        <div className="flex items-center gap-2">
          {similarity != null && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${warnings.length ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
              {warnings.length ? warnings[0] : `match ${Math.round(similarity * 100)}%`}
            </span>
          )}
          <label className="flex items-center gap-1 text-[10px] font-semibold text-ink/60">
            <input type="checkbox" checked={!excluded} onChange={() => onToggleExclude(pair.key)} className="h-3 w-3" />
            include
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Front</div>
          <LazyPage source={source} index={pair.front} targetWidth={480} alt={`Front page ${pair.front + 1}`} />
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Back</div>
          <LazyPage source={source} index={pair.back} targetWidth={480} alt={`Back page ${pair.back + 1}`} />
        </div>
      </div>
    </div>
  );
}

export default function PdfImportView({ files, targetCategoryId, notify, onContinue }) {
  const { status, source, error, progress, measureMany } = usePageSource(files);

  const pageCount = source?.pageCount ?? 0;

  const [mode, setMode] = useState(DEFAULT_PDF_MODE);
  const [rangeText, setRangeText] = useState("all");

  // Mode D controls
  const [offset, setOffset] = useState(0);
  const [swap, setSwap] = useState(false);
  const [skipBlank, setSkipBlank] = useState(true);
  const [excludedPairs, setExcludedPairs] = useState(() => new Set());
  const [pairSims, setPairSims] = useState(() => new Map());

  // Blank detection
  const [blankSet, setBlankSet] = useState(() => new Set());
  const [detecting, setDetecting] = useState(null); // {done,total}

  // Mode C selection
  const [selectedPages, setSelectedPages] = useState(null); // null = "use the range"

  const [building, setBuilding] = useState(null); // {done,total}
  const [buildError, setBuildError] = useState(null);

  const parsed = useMemo(() => parsePageRange(rangeText, pageCount), [rangeText, pageCount]);
  const rangePages = parsed.pages;
  const rangeError = parsed.error;

  // Reset per-load state whenever a new source arrives.
  useEffect(() => {
    setRangeText("all");
    setSelectedPages(null);
    setBlankSet(new Set());
    setExcludedPairs(new Set());
    setPairSims(new Map());
    setBuildError(null);
  }, [source]);

  const selected = selectedPages ? new Set(selectedPages) : new Set(rangePages);
  const chosenPages = useMemo(
    () => (selectedPages ? selectedPages : rangePages),
    [selectedPages, rangePages]
  );

  const detectBlanks = useCallback(
    async (pages) => {
      if (!source) return;
      setDetecting({ done: 0, total: pages.length });
      const results = await measureMany(pages, {
        onProgress: (done, total) => setDetecting({ done, total }),
      });
      const blanks = new Set();
      for (const [index, stats] of results) if (stats.blanks ?? stats.blank) blanks.add(index);
      setBlankSet((prev) => new Set([...prev, ...blanks]));
      setDetecting(null);
    },
    [source, measureMany]
  );

  const effectiveSkipBlank = mode === PDF_MODE_PAIRS || mode === PDF_MODE_REGIONS ? skipBlank : false;

  const plan = useMemo(
    () =>
      buildPairPlan({
        pages: chosenPages,
        blank: blankSet,
        offset,
        swap,
        skipBlank: effectiveSkipBlank,
      }),
    [chosenPages, blankSet, offset, swap, effectiveSkipBlank]
  );

  const activePairs = plan.pairs.filter((p) => !excludedPairs.has(p.key));
  const oddWarning = mode === PDF_MODE_PAIRS && !effectiveSkipBlank && chosenPages.length % 2 === 1;

  const toggleExcludedPair = useCallback((key) => {
    setExcludedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const noteSimilarity = useCallback((key, score) => {
    setPairSims((prev) => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, score);
      return next;
    });
  }, []);

  // ---- build (upload) ----
  async function build() {
    if (!source || building) return;
    setBuildError(null);

    const onProgress = (done, total) => setBuilding({ done, total });

    try {
      if (mode === PDF_MODE_PAIRS) {
        const regions = activePairs.map((pair) => ({
          key: pair.key,
          front: {
            render: () => renderPageForExport(source, pair.front),
            filename: `front-p${pair.front + 1}.webp`,
          },
          back: {
            render: () => renderPageForExport(source, pair.back),
            filename: `back-p${pair.back + 1}.webp`,
          },
          warnings: warningsForPair(pairSims.get(pair.key)),
          sourceRef: `pdf:${pair.front + 1}-${pair.back + 1}`,
        }));
        const candidates = await buildImageCandidates(regions, { source: SOURCES.pdf, onProgress });
        onContinue(candidates);
        return;
      }

      if (mode === PDF_MODE_PAGE) {
        const regions = chosenPages.map((page) => ({
          key: `page:${page}`,
          front: {
            render: () => renderPageForExport(source, page),
            filename: `page-${page + 1}.webp`,
          },
          back: { text: "" },
          sourceRef: `pdf:page-${page + 1}`,
        }));
        const candidates = await buildImageCandidates(regions, { source: SOURCES.pdf, onProgress });
        onContinue(candidates);
        return;
      }

      // Modes A / B / E build their own regions and call onContinue directly
      // through their stage's onBuilt callback.
      throw new Error("This mode builds its cards from its own panel");
    } catch (err) {
      setBuildError(err?.message ?? "Could not build the cards");
      notify?.("Could not build the cards.", "error");
    } finally {
      setBuilding(null);
    }
  }

  // ---- render ----
  if (status === "loading" || status === "idle") {
    const pct = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
    return (
      <div className="card mt-5 p-5">
        <Spinner label="Opening the document…" />
        {progress.total > 1 && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-lavender transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="mt-2 text-xs text-ink/45">
          Everything is rendered in your browser. Only the cropped images you keep are uploaded.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="card mt-5 p-5">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  const stageProps = { source, chosenPages, setSelectedPages, notify, onContinue };

  return (
    <section className="card mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
          {source.kind === "pdf" ? "PDF pages" : "Page images"}
        </h2>
        <p className="text-xs text-ink/50">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
          {source.sizeBytes ? ` · ${(source.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
        </p>
      </div>

      {/* mode picker */}
      <div className="mt-3 flex flex-wrap gap-2">
        {PDF_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            title={m.hint}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              mode === m.id ? "border-lavender bg-lavender/10 text-ink" : "border-ink/10 bg-white text-ink/55 hover:bg-stone-50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-ink/55">{PDF_MODES.find((m) => m.id === mode)?.hint}</p>

      {/* page range */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-ink/60">
          Pages
          <input
            value={rangeText}
            onChange={(e) => {
              setRangeText(e.target.value);
              setSelectedPages(null);
            }}
            placeholder="all, or 1-3, 5, 8-10"
            className="field mt-1 block w-56 px-2 py-1.5 text-xs"
          />
        </label>
        <span className="pb-2 text-xs text-ink/45">
          {rangeError ? <span className="text-red-600">{rangeError}</span> : `${chosenPages.length} selected`}
        </span>
      </div>

      {/* blank + D/E options */}
      {(mode === PDF_MODE_PAIRS || mode === PDF_MODE_REGIONS) && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={skipBlank}
              onChange={(e) => {
                setSkipBlank(e.target.checked);
                if (e.target.checked && blankSet.size === 0 && !detecting) detectBlanks(chosenPages);
              }}
              className="h-4 w-4 rounded border-ink/20"
            />
            Skip blank pages
          </label>
          {detecting && <span className="text-xs text-ink/50">Scanning {detecting.done}/{detecting.total}…</span>}
          {!detecting && (
            <button
              type="button"
              onClick={() => detectBlanks(chosenPages)}
              className="text-xs font-semibold text-lavender-soft hover:underline"
            >
              Scan for blank pages
            </button>
          )}
          {blankSet.size > 0 && <span className="text-xs text-ink/50">{blankSet.size} blank detected</span>}
        </div>
      )}

      {mode === PDF_MODE_PAIRS && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setOffset((o) => (o ? 0 : 1))}
            aria-pressed={offset === 1}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              offset === 1 ? "border-lavender bg-lavender/10 text-ink" : "border-ink/10 bg-white text-ink/60 hover:bg-stone-50"
            }`}
          >
            Shift pairing by one page
          </button>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} className="h-4 w-4 rounded border-ink/20" />
            Swap front / back
          </label>
        </div>
      )}

      {oddWarning && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The selection has an odd number of pages, so the last page has no partner.
        </p>
      )}

      {/* stage */}
      <div className="mt-4">
        {mode === PDF_MODE_PAIRS && (
          <div className="space-y-3">
            {activePairs.length === 0 && plan.pairs.length === 0 && (
              <p className="text-sm text-ink/55">No pairs to show. Choose more pages or turn off blank skipping.</p>
            )}
            {plan.pairs.map((pair) => (
              <PairCard
                key={pair.key}
                source={source}
                pair={pair}
                similarity={pairSims.get(pair.key) ?? null}
                onSimilarity={noteSimilarity}
                excluded={excludedPairs.has(pair.key)}
                onToggleExclude={toggleExcludedPair}
              />
            ))}
            {plan.unpaired.length > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Unpaired: page{plan.unpaired.length > 1 ? "s" : ""} {plan.unpaired.map((p) => p + 1).join(", ")}.
              </p>
            )}
          </div>
        )}

        {mode === PDF_MODE_PAGE && (
          <WindowedPages
            source={source}
            pages={rangePages}
            cellHeight={190}
            columns={4}
            selected={selected}
            onToggle={(page) => {
              const next = new Set(selected);
              if (next.has(page)) next.delete(page);
              else next.add(page);
              setSelectedPages([...next].sort((a, b) => a - b));
            }}
          />
        )}

        {mode === PDF_MODE_CROP && <CropStage {...stageProps} />}
        {mode === PDF_MODE_HIGHLIGHT && <HighlightStage {...stageProps} />}
        {mode === PDF_MODE_REGIONS && <RegionStage {...stageProps} skipBlank={skipBlank} />}
      </div>

      {buildError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{buildError}</p>
      )}

      {/* build bar — only the built-in pair/page modes build from here; the crop,
          highlight and region stages own their own build buttons. */}
      {(mode === PDF_MODE_PAIRS || mode === PDF_MODE_PAGE) && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
          <p className="text-sm text-ink/60">
            {mode === PDF_MODE_PAIRS && (
              <>
                <span className="font-semibold text-ink">{activePairs.length}</span> cards from paired pages
              </>
            )}
            {mode === PDF_MODE_PAGE && (
              <>
                <span className="font-semibold text-ink">{chosenPages.length}</span> cards, one per page
              </>
            )}
          </p>

          {building ? (
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-lavender transition-[width]"
                  style={{ width: `${building.total ? Math.round((building.done / building.total) * 100) : 0}%` }}
                />
              </div>
              <span className="text-xs text-ink/55">
                {building.done} of {building.total} uploaded…
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={build}
              disabled={rangeError || (mode === PDF_MODE_PAIRS ? activePairs.length === 0 : chosenPages.length === 0)}
              className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
            >
              Build {mode === PDF_MODE_PAIRS ? activePairs.length : chosenPages.length} cards
            </button>
          )}
        </div>
      )}

      {!targetCategoryId && (
        <p className="mt-2 text-xs text-amber-700">Choose a target category first (step 2).</p>
      )}
    </section>
  );
}
