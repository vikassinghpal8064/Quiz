import { Link } from "react-router-dom";
import { motion } from "framer-motion";

export default function CategoryCard({ category }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
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
    </motion.div>
  );
}