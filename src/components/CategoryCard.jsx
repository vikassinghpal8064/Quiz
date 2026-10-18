import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Icon from "./Icon";

export default function CategoryCard({ category, onEdit, onDelete }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="group relative h-full">
        <Link
          to={`/category/${category.id}`}
          className="accent-card block h-full rounded-xl border p-4 transition-all duration-200"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 text-ink/60">
            <Icon name="folder" size={20} />
          </div>
          <h2 className="text-base font-semibold text-ink line-clamp-2">{category.name}</h2>
          {category.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-ink/55">
              {category.description}
            </p>
          )}
          <p className="mt-3 text-sm font-semibold text-ink">
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
                className="icon-circle pointer-events-auto hover:bg-emerald-50 hover:text-emerald-700"
              >
                <Icon name="pencil" size={16} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(category)}
                title="Delete category"
                aria-label={`Delete ${category.name}`}
                className="icon-circle pointer-events-auto hover:bg-red-50 hover:text-red-700"
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}