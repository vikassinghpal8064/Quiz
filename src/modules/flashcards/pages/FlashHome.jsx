import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import LoadingSkeleton from "../../../components/LoadingSkeleton";
import Icon from "../../../components/Icon";
import EmptyState from "../../../components/EmptyState";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import useStartSession from "../hooks/useStartSession";
import { listFolders, getStatsOverview } from "../lib/api";
import { accentClass, folderIcon } from "../lib/format";
import NewFolderModal from "../components/NewFolderModal";
import { ErrorState } from "../components/FlashStates";
import DailyGoalRing from "../components/stats/DailyGoalRing";

// /flash - the daily-goal dashboard, then every folder as a coloured card with
// its deck size, how many cards are due today, and a per-folder focus-session
// shortcut.
export default function FlashHome() {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const { toasts, notify, dismiss } = useToast();
  const startStudySession = useStartSession(notify);
  const [focusBusyId, setFocusBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    setOverviewLoading(true);
    // The daily-goal panel is a nice-to-have: if its endpoint fails, the folder
    // grid still loads rather than the whole screen erroring.
    const [folderRows, stats] = await Promise.all([
      listFolders().catch((err) => {
        setError(err.message);
        return null;
      }),
      getStatsOverview().catch(() => null),
    ]);
    if (folderRows) setFolders(folderRows);
    setOverview(stats);
    setOverviewLoading(false);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function handleCreated(folder) {
    setFolders((prev) => [...prev, folder]);
    notify(`Created “${folder.name}”.`);
  }

  async function startFocus(folder) {
    if (focusBusyId) return;
    setFocusBusyId(folder.id);
    try {
      await startStudySession({ scope_type: "folder", scope_id: folder.id, mode: "focus" });
    } finally {
      setFocusBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
            Flash Cards
          </h1>
          <p className="mt-2 text-ink/55">
            Organise cards into folders, then study a folder or a single category.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewFolderOpen(true)}
          className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          + New Folder
        </button>
      </div>

      <div className="mb-8">
        <DailyGoalRing overview={overview} loading={overviewLoading} />
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : folders.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No folders yet"
          description="Create a folder to start collecting flash cards."
        >
          <button
            type="button"
            onClick={() => setNewFolderOpen(true)}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            + New Folder
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder, i) => (
            <motion.div
              key={folder.id}
              whileHover={{ y: -6 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
            >
              <div className="group relative h-full">
                <div
                  className={`accent-card flex h-full flex-col rounded-2xl border p-6 transition-all duration-200 ${accentClass(
                    folder.color,
                    i
                  )}`}
                >
                  <Link to={`/flash/folder/${folder.id}`} className="flex flex-1 flex-col">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
                      {folderIcon(folder.icon)}
                    </div>
                    <h2 className="text-lg font-semibold">{folder.name}</h2>
                    {folder.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink/55">
                        {folder.description}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="card-chip">
                        {folder.card_count ?? 0}{" "}
                        {(folder.card_count ?? 0) === 1 ? "card" : "cards"}
                      </span>
                      <span className="card-chip">
                        {folder.due_count ?? 0} due today
                      </span>
                    </div>
                  </Link>

                  <button
                    type="button"
                    onClick={() => startFocus(folder)}
                    disabled={focusBusyId === folder.id}
                    className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-black/10 px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/20 disabled:opacity-60"
                  >
                    <Icon name="play" size={16} />
                    Start Focus Session
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <NewFolderModal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreated={handleCreated}
      />

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
