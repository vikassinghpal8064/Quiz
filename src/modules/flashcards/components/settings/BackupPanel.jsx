import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../../../components/Icon";
import {
  bulkCreateCards,
  createCategory,
  createFolder,
  getBackup,
  listCategories,
  listFolders,
  suspendCards,
} from "../../lib/api";
import {
  backupFilename,
  cardsToCsv,
  categoryOptions,
  downloadCsv,
  downloadJson,
  restoreBackup,
} from "../../lib/backup";

// Export / import panel on the settings screen. Loads one backup snapshot on
// mount and derives everything (the folder/category picker, CSV, JSON) from it,
// so a single GET powers every action.

// Every category id in the subtree rooted at `rootId` (inclusive).
function descendantIds(rootId, categories) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id != null && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

export default function BackupPanel({ notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categoryId, setCategoryId] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getBackup());
    } catch (err) {
      setError(err.message || "Failed to load your data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // <optgroup> per folder so the picker reads like the app.
  const groups = useMemo(() => {
    if (!data) return [];
    return data.folders
      .map((folder) => ({
        folder,
        options: categoryOptions(data.categories.filter((c) => c.folder_id === folder.id)),
      }))
      .filter((g) => g.options.length > 0);
  }, [data]);

  const cardCount = data?.cards.length ?? 0;

  const exportJson = useCallback(() => {
    if (!data) return;
    downloadJson(backupFilename("backup", "json"), data);
    notify?.("Backup downloaded");
  }, [data, notify]);

  const exportCsv = useCallback(() => {
    if (!data || !categoryId) return;
    const cat = data.categories.find((c) => String(c.id) === String(categoryId));
    const ids = descendantIds(Number(categoryId), data.categories);
    const cards = data.cards.filter((c) => ids.has(c.category_id));
    downloadCsv(backupFilename(cat ? `csv-${cat.name}` : "csv", "csv"), cardsToCsv(cards));
    notify?.(`Exported ${cards.length} card${cards.length === 1 ? "" : "s"} to CSV`);
  }, [data, categoryId, notify]);

  const onPickFile = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = ""; // allow re-picking the same file
      if (!file) return;

      let raw;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        notify?.("That file is not valid JSON", "error");
        return;
      }

      const ok = window.confirm(
        "Restore this backup?\n\nFolders and categories with the same name are reused; " +
          "cards are added to your existing deck. Nothing is deleted."
      );
      if (!ok) return;

      setRestoring(true);
      setProgress({ phase: "folders", done: 0, total: 0 });
      try {
        const stats = await restoreBackup(raw, {
          listFolders,
          listCategories,
          createFolder,
          createCategory,
          bulkCreateCards,
          suspendCards,
        }, { onProgress: setProgress });
        await load();
        notify?.(
          `Restored ${stats.cards} card${stats.cards === 1 ? "" : "s"} ` +
            `(${stats.folders} new folders, ${stats.categories} new categories)`
        );
      } catch (err) {
        notify?.(err.message || "Restore failed", "error");
      } finally {
        setRestoring(false);
        setProgress(null);
      }
    },
    [load, notify]
  );

  return (
    <section className="answer-card p-6">
      <h2 className="label-caps mb-1">Backup</h2>
      <p className="mb-5 text-xs leading-relaxed text-ink/55">
        Export everything as JSON, or a single category as CSV. Importing restores a JSON backup
        additively — nothing is ever deleted.
      </p>

      {loading && <p className="text-sm text-ink/50">Loading your data…</p>}

      {!loading && error && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-wrong">{error}</p>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink/70 hover:text-ink"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-5">
          <p className="text-xs text-ink/45">
            {data.folders.length} folder{data.folders.length === 1 ? "" : "s"} ·{" "}
            {data.categories.length} categor{data.categories.length === 1 ? "y" : "ies"} · {cardCount}{" "}
            card{cardCount === 1 ? "" : "s"}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportJson}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-semibold text-ink/80 transition hover:text-ink"
            >
              <Icon name="download" size={16} />
              Export JSON
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={onPickFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-semibold text-ink/80 transition hover:text-ink disabled:opacity-40"
            >
              <Icon name="upload" size={16} />
              {restoring ? "Restoring…" : "Import JSON"}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="label-caps mb-1 block">Export a category as CSV</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="field h-10 w-full px-3 text-sm"
              >
                <option value="">Choose a category…</option>
                {groups.map((g) => (
                  <optgroup key={g.folder.id} label={`${g.folder.icon ?? "🗂️"} ${g.folder.name}`}>
                    {g.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!categoryId}
              className="rounded-xl border border-line px-3.5 py-2 text-sm font-semibold text-ink/80 transition hover:text-ink disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>

          {progress && (
            <p className="text-xs text-ink/55">
              Restoring {progress.phase}… {progress.done}/{progress.total || "?"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
