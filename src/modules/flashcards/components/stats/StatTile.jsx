// A single headline number with a muted label and an optional footnote. Shared
// by the stats page header and the home dashboard.

export default function StatTile({ label, value, hint, tone = "default", icon }) {
  const toneClass =
    tone === "good"
      ? "text-sage"
      : tone === "warn"
        ? "text-butter"
        : tone === "danger"
          ? "text-pink"
          : "text-ink";

  return (
    <div className="answer-card p-5">
      <div className="flex items-center justify-between">
        <p className="label-caps">{label}</p>
        {icon && (
          <span className="text-lg" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <p className={`stat-num mt-2 text-3xl ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink/45">{hint}</p>}
    </div>
  );
}
