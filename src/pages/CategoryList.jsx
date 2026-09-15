import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import LoadingSkeleton from "../components/LoadingSkeleton";
import CategoryCard from "../components/CategoryCard";
import AddCategoryModal from "../components/AddCategoryModal";
import EmptyState from "../components/EmptyState";

export default function CategoryList() {
  const { subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [subjectRes, categoriesRes] = await Promise.all([
          fetch(`/api/subjects/${subjectId}`),
          fetch(`/api/categories?subjectId=${subjectId}`),
        ]);

        if (!subjectRes.ok) throw new Error("Subject not found");
        if (!categoriesRes.ok) throw new Error("Failed to load categories");

        const [subjectData, categoriesData] = await Promise.all([
          subjectRes.json(),
          categoriesRes.json(),
        ]);

        if (cancelled) return;
        setSubject(subjectData);
        setCategories(categoriesData);
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
  }, [subjectId]);

  function handleCreated(created) {
    setCategories((prev) => [
      { ...created, question_count: 0 },
      ...prev,
    ]);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition-colors hover:text-ink"
      >
        ← Back to Dashboard
      </Link>

      <div className="mb-10 text-center sm:text-left">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          {loading && !subject ? "Loading..." : subject?.name}
        </h1>
        {subject?.description && (
          <p className="mt-2 text-ink/55">{subject.description}</p>
        )}
        {!loading && !error && (
          <p className="mt-1 text-sm text-ink/40">
            {categories.length}{" "}
            {categories.length === 1 ? "category" : "categories"}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : categories.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="No categories yet"
          description="Add your first category to this subject to start adding questions."
        >
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Add Category
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}

          <motion.button
            whileHover={{ y: -6 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            onClick={() => setModalOpen(true)}
            className="flex h-44 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink/20 bg-white/40 text-ink/45 transition-colors hover:border-emerald-500 hover:text-emerald-600"
          >
            <span className="text-3xl">＋</span>
            <span className="mt-2 text-sm font-medium">Add Category</span>
          </motion.button>
        </div>
      )}

      <AddCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
        subjectId={subjectId}
      />
    </div>
  );
}