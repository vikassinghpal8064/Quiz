import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import EmptyState from "../../../components/EmptyState";
import ConfirmDeleteModal from "../../../components/ConfirmDeleteModal";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import useStartSession from "../hooks/useStartSession";
import {
  getCategory,
  listCards,
  deleteCard,
  suspendCards,
} from "../lib/api";
import FlashBreadcrumbs from "../components/FlashBreadcrumbs";
import CardRow from "../components/CardRow";
import MoveCardModal from "../components/MoveCardModal";
import { ListSkeleton, ErrorState } from "../components/FlashStates";

// The card editor pulls in the rich-text engine (Tiptap + KaTeX). It is code-
// split and only fetched once the user actually opens the editor, so browsing
// the category list stays light.
const CardEditorModal = lazy(() => import("../components/CardEditorModal"));

const PAGE_SIZE = 50;

function Stat({ value, label }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-center shadow-card">
      <div className="stat-num text-xl text-ink">{value}</div>
      <div className="text-xs text-ink/50">{label}</div>
    </div>
  );
}

// /flash/category/:categoryId - the card list: search, tag filter, multi-select
// with bulk move / suspend / delete, and a floating add button.
export default function CategoryPage() {
  const { categoryId } = useParams();

  const [category, setCategory] = useState(null);
  const [categoryError, setCategoryError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [cards, setCards] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const [selection, setSelection] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [editCard, setEditCard] = useState(null);
  const [moveIds, setMoveIds] = useState([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { toasts, notify, dismiss } = useToast();
  const startStudySession = useStartSession(notify);
  const [studyBusy, setStudyBusy] = useState(false);

  // ---------- category ----------
  useEffect(() => {
    let cancelled = false;
    setCategoryError(null);
    setNotFound(false);
    getCategory(categoryId)
      .then((data) => {
        if (!cancelled) setCategory(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (/not found/i.test(err.message)) setNotFound(true);
        else setCategoryError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  function refreshCategory() {
    getCategory(categoryId)
      .then(setCategory)
      .catch(() => {});
  }

  // ---------- search debounce ----------
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // ---------- card list ----------
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    setCards([]);
    setNextCursor(null);
    setSelection(new Set());
    listCards({
      categoryId,
      q: debouncedQ || undefined,
      tag: tagFilter || undefined,
      limit: PAGE_SIZE,
    })
      .then((data) => {
        if (cancelled) return;
        setCards(data.cards ?? []);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch((err) => {
        if (!cancelled) setListError(err.message);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, debouncedQ, tagFilter, reloadToken]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await listCards({
        categoryId,
        q: debouncedQ || undefined,
        tag: tagFilter || undefined,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setCards((prev) => [...prev, ...(data.cards ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoadingMore(false);
    }
  }

  const tagOptions = useMemo(() => {
    const set = new Set();
    for (const card of cards) for (const tag of card.tags ?? []) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cards]);

  const selectedCards = useMemo(
    () => cards.filter((c) => selection.has(c.id)),
    [cards, selection]
  );
  const allSuspended = selectedCards.length > 0 && selectedCards.every((c) => c.suspended);
  const allSelected = cards.length > 0 && cards.every((c) => selection.has(c.id));
  const filterActive = Boolean(debouncedQ || tagFilter);

  // ---------- selection ----------
  function toggleSelect(id) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelection(allSelected ? new Set() : new Set(cards.map((c) => c.id)));
  }

  // ---------- mutations ----------
  function handleSaved() {
    setReloadToken((n) => n + 1);
    refreshCategory();
  }

  function handleAdded(card) {
    notify("Card added.");
    setReloadToken((n) => n + 1);
    refreshCategory();
    return card;
  }

  async function deleteOne() {
    if (!confirmDeleteCard) return;
    setDeleteBusy(true);
    try {
      await deleteCard(confirmDeleteCard.id);
      setCards((prev) => prev.filter((c) => c.id !== confirmDeleteCard.id));
      setSelection((prev) => {
        const next = new Set(prev);
        next.delete(confirmDeleteCard.id);
        return next;
      });
      notify("Card deleted.");
      setConfirmDeleteCard(null);
      refreshCategory();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function deleteSelected() {
    const ids = [...selection];
    if (!ids.length) return;
    setDeleteBusy(true);
    try {
      await Promise.all(ids.map((id) => deleteCard(id)));
      setCards((prev) => prev.filter((c) => !selection.has(c.id)));
      setSelection(new Set());
      notify(`Deleted ${ids.length} ${ids.length === 1 ? "card" : "cards"}.`);
      setConfirmBulkDelete(false);
      refreshCategory();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function bulkSuspend() {
    const ids = [...selection];
    if (!ids.length) return;
    const target = !allSuspended;
    setBulkBusy(true);
    try {
      await suspendCards(ids, target);
      setCards((prev) =>
        prev.map((c) => (selection.has(c.id) ? { ...c, suspended: target } : c))
      );
      notify(`${ids.length} ${ids.length === 1 ? "card" : "cards"} ${target ? "suspended" : "unsuspended"}.`);
      refreshCategory();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBulkBusy(false);
    }
  }

  function openMove() {
    setMoveIds([...selection]);
    setMoveOpen(true);
  }

  async function handleMoved(result, target) {
    setMoveOpen(false);
    const count = moveIds.length;
    setSelection(new Set());
    setMoveIds([]);
    notify(`Moved ${result?.moved ?? count} ${count === 1 ? "card" : "cards"} to “${target.name}”.`);
    setReloadToken((n) => n + 1);
    refreshCategory();
  }

  async function startStudy(kind) {
    if (studyBusy) return;
    setStudyBusy(true);
    try {
      await startStudySession({
        scope_type: "category",
        scope_id: Number(categoryId),
        mode: kind === "focus" ? "focus" : "due",
      });
    } finally {
      setStudyBusy(false);
    }
  }

  // ---------- render ----------
  const crumbs = [{ label: "Flash Cards", to: "/flash" }];
  if (category?.folder_id) {
    crumbs.push({ label: category.folder_name ?? "Folder", to: `/flash/folder/${category.folder_id}` });
  }
  if (category) crumbs.push({ label: category.name });

  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <FlashBreadcrumbs items={[{ label: "Flash Cards", to: "/flash" }]} />
        <EmptyState
          icon="🔍"
          title="Category not found"
          description="This category may have been deleted."
        >
          <Link
            to="/flash"
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Back to Flash Cards
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 pb-28 sm:px-6 lg:px-8">
      <FlashBreadcrumbs items={crumbs} />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            {category?.name ?? "Category"}
          </h1>
          {category?.description && (
            <p className="mt-1 text-sm text-ink/55">{category.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => startStudy("study")}
            disabled={studyBusy}
            className="rounded-xl border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
          >
            Study
          </button>
          <button
            type="button"
            onClick={() => startStudy("focus")}
            disabled={studyBusy}
            className="rounded-xl border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
          >
            Focus Session
          </button>
          <Link
            to={`/flash/import?categoryId=${categoryId}${category?.folder_id ? `&folderId=${category.folder_id}` : ""}`}
            className="rounded-xl border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:bg-stone-100"
          >
            Import
          </Link>
        </div>
      </div>

      {category && (
        <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-md">
          <Stat value={category.card_count ?? 0} label="cards" />
          <Stat value={category.due_count ?? 0} label="due today" />
          <Stat value={category.struggling_count ?? 0} label="struggling" />
        </div>
      )}

      {categoryError && (
        <div className="mb-6">
          <ErrorState message={categoryError} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards…"
          aria-label="Search cards"
          className="field w-full px-3 py-2.5 text-sm sm:flex-1"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label="Filter by tag"
          className="field w-full px-3 py-2.5 text-sm sm:w-48"
        >
          <option value="">All tags</option>
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
      </div>

      {selection.size > 0 && (
        <div className="sticky top-2 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-ink/10 bg-white/95 p-3 shadow-card-hover backdrop-blur">
          <span className="text-sm font-semibold text-ink">{selection.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openMove}
              disabled={bulkBusy}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
            >
              Move
            </button>
            <button
              type="button"
              onClick={bulkSuspend}
              disabled={bulkBusy}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
            >
              {allSuspended ? "Unsuspend" : "Suspend"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkBusy}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelection(new Set())}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink/55 transition hover:bg-stone-100"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {listLoading ? (
        <ListSkeleton rows={5} />
      ) : listError ? (
        <ErrorState message={listError} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : cards.length === 0 ? (
        filterActive ? (
          <EmptyState
            icon="🔍"
            title="No cards match"
            description="Try a different search or clear the tag filter."
          >
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setTagFilter("");
              }}
              className="rounded-xl border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink/75 transition hover:bg-stone-100"
            >
              Clear filters
            </button>
          </EmptyState>
        ) : (
          <EmptyState
            icon="🃏"
            title="No cards yet"
            description="Add your first card to start building this category."
          >
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              + Add Card
            </button>
          </EmptyState>
        )
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between px-1">
            <label className="flex items-center gap-2 text-sm text-ink/55">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-ink/25 accent-emerald-600"
              />
              Select all
            </label>
            <span className="text-xs text-ink/40">
              {cards.length} shown{nextCursor ? "+" : ""}
            </span>
          </div>

          <ul className="space-y-3">
            {cards.map((card) => (
              <li key={card.id}>
                <CardRow
                  card={card}
                  selected={selection.has(card.id)}
                  onToggleSelect={toggleSelect}
                  onEdit={setEditCard}
                  onMove={(c) => {
                    setMoveIds([c.id]);
                    setMoveOpen(true);
                  }}
                  onDelete={setConfirmDeleteCard}
                />
              </li>
            ))}
          </ul>

          {nextCursor && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-xl border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      {/* Floating add button */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-20 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-card-hover transition hover:bg-emerald-700 md:bottom-8 md:right-8"
      >
        + Add Card
      </button>

      {(addOpen || editCard) && (
        <Suspense fallback={null}>
          <CardEditorModal
            key="card-editor-add"
            open={addOpen}
            categoryId={categoryId}
            tagSuggestions={tagOptions}
            onClose={() => setAddOpen(false)}
            onSaved={handleAdded}
          />

          <CardEditorModal
            key={`card-editor-edit-${editCard?.id ?? "none"}`}
            open={Boolean(editCard)}
            card={editCard}
            categoryId={categoryId}
            tagSuggestions={tagOptions}
            onClose={() => setEditCard(null)}
            onSaved={() => {
              notify("Card updated.");
              handleSaved();
            }}
          />
        </Suspense>
      )}

      <MoveCardModal
        open={moveOpen}
        cardIds={moveIds}
        currentFolderId={category?.folder_id}
        currentCategoryId={category?.id}
        onClose={() => setMoveOpen(false)}
        onMoved={handleMoved}
      />

      <ConfirmDeleteModal
        open={Boolean(confirmDeleteCard)}
        title="Delete Card"
        finalLabel="Yes, delete it"
        busy={deleteBusy}
        onConfirm={deleteOne}
        onClose={() => setConfirmDeleteCard(null)}
      >
        Delete this card? This cannot be undone.
      </ConfirmDeleteModal>

      <ConfirmDeleteModal
        open={confirmBulkDelete}
        title="Delete Cards"
        finalLabel="Yes, delete them"
        busy={deleteBusy}
        onConfirm={deleteSelected}
        onClose={() => setConfirmBulkDelete(false)}
      >
        Delete <span className="font-semibold text-ink">{selection.size}</span>{" "}
        {selection.size === 1 ? "card" : "cards"}? This cannot be undone.
      </ConfirmDeleteModal>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
