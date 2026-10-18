import { stateLabel, dueLabel, sideText } from "../lib/format";
import Icon from "../../../components/Icon";

// One compact card preview in the category list: select box, front / back
// text, tags, scheduling status, and the per-card actions.
export default function CardRow({ card, selected, onToggleSelect, onEdit, onMove, onDelete }) {
  const front = sideText(card.front);
  const back = sideText(card.back);
  const tags = card.tags ?? [];

  return (
    <div
      className={`virtual-row rounded-xl border bg-white p-3 shadow-card transition-colors ${
        selected ? "border-emerald-500" : "border-ink/10"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(card.id)}
          aria-label={`Select card ${card.id}`}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink/25 accent-emerald-600"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-ink line-clamp-2">
            {front || <span className="text-ink/40">Untitled card</span>}
          </p>
          {back && (
            <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-ink/55">{back}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                card.suspended
                  ? "bg-stone-100 text-ink/50"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {card.suspended ? "Suspended" : dueLabel(card.due)}
            </span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-ink/55">
              {stateLabel(card.state)}
            </span>
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => onMove(card)}
            title="Move card"
            aria-label={`Move card ${card.id}`}
            className="icon-circle hover:bg-ink/5"
          >
            <Icon name="arrow-left-right" size={16} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(card)}
            title="Edit card"
            aria-label={`Edit card ${card.id}`}
            className="icon-circle hover:bg-emerald-50 hover:text-emerald-700"
          >
            <Icon name="pencil" size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(card)}
            title="Delete card"
            aria-label={`Delete card ${card.id}`}
            className="icon-circle hover:bg-red-50 hover:text-red-700"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
