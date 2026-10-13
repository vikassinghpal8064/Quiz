import { DIFFICULTIES } from "../lib/questionMeta";

const STYLES = {
  easy: {
    on: "border-emerald-500 bg-emerald-50 text-emerald-800",
    off: "border-ink/10 bg-white text-ink/55 hover:border-emerald-300 hover:text-emerald-700",
  },
  medium: {
    on: "border-amber-500 bg-amber-50 text-amber-900",
    off: "border-ink/10 bg-white text-ink/55 hover:border-amber-300 hover:text-amber-700",
  },
  hard: {
    on: "border-red-500 bg-red-50 text-red-700",
    off: "border-ink/10 bg-white text-ink/55 hover:border-red-300 hover:text-red-600",
  },
};

const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

// Three small chips. Click a level to set it; click the selected one again to
// clear it. The parent owns the value and the optimistic/revert handling.
export default function DifficultyChips({ value, onSet, onClear, disabled = false, className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">
        Difficulty
      </span>
      {DIFFICULTIES.map((level) => {
        const selected = value === level;
        return (
          <button
            key={level}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              if (selected) onClear();
              else onSet(level);
            }}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              selected ? STYLES[level].on : STYLES[level].off
            }`}
          >
            {LABELS[level]}
          </button>
        );
      })}
    </div>
  );
}
