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
          className="accent-card block h-full rounded-2xl border p-5 transition-all duration-200"
        >
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 text-xl">
            📁
          </div>
          <h2 className="text-lg font-semibold text-ink">{category.name}</h2>
          {category.description && (
            <p className="mt-1 line-clamp-2 text-sm text-ink/55">
              {category.description}
            </p>
          )}
          <p className="stat-num mt-4 text-3xl">
            {category.question_count ?? 0}{" "}
            {(category.question_count ?? 0) === 1 ? "question" : "questions"}
          </p>
        </Link>

        {/* Only rendered when the parent supplies handlers, i.e. for
            admins. Regular users must not see these at all. */}
        {(onEdit || onDelete) && (
          <div className="card-actions pointer-events-none absolute right-3 top-3 flex gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(category)}
                title="Edit category"
                aria-label={`Edit ${category.name}`}
                className="icon-circle pointer-events-auto text-sm hover:bg-emerald-50 hover:text-emerald-700"
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(category)}
                title="Delete category"
                aria-label={`Delete ${category.name}`}
                className="icon-circle pointer-events-auto text-sm hover:bg-red-50 hover:text-red-700"
              >
                🗑️
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}