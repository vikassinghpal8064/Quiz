import { formatDuration, isStruggling, sideText } from "../../lib/format";
import EmptyState from "../../../../components/EmptyState";
import Icon from "../../../../components/Icon";

// The Hardest Cards table: the scheduler's struggle score, lapse count and
// average think time for the cards fighting the hardest, with a button that
// starts a "struggle" session scoped to the same filter so the user can work
// straight through the list.

function StruggleBar({ score }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div
          className={`h-full rounded-full ${isStruggling(score) ? "bg-pink" : "bg-butter"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-ink/60">{pct}%</span>
    </div>
  );
}

export default function HardestCardsTable({ cards = [], onStudyNow, busy = false }) {
  if (cards.length === 0) {
    return (
      <EmptyState
        icon="target"
        title="No struggle data yet"
        description="Cards that take long, lapse or keep coming back will be listed here."
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={onStudyNow}
          disabled={busy}
          className="rounded-xl bg-lavender px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-60"
        >
          {busy ? "Starting…" : "Study these now"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="label-caps px-2 py-2 font-semibold">Card</th>
              <th className="label-caps hidden px-2 py-2 font-semibold sm:table-cell">Category</th>
              <th className="label-caps px-2 py-2 font-semibold">Struggle</th>
              <th className="label-caps px-2 py-2 text-right font-semibold">Lapses</th>
              <th className="label-caps px-2 py-2 text-right font-semibold">Avg think</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const front = sideText(card.front);
              return (
                <tr key={card.id} className="border-t border-ink/8">
                  <td className="max-w-[22rem] px-2 py-2.5">
                    <span className="line-clamp-2 text-ink/85">
                      {front || (
                        <span className="inline-flex items-center gap-1 text-ink/50">
                          <Icon name="image" size={14} /> Media card
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="hidden px-2 py-2.5 text-ink/55 sm:table-cell">
                    {card.category_name ?? "—"}
                  </td>
                  <td className="px-2 py-2.5">
                    <StruggleBar score={card.struggle_score} />
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-ink/75">{card.lapses ?? 0}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-ink/75">
                    {card.avg_think_ms ? formatDuration(card.avg_think_ms) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
