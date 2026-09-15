import { Link } from "react-router-dom";
import { motion } from "framer-motion";

export default function CategoryCard({ category, onEdit, onDelete }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="group relative h-full">
        <Link
          to={`/category/${category.id}`}
          className="block h-full rounded-2xl border border-ink/10 bg-white p-6 shadow-card transition-all duration-200 hover:shadow-card-hover"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-stone-100 text-2xl">
            📁
          </div>
          <h2 className="text-lg font-semibold text-ink">{category.name}</h2>
          {category.description && (
            <p className="mt-1 line-clamp-2 text-sm text-ink/55">
              {category.description}
            </p>
          )}
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink/40">
            {category.question_count ?? 0}{" "}
            {(category.question_count ?? 0) === 1 ? "question" : "questions"}
          </p>
        </Link>

        <div className="pointer-events-none absolute right-3 top-3 flex gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onEdit?.(category)}
            title="Edit category"
            aria-label={`Edit ${category.name}`}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white text-sm shadow-sm transition-colors hover:bg-emerald-50 hover:text-emerald-700"
          >
            ✏️
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(category)}
            title="Delete category"
            aria-label={`Delete ${category.name}`}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white text-sm shadow-sm transition-colors hover:bg-red-50 hover:text-red-700"
          >
            🗑️
          </button>
        </div>
      </div>
    </motion.div>
  );
}