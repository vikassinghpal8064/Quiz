import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LazyPage from "./LazyPage.jsx";
import { cropNormalized } from "../../../importers/pdf/imaging.js";
import { buildImageCandidates, renderPageForExport } from "../../../importers/pdf/build.js";
import { SOURCES } from "../../../importers/candidate.js";

// Mode A: crop rectangles out of a page. Each rectangle becomes a card; a
// rectangle can be the front (question) and another the answer, or a single
// rectangle can stand alone with notes on the back.
//
// Interactions are deliberately keyboard-first - cropping 80 questions should be
// draw, F, draw, B, Enter, repeat.

const MIN_SIZE = 0.02;
const ROLES = { front: "front", back: "back", single: "single" };
const ROLE_LABEL = { front: "Front", back: "Back", single: "Single" };
const ROLE_BADGE = {
  front: "bg-sky-500 text-white",
  back: "bg-emerald-500 text-white",
  single: "bg-ink/60 text-white",
};

let sequence = 0;
function nextId() {
  sequence += 1;
  return `crop-${sequence}`;
}

export default function CropStage({ source, chosenPages }) {
  const pages = chosenPages ?? [];
  const [pageCursor, setPageCursor] = useState(0);
  const [regionsByPage, setRegionsByPage] = useState(() => new Map());
  const [selectedId, setSelectedId] = useState(null);
  const [building, setBuilding] = useState(null);
  const [buildError, setBuildError] = useState(null);

  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const [draft, setDraft] = useState(null);

  const currentPage = pages[Math.min(pageCursor, Math.max(0, pages.length - 1))];
  const regions = useMemo(() => regionsByPage.get(currentPage) ?? [], [regionsByPage, currentPage]);
  const selected = regions.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    setPageCursor(0);
    setRegionsByPage(new Map());
    setSelectedId(null);
  }, [source]);

  const setRegionsForPage = useCallback(
    (page, updater) => {
      setRegionsByPage((prev) => {
        const next = new Map(prev);
        const list = next.get(page) ?? [];
        next.set(page, updater(list));
        return next;
      });
    },
    []
  );

  function normalizedFromEvent(event, el) {
    const box = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    return { x, y };
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const el = event.currentTarget;
    el.setPointerCapture?.(event.pointerId);
    const point = normalizedFromEvent(event, el);
    dragRef.current = { start: point };
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function onPointerMove(event) {
    if (!dragRef.current) return;
    const point = normalizedFromEvent(event, event.currentTarget);
    const { start } = dragRef.current;
    setDraft({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function onPointerUp(event) {
    if (!dragRef.current) return;
    const el = event.currentTarget;
    el.releasePointerCapture?.(event.pointerId);
    const rect = draft;
    dragRef.current = null;
    setDraft(null);
    if (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;

    const id = nextId();
    setRegionsForPage(currentPage, (list) => [...list, { id, ...rect, role: ROLES.single }]);
    setSelectedId(id);
  }

  const removeSelected = useCallback(() => {
    if (!selected) return;
    setRegionsForPage(currentPage, (list) => list.filter((r) => r.id !== selected.id));
    setSelectedId(null);
  }, [selected, currentPage, setRegionsForPage]);

  const setSelectedRole = useCallback(
    (role) => {
      if (!selected) return;
      setRegionsForPage(currentPage, (list) => list.map((r) => (r.id === selected.id ? { ...r, role } : r)));
    },
    [selected, currentPage, setRegionsForPage]
  );

  function onKeyDown(event) {
    if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;
    const key = event.key.toLowerCase();
    if (key === "f") { setSelectedRole(ROLES.front); event.preventDefault(); }
    else if (key === "b") { setSelectedRole(ROLES.back); event.preventDefault(); }
    else if (key === "s") { setSelectedRole(ROLES.single); event.preventDefault(); }
    else if (event.key === "Delete" || event.key === "Backspace") { removeSelected(); event.preventDefault(); }
    else if (event.key === "ArrowRight") { setPageCursor((p) => Math.min(pages.length - 1, p + 1)); event.preventDefault(); }
    else if (event.key === "ArrowLeft") { setPageCursor((p) => Math.max(0, p - 1)); event.preventDefault(); }
  }

  // Pair front rectangles with the next back rectangle on the same page, in
  // creation order. Anything else is a single-sided card.
  function cardsForPage(page, list) {
    const cards = [];
    let pendingFront = null;
    for (const rect of list) {
      if (rect.role === ROLES.front) {
        if (pendingFront) cards.push({ front: pendingFront, back: null });
        pendingFront = rect;
      } else if (rect.role === ROLES.back) {
        if (pendingFront) {
          cards.push({ front: pendingFront, back: rect });
          pendingFront = null;
        } else {
          cards.push({ front: null, back: rect });
        }
      } else {
        cards.push({ front: rect, back: null });
      }
    }
    if (pendingFront) cards.push({ front: pendingFront, back: null });
    return cards.filter((card) => card.front || card.back);
  }

  const totalCards = useMemo(() => {
    let total = 0;
    for (const list of regionsByPage.values()) total += cardsForPage(null, list).length;
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsByPage]);

  async function build() {
    if (building) return;
    setBuildError(null);
    try {
      const regions = [];
      for (const [page, list] of regionsByPage) {
        if (!list.length) continue;
        const cards = cardsForPage(page, list);
        if (!cards.length) continue;
        // Render the page once at the export scale, then crop every rectangle
        // on it before moving on to the next page.
        // eslint-disable-next-line no-await-in-loop
        const pageCanvas = await renderPageForExport(source, page);
        for (const card of cards) {
          const front = card.front
            ? { render: async () => cropNormalized(pageCanvas, card.front), sourceKind: "crop" }
            : null;
          const back = card.back
            ? { render: async () => cropNormalized(pageCanvas, card.back), sourceKind: "crop" }
            : { text: "" };
          regions.push({
            key: `crop:${page}:${card.front?.id ?? card.back?.id}`,
            front: front ?? { text: "" },
            back,
            sourceRef: `pdf:crop-p${page + 1}`,
          });
        }
      }

      if (!regions.length) {
        setBuildError("Draw at least one rectangle first.");
        return;
      }

      setBuilding({ done: 0, total: regions.length });
      const candidates = await buildImageCandidates(regions, {
        source: SOURCES.pdf,
        onProgress: (done, total) => setBuilding({ done, total }),
      });
      onContinue(candidates);
    } catch (err) {
      setBuildError(err?.message ?? "Could not build the cropped cards");
    } finally {
      setBuilding(null);
    }
  }

  if (!pages.length) {
    return <p className="text-sm text-ink/55">Choose at least one page to crop.</p>;
  }

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-xl border border-ink/10 bg-stone-50 p-3 outline-none focus:ring-2 focus:ring-lavender/40"
    >
      {/* thumbnail strip */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {pages.map((page, i) => (
          <button
            key={page}
            type="button"
            onClick={() => setPageCursor(i)}
            className={`relative w-16 shrink-0 overflow-hidden rounded border-2 ${
              i === pageCursor ? "border-lavender" : "border-transparent"
            }`}
          >
            <LazyPage source={source} index={page} targetWidth={120} alt={`Page ${page + 1}`} />
            {(regionsByPage.get(page)?.length ?? 0) > 0 && (
              <span className="absolute right-0.5 top-0.5 rounded bg-lavender px-1 text-[9px] font-bold text-on-accent">
                {regionsByPage.get(page).length}
              </span>
            )}
            <span className="absolute bottom-0 left-0 right-0 bg-ink/60 text-center text-[9px] text-white">
              {page + 1}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
        {/* the page + crop overlay */}
        <div className="relative mx-auto w-full max-w-2xl select-none">
          <LazyPage source={source} index={currentPage} targetWidth={900} alt={`Page ${currentPage + 1}`} />
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {regions.map((rect) => (
              <div
                key={rect.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(rect.id);
                }}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
                className={`absolute cursor-pointer border-2 ${
                  rect.id === selectedId ? "border-lavender ring-2 ring-lavender/50" : "border-sky-400"
                }`}
              >
                <span className={`absolute -top-2 left-0 rounded px-1 text-[9px] font-bold ${ROLE_BADGE[rect.role]}`}>
                  {ROLE_LABEL[rect.role]}
                </span>
              </div>
            ))}
            {draft && (
              <div
                style={{
                  left: `${draft.x * 100}%`,
                  top: `${draft.y * 100}%`,
                  width: `${draft.width * 100}%`,
                  height: `${draft.height * 100}%`,
                }}
                className="absolute border-2 border-dashed border-lavender bg-lavender/10"
              />
            )}
          </div>
        </div>

        {/* controls */}
        <div className="space-y-3 text-sm">
          <p className="text-xs text-ink/55">
            Drag on the page to draw a box. Press <kbd className="rounded bg-white px-1">F</kbd> /{" "}
            <kbd className="rounded bg-white px-1">B</kbd> to mark it front / back,{" "}
            <kbd className="rounded bg-white px-1">S</kbd> for a standalone card,{" "}
            <kbd className="rounded bg-white px-1">Del</kbd> to remove.
          </p>

          {selected ? (
            <div className="rounded-lg border border-ink/10 bg-white p-2">
              <p className="mb-2 text-xs font-semibold text-ink/60">Selected box</p>
              <div className="flex flex-wrap gap-2">
                {Object.values(ROLES).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSelectedRole(role)}
                    aria-pressed={selected.role === role}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      selected.role === role ? "border-lavender bg-lavender/10" : "border-ink/10 bg-white"
                    }`}
                  >
                    {ROLE_LABEL[role]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={removeSelected}
                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink/45">No box selected.</p>
          )}

          <p className="text-xs text-ink/55">
            {regions.length} box{regions.length === 1 ? "" : "es"} on this page · {totalCards} card
            {totalCards === 1 ? "" : "s"} total
          </p>
        </div>
      </div>

      {buildError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{buildError}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-3 border-t border-ink/10 pt-3">
        {building ? (
          <span className="text-xs text-ink/55">
            {building.done} of {building.total} uploaded…
          </span>
        ) : (
          <button
            type="button"
            onClick={build}
            disabled={totalCards === 0}
            className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
          >
            Build {totalCards} cropped cards
          </button>
        )}
      </div>
    </div>
  );
}
