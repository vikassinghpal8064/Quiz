import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import LoadingSkeleton from "../components/LoadingSkeleton";
import SubjectCard from "../components/SubjectCard";
import AddSubjectModal from "../components/AddSubjectModal";
import EditSubjectModal from "../components/EditSubjectModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import EmptyState from "../components/EmptyState";
import BackButton from "../components/BackButton";

export default function Dashboard() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editSubject, setEditSubject] = useState(null);
  const [deleteSubject, setDeleteSubject] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/subjects");
        if (!res.ok) throw new Error("Failed to load subjects");
        const data = await res.json();
        if (!cancelled) setSubjects(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCreated(created) {
    setSubjects((prev) => [created, ...prev]);
  }

  function handleEdited(updated) {
    setSubjects((prev) =>
      prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
    );
    setEditSubject(null);
  }

  async function handleConfirmDelete() {
    if (!deleteSubject) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/subjects/${deleteSubject.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete subject");
      }
      setSubjects((prev) => prev.filter((s) => s.id !== deleteSubject.id));
      setDeleteSubject(null);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <BackButton />
      <div className="mb-10 text-center sm:text-left">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          Dashboard
        </h1>
        <p className="mt-2 text-ink/55">
          Pick a subject to browse its categories and start a quiz.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : subjects.length === 0 ? (
        <EmptyState
          icon="📚"
          title="No subjects yet"
          description="Create your first subject to start adding categories and questions."
        >
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Add Subject
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              onEdit={setEditSubject}
              onDelete={setDeleteSubject}
            />
          ))}

          <motion.button
            whileHover={{ y: -6 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            onClick={() => setModalOpen(true)}
            className="flex h-44 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink/20 bg-white/40 text-ink/45 transition-colors hover:border-emerald-500 hover:text-emerald-600"
          >
            <span className="text-3xl">＋</span>
            <span className="mt-2 text-sm font-medium">Add Subject</span>
          </motion.button>
        </div>
      )}

      <AddSubjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
      <EditSubjectModal
        subject={editSubject}
        onClose={() => setEditSubject(null)}
        onSaved={handleEdited}
      />
      <ConfirmDeleteModal
        open={deleteSubject !== null}
        title="Delete Subject"
        onClose={() => setDeleteSubject(null)}
        onConfirm={handleConfirmDelete}
        busy={deleting}
        error={deleteError}
      >
        <p>
          You are about to permanently delete{" "}
          <span className="font-semibold text-ink">{deleteSubject?.name}</span>{" "}
          including everything inside it.
        </p>
        <ul className="mt-3 space-y-1 rounded-xl bg-red-50 p-3 text-red-800">
          <li>
            <span className="font-semibold">
              {deleteSubject?.category_count ?? 0}
            </span>{" "}
            categor{deleteSubject?.category_count === 1 ? "y" : "ies"}
          </li>
          <li>
            <span className="font-semibold">
              {deleteSubject?.question_count ?? 0}
            </span>{" "}
            question{deleteSubject?.question_count === 1 ? "" : "s"}
          </li>
        </ul>
        <p className="mt-3">
          All quiz attempts, answer history, and starred questions tied to this
          subject will be deleted too. This cannot be undone.
        </p>
      </ConfirmDeleteModal>
    </div>
  );
}