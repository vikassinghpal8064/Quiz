// Per-folder / per-category filter bar for the stats screen, plus the retention
// and think-time range pills.

const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
];

export default function StatsFilters({
  folders = [],
  categories = [],
  folderId,
  categoryId,
  days,
  disabled = false,
  onFolder,
  onCategory,
  onDays,
}) {
  const selectClass =
    "rounded-xl border border-ink/15 bg-elevated px-3 py-2 text-sm text-ink outline-none transition focus:border-lavender disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex items-center gap-2 text-sm">
        <span className="label-caps">Folder</span>
        <select
          className={selectClass}
          value={folderId ?? ""}
          disabled={disabled}
          onChange={(e) => onFolder?.(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="label-caps">Category</span>
        <select
          className={selectClass}
          value={categoryId ?? ""}
          disabled={disabled || folderId == null}
          onChange={(e) => onCategory?.(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">{folderId == null ? "Pick a folder first" : "All categories"}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1.5 sm:ml-auto">
        <span className="label-caps mr-1">Range</span>
        {RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            className="filter-pill px-3 py-1.5 text-xs font-semibold"
            aria-pressed={days === range.days}
            disabled={disabled}
            onClick={() => onDays?.(range.days)}
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
