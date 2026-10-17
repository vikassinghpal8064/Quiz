import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { listFolders, listCategories, moveCards } from "../lib/api";
import { overlay, panel } from "./modalMotion";

// Move dialog for one or many cards: Folder dropdown -> Category dropdown ->
// summary -> confirm. Mirrors MoveQuestionsModal, but for the flash tree and
// using the flash API helpers.
export default function MoveCardModal({
  open,
  cardIds = [],
  currentFolderId = null,
  currentCategoryId = null,
  onClose,
  onMoved,
}) {
  const [folders, setFolders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [folderId, setFolderId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Load folders when the dialog opens, preselecting the current one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setArmed(false);
    setCategoryId("");
    setError(null);
    setLoadingFolders(true);
    listFolders()
      .then((rows) => {
        if (cancelled) return;
        setFolders(rows);
        const initial =
          currentFolderId && rows.some((f) => f.id === Number(currentFolderId))
            ? String(currentFolderId)
            : rows[0]
              ? String(rows[0].id)
              : "";
        setFolderId(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingFolders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentFolderId]);

  // Load the chosen folder's categories whenever the folder changes.
  useEffect(() => {
    if (!open || !folderId) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    setLoadingCategories(true);
    setCategoryId("");
    listCategories(folderId)
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderId]);

  const target = categories.find((c) => String(c.id) === String(categoryId)) ?? null;
  const count = cardIds.length;
  const selectable = categories.filter((c) => c.id !== currentCategoryId);

  async function confirmMove() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await moveCards(cardIds, target.id);
      onMoved?.(result, target);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative w-full max-w-2xl rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Move cards"
          >
            <h2 className="text-xl font-semibold text-ink">Move Cards</h2>
            <p className="mt-1 text-sm text-ink/55">
              {count} {count === 1 ? "card" : "cards"} selected.
            </p>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <label className="mt-4 block text-sm font-medium text-ink/70">
              Folder
              <select
                value={folderId}
                disabled={loadingFolders}
                onChange={(e) => setFolderId(e.target.value)}
                className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
              >
                {loadingFolders && <option>Loading…</option>}
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium text-ink/70">
              Category
              <select
                value={categoryId}
                disabled={loadingCategories || !folderId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setArmed(false);
                }}
                className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
              >
                <option value="">
                  {loadingCategories ? "Loading…" : "Select a category"}
                </option>
                {selectable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.card_count ?? 0})
                  </option>
                ))}
              </select>
            </label>

            {target && (
              <p className="mt-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-ink/75">
                Move <span className="font-semibold">{count}</span>{" "}
                {count === 1 ? "card" : "cards"} to{" "}
                <span className="font-semibold">{target.name}</span>.
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100 disabled:opacity-50"
              >
                Cancel
              </button>

              {!armed ? (
                <button
                  type="button"
                  disabled={!target || busy}
                  onClick={() => setArmed(true)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || !target}
                  onClick={confirmMove}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? "Moving…" : `Confirm move (${count})`}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
