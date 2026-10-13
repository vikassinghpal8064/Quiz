import { DIFFICULTIES } from "../lib/questionMeta";

// Active/inactive colouring is driven by the `.diff` classes + aria-pressed
// in the stylesheet, so the markup only has to say which level it is.
const STYLES = {
  easy: "diff diff-easy",
  medium: "diff diff-medium",
  hard: "diff diff-hard",
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
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${STYLES[level]}`}
          >
            {LABELS[level]}
          </button>
        );
      })}
    </div>
  );
}
