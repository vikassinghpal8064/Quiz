import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import { bulkCreateCards, getCategory, listCategories, listFolders } from "../lib/api";
import {
  MAX_BULK_CARDS,
  buildCards,
  chunkCards,
  importableRows,
  parseImport,
} from "../lib/importParse";

// /flash/import - paste or upload a CSV/TSV and bulk-create cards.
//
// The parsing is pure (lib/importParse.js); this screen only handles the file
// input, the folder/category pickers and the batched POSTs. A file larger than
// the endpoint's per-call limit (MAX_BULK_CARDS) is split into several calls so
// an import of any size still works.
//
// The target category may be preselected with ?folderId=&categoryId=, which is
// how the "Import" button on a category page links here.

const PREVIEW_ROWS = 12;
const PREVIEW_ERRORS = 6;

const DELIMITER_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "\t", label: "Tab" },
  { value: ",", label: "Comma" },
];

const HEADER_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "yes", label: "First row is a header" },
  { value: "no", label: "No header" },
];

// A stable empty array so `categories` keeps its identity between renders while
// a folder's categories are still loading.
const EMPTY_CATEGORIES = [];

function delimiterFor(mode) {
  return mode === "auto" ? undefined : mode;
}

export default function ImportPage() {
  const [params] = useSearchParams();
  const { toasts, notify, dismiss } = useToast();

  const initialFolder = params.get("folderId") ?? "";
  const initialCategory = params.get("categoryId") ?? "";

  const [folderId, setFolderId] = useState(initialFolder);
  const [categoryId, setCategoryId] = useState(initialCategory);

  const [folders, setFolders] = useState(null); // null = still loading
  const [cat, setCat] = useState(null); // { folderId, rows }
  const [loadError, setLoadError] = useState(null);

  const [text, setText] = useState("");
  const [delimiterMode, setDelimiterMode] = useState("auto");
  const [headerMode, setHeaderMode] = useState("auto");

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null); // { inserted }

  // ---------- folders (once) ----------
  useEffect(() => {
    let cancelled = false;
    listFolders()
      .then(async (rows) => {
        if (cancelled) return;
        setFolders(rows);
        // Preselect from the URL, else the first folder. A category-only link
        // resolves its folder through the category itself.
        if (initialFolder && rows.some((f) => String(f.id) === String(initialFolder))) {
          setFolderId(String(initialFolder));
        } else if (initialCategory) {
          const found = await getCategory(initialCategory).catch(() => null);
          if (!cancelled && found?.folder_id) setFolderId(String(found.folder_id));
        } else if (rows[0]) {
          setFolderId(String(rows[0].id));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.message);
          setFolders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialCategory, initialFolder]);

  // ---------- categories for the chosen folder ----------
  useEffect(() => {
    if (!folderId) return undefined;
    let cancelled = false;
    listCategories(folderId)
      .then((rows) => {
        if (!cancelled) setCat({ folderId, rows });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const loadingFolders = folders === null;
  const loadingCategories = Boolean(folderId) && (!cat || String(cat.folderId) !== String(folderId));
  const categories =
    cat && String(cat.folderId) === String(folderId) ? cat.rows : EMPTY_CATEGORIES;

  // Keep the selected category valid for the folder that is now loaded.
  useEffect(() => {
    if (!categoryId) return;
    if (loadingCategories) return;
    if (!categories.some((c) => String(c.id) === String(categoryId))) setCategoryId("");
  }, [categories, categoryId, loadingCategories]);

  // ---------- parse (pure) ----------
  const parsed = useMemo(
    () =>
      parseImport(text, {
        delimiter: delimiterFor(delimiterMode, text),
        header: headerMode === "auto" ? undefined : headerMode === "yes",
      }),
    [text, delimiterMode, headerMode]
  );

  const ready = importableRows(parsed);
  const targetCategory = categories.find((c) => String(c.id) === String(categoryId)) ?? null;
  const canImport = Boolean(targetCategory) && ready.length > 0 && !importing;

  async function loadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      setResult(null);
    } catch {
      notify("Could not read that file.", "error");
    }
  }

  async function runImport() {
    if (!canImport) return;
    const cards = buildCards(ready, { categoryId: targetCategory.id });
    const batches = chunkCards(cards, MAX_BULK_CARDS);
    setImporting(true);
    setResult(null);
    setProgress({ done: 0, total: cards.length });
    let inserted = 0;
    try {
      for (const batch of batches) {
        const res = await bulkCreateCards(batch, targetCategory.id);
        inserted += res.inserted ?? batch.length;
        setProgress({ done: inserted, total: cards.length });
      }
      setResult({ inserted });
      notify(`Imported ${inserted} ${inserted === 1 ? "card" : "cards"}.`, "success");
    } catch (err) {
      // Earlier batches are already saved (each batch is its own transaction),
      // so report what did land before the failure.
      notify(
        inserted > 0
          ? `Imported ${inserted} before stopping: ${err.message}`
          : err.message,
        "error"
      );
      if (inserted > 0) setResult({ inserted, partial: true });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function reset() {
    setText("");
    setResult(null);
  }

  const previewRows = parsed.rows.slice(0, PREVIEW_ROWS);
  const skipped = parsed.rows.length - ready.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link to="/flash" className="text-sm font-medium text-ink/50 transition hover:text-ink">
          ‹ Flash Cards
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
          Import Cards
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          Paste rows or choose a CSV/TSV file. Each row becomes one card: front, back and
          optional tags.
        </p>
      </div>

      {loadError && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {/* ---------- target ---------- */}
      <section className="card mb-5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Target</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink/70">
            Folder
            <select
              value={folderId}
              disabled={loadingFolders}
              onChange={(e) => setFolderId(e.target.value)}
              className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
            >
              {loadingFolders && <option>Loading…</option>}
              {!loadingFolders && folders.length === 0 && <option value="">No folders yet</option>}
              {(folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-ink/70">
            Category
            <select
              value={categoryId}
              disabled={loadingCategories || !folderId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
            >
              <option value="">
                {loadingCategories ? "Loading…" : "Select a category"}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.card_count ?? 0})
                </option>
              ))}
            </select>
          </label>
        </div>
        {!loadingFolders && folders.length === 0 && (
          <p className="mt-3 text-sm text-ink/55">
            You need a folder and category first.{" "}
            <Link to="/flash" className="font-semibold text-lavender-soft hover:underline">
              Create one
            </Link>
            .
          </p>
        )}
      </section>

      {/* ---------- source ---------- */}
      <section className="card mb-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Source</h2>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100">
              Choose file…
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={loadFile}
                className="hidden"
              />
            </label>
            {text && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-stone-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          rows={8}
          spellCheck={false}
          placeholder={"Question,Answer,Tags\nWhat is 2+2?,4,math\nCapital of France,Paris,geo"}
          className="field mt-3 w-full resize-y px-3 py-2.5 font-mono text-xs leading-relaxed"
        />

        <div className="mt-3 flex flex-wrap gap-4">
          <label className="text-xs font-medium text-ink/60">
            Delimiter
            <select
              value={delimiterMode}
              onChange={(e) => setDelimiterMode(e.target.value)}
              className="field mt-1 block px-2 py-1.5 text-xs"
            >
              {DELIMITER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o.value === "auto" ? ` (${parsed.delimiter === "\t" ? "tab" : "comma"})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-ink/60">
            Header
            <select
              value={headerMode}
              onChange={(e) => setHeaderMode(e.target.value)}
              className="field mt-1 block px-2 py-1.5 text-xs"
            >
              {HEADER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-3 text-xs text-ink/50">
          Columns read as{" "}
          <span className="font-mono">
            front={parsed.columns.front + 1} back={parsed.columns.back + 1}
            {parsed.columns.tags >= 0 ? ` tags=${parsed.columns.tags + 1}` : " tags=none"}
          </span>
          . Fields with commas must be wrapped in double quotes.
        </p>
      </section>

      {/* ---------- preview ---------- */}
      {text.trim() && (
        <section className="card mb-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Preview</h2>
            <p className="text-sm text-ink/60">
              <span className="font-semibold text-ink">{ready.length}</span> ready
              {skipped > 0 && <span className="text-amber-600"> · {skipped} skipped</span>}
            </p>
          </div>

          {parsed.errors.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {parsed.errors.slice(0, PREVIEW_ERRORS).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {parsed.errors.length > PREVIEW_ERRORS && (
                <li>…and {parsed.errors.length - PREVIEW_ERRORS} more</li>
              )}
            </ul>
          )}

          {parsed.rows.length === 0 ? (
            <p className="mt-3 text-sm text-ink/55">No rows detected.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/45">
                    <th className="px-2 py-2">Line</th>
                    <th className="px-2 py-2">Front</th>
                    <th className="px-2 py-2">Back</th>
                    <th className="px-2 py-2">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr
                      key={row.line}
                      className={`border-b border-ink/5 ${row.front && row.back ? "" : "bg-red-50/70"}`}
                    >
                      <td className="px-2 py-2 text-xs text-ink/40">{row.line}</td>
                      <td className="max-w-xs truncate px-2 py-2 text-ink">{row.front || "—"}</td>
                      <td className="max-w-xs truncate px-2 py-2 text-ink/80">{row.back || "—"}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.tags.length === 0 && <span className="text-xs text-ink/30">—</span>}
                          {row.tags.map((tag) => (
                            <span key={tag} className="card-chip">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > PREVIEW_ROWS && (
                <p className="mt-2 text-xs text-ink/45">
                  Showing the first {PREVIEW_ROWS} of {parsed.rows.length} rows.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- action ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/55">
          {targetCategory ? (
            <>
              Import into <span className="font-semibold text-ink">{targetCategory.name}</span>
            </>
          ) : (
            "Choose a category to import into."
          )}
        </p>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-xs text-ink/50">
              {progress.done} / {progress.total}
            </span>
          )}
          <button
            type="button"
            onClick={runImport}
            disabled={!canImport}
            className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
          >
            {importing ? "Importing…" : `Import ${ready.length || ""}`.trim()}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          <p className="font-semibold">
            {result.partial ? "Partially imported" : "Import complete"}
          </p>
          <p className="mt-1">
            {result.inserted} {result.inserted === 1 ? "card" : "cards"} added to{" "}
            {targetCategory?.name ?? "the category"}.
          </p>
          {targetCategory && (
            <Link
              to={`/flash/category/${targetCategory.id}`}
              className="mt-2 inline-block font-semibold text-emerald-800 underline"
            >
              View category
            </Link>
          )}
        </div>
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
