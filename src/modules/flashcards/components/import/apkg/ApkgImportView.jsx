import { useEffect, useMemo, useState } from "react";
import { loadApkgFile } from "../../../importers/apkg/load.js";
import { buildApkgCandidates } from "../../../importers/apkg/build.js";
import {
  countMediaRefs,
  defaultFieldMapping,
  fieldText,
  notetypeFieldNames,
  notetypesWithCounts,
  splitFields,
} from "../../../importers/anki.js";

// The Anki .apkg importer, rendered inside step 3 of the wizard.
//
// It owns everything deck-specific - unzipping, reading the SQLite collection
// with sql.js, choosing a notetype and mapping its fields - and hands the
// finished candidates back with onContinue(). The only network use is uploading
// the images a mapped field references (build.js).
//
// Loading jszip/sql.js/wasm is deferred until an actual deck is picked, so a
// CSV or PDF import never pays for the Anki path.

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink/60">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-lavender border-t-transparent" />
      {label}
    </div>
  );
}

export default function ApkgImportView({ files, notify, onContinue }) {
  const file = files?.[0] ?? null;

  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState(null);

  const [mid, setMid] = useState("");
  const [front, setFront] = useState(0);
  const [back, setBack] = useState([]);
  const [includeTags, setIncludeTags] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);

  const [building, setBuilding] = useState(null); // {done,total}
  const [buildError, setBuildError] = useState(null);

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    setStatus("loading");
    setError(null);
    setDeck(null);
    setBuildError(null);

    loadApkgFile(file)
      .then((loaded) => {
        if (cancelled) return;
        const summaries = notetypesWithCounts(loaded.notetypes, loaded.notes);
        // Default to the notetype that holds the most notes.
        const primary = summaries.slice().sort((a, b) => b.count - a.count)[0] ?? null;
        const mapping = primary ? defaultFieldMapping(loaded.notetypes[primary.mid]) : { front: 0, back: [] };
        setDeck({ ...loaded, summaries });
        setMid(primary?.mid ?? "");
        setFront(mapping.front);
        setBack(mapping.back);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  const notetype = deck?.notetypes?.[mid] ?? null;
  const fieldNames = useMemo(() => notetypeFieldNames(notetype), [notetype]);

  const notes = useMemo(
    () => (deck?.notes ?? []).filter((note) => note.mid === mid),
    [deck, mid]
  );
  const noteCount = notes.length;

  // How many images the selected notes reference, so the user knows what will
  // leave their machine before they build.
  const imageCount = useMemo(() => {
    if (!deck) return 0;
    let total = 0;
    for (const note of notes) {
      const fields = splitFields(note.flds);
      for (const index of [front, ...back]) total += countMediaRefs(fields[index] ?? "");
    }
    return total;
  }, [deck, notes, front, back]);

  const preview = useMemo(() => {
    if (!deck) return [];
    return notes.slice(0, 3).map((note) => {
      const fields = splitFields(note.flds);
      return {
        id: note.id,
        front: fieldText(fields, [front]),
        back: fieldText(fields, back),
      };
    });
  }, [deck, notes, front, back]);

  function chooseNotetype(nextMid) {
    setMid(nextMid);
    const mapping = defaultFieldMapping(deck?.notetypes?.[nextMid]);
    setFront(mapping.front);
    setBack(mapping.back);
  }

  function toggleBack(index) {
    setBack((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b)));
  }

  const canBuild = status === "ready" && noteCount > 0 && front != null && back.length > 0 && !building;

  async function build() {
    if (!deck || !canBuild) return;
    setBuildError(null);
    setBuilding({ done: 0, total: noteCount });
    try {
      const candidates = await buildApkgCandidates(deck.notes, {
        zip: deck.zip,
        mediaMap: deck.mediaMap,
        mid,
        mapping: { front, back },
        includeTags,
        includeImages,
        onProgress: (done, total) => setBuilding({ done, total }),
      });
      if (!candidates.length) {
        setBuildError("None of the selected notes produced a card.");
        setBuilding(null);
        return;
      }
      onContinue(candidates);
    } catch (err) {
      setBuildError(err.message);
      notify?.(`Could not build cards from the deck: ${err.message}`, "error");
      setBuilding(null);
    }
  }

  return (
    <section className="card mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Anki deck</h2>
        {file && <span className="text-xs text-ink/50">{file.name}</span>}
      </div>

      {status === "idle" && <p className="mt-3 text-sm text-ink/55">Choose a .apkg file in step 1.</p>}

      {status === "loading" && (
        <div className="mt-3">
          <Spinner label="Unzipping and reading the collection…" />
        </div>
      )}

      {status === "error" && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {status === "ready" && deck && (
        <>
          <p className="mt-2 text-sm text-ink/60">
            <span className="font-semibold text-ink">{deck.notes.length}</span> notes across{" "}
            <span className="font-semibold text-ink">{deck.summaries.length}</span>{" "}
            {deck.summaries.length === 1 ? "notetype" : "notetypes"}. Pick the one to import and
            map its fields.
          </p>

          {deck.summaries.length === 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This deck has no notes in it.
            </p>
          )}

          {deck.summaries.length > 0 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink/60">
                Notetype
                <select
                  value={mid}
                  onChange={(e) => chooseNotetype(e.target.value)}
                  className="field mt-1 w-full px-2.5 py-2 text-sm"
                >
                  {deck.summaries.map((summary) => (
                    <option key={summary.mid} value={summary.mid}>
                      {summary.name} ({summary.count})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-ink/60">
                Front field
                <select
                  value={front}
                  onChange={(e) => setFront(Number(e.target.value))}
                  className="field mt-1 w-full px-2.5 py-2 text-sm"
                >
                  {fieldNames.map((name, index) => (
                    <option key={index} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="sm:col-span-2">
                <div className="text-xs font-medium text-ink/60">Back fields</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {fieldNames.map((name, index) => (
                    <label
                      key={index}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                        back.includes(index) ? "border-lavender bg-lavender/10 text-ink" : "border-ink/15 bg-white text-ink/70"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={back.includes(index)}
                        onChange={() => toggleBack(index)}
                        className="h-3.5 w-3.5 rounded border-ink/20"
                      />
                      {name}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-ink/45">
                  Chosen fields are joined onto the back, in field order.
                </p>
              </div>
            </div>
          )}

          {deck.summaries.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={includeTags}
                  onChange={(e) => setIncludeTags(e.target.checked)}
                  className="h-4 w-4 rounded border-ink/20"
                />
                Keep note tags
              </label>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={includeImages}
                  onChange={(e) => setIncludeImages(e.target.checked)}
                  className="h-4 w-4 rounded border-ink/20"
                />
                Include images
              </label>
            </div>
          )}

          {preview.length > 0 && (
            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">Preview</div>
              <ul className="mt-2 space-y-2">
                {preview.map((row) => (
                  <li key={row.id} className="rounded-lg border border-ink/10 bg-stone-50 p-3 text-sm">
                    <div className="font-medium text-ink">{row.front || <span className="text-ink/40">—</span>}</div>
                    <div className="mt-1 whitespace-pre-wrap text-ink/70">
                      {row.back || <span className="text-ink/40">—</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {buildError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {buildError}
            </p>
          )}

          {deck.summaries.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
              <p className="text-sm text-ink/60">
                <span className="font-semibold text-ink">{noteCount}</span> notes
                {includeImages && imageCount > 0 ? ` · ${imageCount} images to upload` : ""}
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
                    Building {building.done}/{building.total}…
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={build}
                  disabled={!canBuild}
                  className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
                >
                  Build {noteCount} cards
                </button>
              )}
            </div>
          )}

          {deck.summaries.length > 0 && back.length === 0 && (
            <p className="mt-2 text-xs text-amber-700">Pick at least one back field.</p>
          )}
        </>
      )}
    </section>
  );
}
