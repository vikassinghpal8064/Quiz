import { Link } from "react-router-dom";
import { motion } from "framer-motion";

const iconFor = {
  physics: "⚡",
  chemistry: "🧪",
  math: "📐",
  biology: "🧬",
  default: "📚",
};

function getIcon(iconName) {
  if (!iconName) return iconFor.default;
  return iconFor[iconName.toLowerCase()] ?? iconFor.default;
}

export default function SubjectCard({ subject }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <Link
        to={`/subject/${subject.id}`}
        className="block h-full rounded-2xl border border-ink/10 bg-white p-6 shadow-card transition-all duration-200 hover:shadow-card-hover"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-2xl">
          {getIcon(subject.icon_name)}
        </div>
        <h2 className="text-lg font-semibold text-ink">{subject.name}</h2>
        {subject.description && (
          <p className="mt-1 line-clamp-2 text-sm text-ink/55">
            {subject.description}
          </p>
        )}
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink/40">
          {subject.category_count ?? 0}{" "}
          {(subject.category_count ?? 0) === 1 ? "category" : "categories"}
        </p>
      </Link>
    </motion.div>
  );
}