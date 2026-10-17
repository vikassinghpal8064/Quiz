import { useMemo } from "react";

// Reviews-per-day calendar, GitHub-contribution style.
//
// `weeks` is the column-major grid from statsModel.buildHeatmap: an array of
// columns, each an array of seven day cells (Sunday..Saturday). Cells after
// today are placeholders. A native title gives each day a tooltip without any
// JS state, so the whole chart stays cheap to render for a full year.

const LEVEL_CLASS = [
  "bg-white/5",
  "bg-lavender/25",
  "bg-lavender/45",
  "bg-lavender/70",
  "bg-lavender",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(cell) {
  if (cell.inFuture) return "";
  const count = cell.count;
  const noun = count === 1 ? "review" : "reviews";
  return `${count} ${noun} on ${cell.date}`;
}

export default function Heatmap({ weeks = [], max = 0, className = "" }) {
  // One month label per column where the month changes (and there is room).
  const monthLabels = useMemo(() => {
    const labels = [];
    let lastMonth = null;
    weeks.forEach((column, i) => {
      const first = column?.[0];
      if (!first) return;
      const month = Number(first.date.slice(5, 7));
      if (month !== lastMonth) {
        // Skip a label that would crowd the previous one.
        if (labels.length === 0 || i - labels[labels.length - 1].index >= 3) {
          labels.push({ index: i, label: MONTHS[month - 1] });
        }
        lastMonth = month;
      }
    });
    return labels;
  }, [weeks]);

  return (
    <div className={className}>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-[2px] text-[10px] leading-none text-ink/35">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="inline-block">
            <div className="mb-1 flex gap-[3px] text-[10px] leading-none text-ink/40">
              {weeks.map((_, i) => {
                const found = monthLabels.find((m) => m.index === i);
                return (
                  <span key={i} className="w-[12px] shrink-0">
                    {found ? found.label : ""}
                  </span>
                );
              })}
            </div>
            <div className="flex gap-[3px]">
              {weeks.map((column, ci) => (
                <div key={ci} className="flex flex-col gap-[3px]">
                  {column.map((cell) => (
                    <span
                      key={cell.date}
                      title={cell.inFuture ? undefined : dayLabel(cell)}
                      aria-hidden={cell.inFuture ? "true" : undefined}
                      className={`h-[12px] w-[12px] rounded-[3px] ${LEVEL_CLASS[cell.level] ?? LEVEL_CLASS[0]}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-ink/40">
        <span>Less</span>
        {LEVEL_CLASS.map((cls, i) => (
          <span key={i} className={`h-[12px] w-[12px] rounded-[3px] ${cls}`} />
        ))}
        <span>More</span>
      </div>
      {max > 0 && (
        <p className="mt-1 text-right text-[10px] text-ink/30">busiest day: {max} reviews</p>
      )}
    </div>
  );
}
