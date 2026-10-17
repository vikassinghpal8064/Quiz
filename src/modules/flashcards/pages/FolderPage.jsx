import { useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { Link, useParams } from "react-router-dom";
import EmptyState from "../../../components/EmptyState";
import ConfirmDeleteModal from "../../../components/ConfirmDeleteModal";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import useStartSession from "../hooks/useStartSession";
import { listFolders, listCategories, updateCategory, deleteCategory } from "../lib/api";
import { folderIcon } from "../lib/format";
import FlashBreadcrumbs from "../components/FlashBreadcrumbs";
import CategoryModal from "../components/CategoryModal";
import { ListSkeleton, ErrorState } from "../components/FlashStates";

function CountBadge({ value, label, tone = "neutral" }) {
  const tones = {
    neutral: "bg-stone-100 text-ink/60",
    due: "bg-emerald-50 text-emerald-800",
    struggling: "bg-pink/20 text-pink",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {value} {label}
    </span>
  );
}

// /flash/folder/:folderId - the folder's categories with card / due / struggling
// counts. Categories can be created, renamed, deleted, and reordered by drag
// (or with the up/down buttons, for keyboard users).
export default function FolderPage() {
  const { folderId } = useParams();

  const [folder, setFolder] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const { toasts, notify, dismiss } = useToast();
  const startStudySession = useStartSession(notify);
  const [studyBusy, setStudyBusy] = useState(false);

  async function startStudy(kind) {
    if (studyBusy) return;
    setStudyBusy(true);
    try {
      await startStudySession({
        scope_type: "folder",
        scope_id: Number(folderId),
        mode: kind === "focus" ? "focus" : "due",
      });
    } finally {
      setStudyBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    Promise.all([listFolders(), listCategories(folderId)])
      .then(([folders, cats]) => {
        if (cancelled) return;
        const found = folders.find((f) => f.id === Number(folderId)) ?? null;
        if (!found) {
          setNotFound(true);
          return;
        }
        setFolder(found);
        setCategories(cats);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  function handleCreated(category) {
    setCategories((prev) => [...prev, category]);
    notify(`Created “${category.name}”.`);
  }

  function handleSaved(category) {
    setCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, ...category } : c)));
    notify(`Updated “${category.name}”.`);
  }

  async function confirmDeleteCategory() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      const result = await deleteCategory(confirmDelete.id);
      setCategories((prev) => prev.filter((c) => c.id !== confirmDelete.id));
      const cards = result?.deleted?.cards ?? 0;
      notify(`Deleted “${result?.name ?? confirmDelete.name}” (${cards} cards).`);
      setConfirmDelete(null);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  // Persist a new order: assign sort_order = index to every moved row. Only the
  // rows whose value actually changed are PATCHed.
  function moveCategory(from, to) {
    if (from == null || to == null || from === to || to < 0 || to >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    const renumbered = next.map((c, i) => ({ ...c, sort_order: i }));
    const updates = [];
    renumbered.forEach((c, i) => {
      const before = categories.find((old) => old.id === c.id);
      if ((before?.sort_order ?? 0) !== i) updates.push({ id: c.id, sort_order: i });
    });

    setCategories(renumbered);
    setDragIndex(null);
    setOverIndex(null);
    if (!updates.length) return;

    Promise.all(updates.map((u) => updateCategory(u.id, { sort_order: u.sort_order }))).catch((err) => {
      notify(err.message, "error");
    });
  }

  function onDragStart(e, index) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (index !== overIndex) setOverIndex(index);
  }

  function onDrop(e, index) {
    e.preventDefault();
    moveCategory(dragIndex, index);
  }

  function onDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  const breadcrumb = (
    <FlashBreadcrumbs
      items={[{ label: "Flash Cards", to: "/flash" }, { label: folder?.name ?? "Folder" }]}
    />
  );

  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        {breadcrumb}
        <EmptyState
          icon="search"
          title="Folder not found"
          description="This folder may have been deleted."
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
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      {breadcrumb}

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-2xl">
            {folderIcon(folder?.icon)}
          </span>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              {folder?.name ?? "Folder"}
            </h1>
            {folder?.description && <p className="mt-1 text-sm text-ink/55">{folder.description}</p>}
          </div>
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
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            + New Category
          </button>
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon="folder-open"
          title="No categories yet"
          description="Categories group related cards inside this folder."
        >
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            + New Category
          </button>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {categories.map((category, i) => (
            <li
              key={category.id}
              draggable
              onDragStart={(e) => onDragStart(e, i)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={(e) => onDrop(e, i)}
              className={`group flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-card transition-colors ${
                dragIndex !== null && overIndex === i
                  ? "border-emerald-500"
                  : "border-ink/10"
              } ${dragIndex === i ? "opacity-50" : ""}`}
            >
              <span
                className="cursor-grab select-none text-ink/30"
                title="Drag to reorder"
                aria-hidden="true"
              >
                <Icon name="grip" size={16} />
              </span>

              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveCategory(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${category.name} up`}
                  className="px-1 text-ink/40 transition-colors hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevron-up" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => moveCategory(i, i + 1)}
                  disabled={i === categories.length - 1}
                  aria-label={`Move ${category.name} down`}
                  className="px-1 text-ink/40 transition-colors hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevron-down" size={16} />
                </button>
              </div>

              <Link to={`/flash/category/${category.id}`} className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-ink">{category.name}</h2>
                {category.description && (
                  <p className="mt-0.5 line-clamp-1 text-sm text-ink/55">{category.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <CountBadge value={category.card_count ?? 0} label="cards" />
                  <CountBadge value={category.due_count ?? 0} label="due" tone="due" />
                  {(category.struggling_count ?? 0) > 0 && (
                    <CountBadge
                      value={category.struggling_count}
                      label="struggling"
                      tone="struggling"
                    />
                  )}
                </div>
              </Link>

              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditing(category)}
                  title="Rename category"
                  aria-label={`Rename ${category.name}`}
                  className="icon-circle hover:bg-emerald-50 hover:text-emerald-700"
                >
                  <Icon name="pencil" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(category)}
                  title="Delete category"
                  aria-label={`Delete ${category.name}`}
                  className="icon-circle hover:bg-red-50 hover:text-red-700"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CategoryModal
        open={newOpen}
        folderId={folderId}
        onClose={() => setNewOpen(false)}
        onSaved={handleCreated}
      />

      <CategoryModal
        open={Boolean(editing)}
        category={editing}
        folderId={folderId}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />

      <ConfirmDeleteModal
        open={Boolean(confirmDelete)}
        title="Delete Category"
        finalLabel="Yes, delete everything"
        busy={deleteBusy}
        onConfirm={confirmDeleteCategory}
        onClose={() => setConfirmDelete(null)}
      >
        Delete <span className="font-semibold text-ink">“{confirmDelete?.name ?? ""}”</span> and
        all of its cards? This cannot be undone.
      </ConfirmDeleteModal>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
