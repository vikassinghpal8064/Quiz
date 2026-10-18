// Small, dumb form controls for the flash settings screen. Every control is
// controlled (value + onChange) and styled from the app's CSS variables so the
// page stays consistent with the rest of the design system. No state lives here.

import Icon from "../../../../components/Icon";

// One labelled row: title + hint on the left, the control on the right (stacked
// on narrow screens or when `stacked` is set).
export function SettingRow({ title, hint, control, stacked = false }) {
  return (
    <div
      className={`flex gap-4 py-5 ${stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {hint && <p className="mt-1 text-xs leading-relaxed text-ink/55">{hint}</p>}
      </div>
      <div className={stacked ? "w-full" : "w-full shrink-0 sm:w-64"}>{control}</div>
    </div>
  );
}

// Radio-style pill group. Used for scheduler + theme.
export function SegmentedControl({ value, options, onChange, name }) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex w-full rounded-xl border border-line bg-elevated p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              active ? "bg-lavender-deep text-white" : "text-ink/60 hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Number input with optional suffix and +/- steppers that respect the bounds.
export function NumberField({ value, min, max, step = 1, suffix, onChange, id, ariaLabel }) {
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const set = (n) => {
    if (n === "" || n === null) return;
    const num = Number(n);
    if (!Number.isFinite(num)) return;
    onChange(clamp(num));
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(clamp(Number(value) - step))}
        disabled={Number(value) <= min}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-lg font-semibold text-ink/80 transition hover:text-ink disabled:opacity-30"
      >
        <Icon name="minus" size={18} />
      </button>
      <div className="relative flex-1">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          aria-label={ariaLabel}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => set(e.target.value)}
          onBlur={(e) => set(e.target.value === "" ? min : e.target.value)}
          className="field h-10 w-full px-3 text-center text-sm font-semibold tabular-nums"
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink/45">
            {suffix}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(clamp(Number(value) + step))}
        disabled={Number(value) >= max}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-lg font-semibold text-ink/80 transition hover:text-ink disabled:opacity-30"
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

// Range slider with a live readout. `format` turns the numeric value into the
// label shown on the right.
export function RangeField({ value, min, max, step, onChange, format = (v) => String(v), id, ariaLabel }) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        aria-label={ariaLabel}
        className="range flex-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{format(value)}</span>
    </div>
  );
}

// Accessible switch.
export function ToggleSwitch({ checked, onChange, id, label }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
        checked ? "border-lavender-deep bg-lavender-deep" : "border-line bg-elevated"
      }`}
    >
      <span
        className={`ml-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// The four struggle-score weights. Each is 0..1; a "Normalise" button rescales
// them so they sum to 1 (which is how the score is read).
export const WEIGHT_LABELS = Object.freeze([
  { key: "time", label: "Time", hint: "How much a slow answer counts" },
  { key: "again", label: "Again", hint: "Weight of recent Again ratings" },
  { key: "lapse", label: "Lapses", hint: "Weight of repeated forgetting" },
  { key: "hard", label: "Hard", hint: "Weight of recent Hard ratings" },
]);

export function WeightSliders({ value, onChange }) {
  const total = WEIGHT_LABELS.reduce((sum, w) => sum + (Number(value?.[w.key]) || 0), 0);

  const normalise = () => {
    if (total <= 0) return;
    const next = {};
    for (const w of WEIGHT_LABELS) next[w.key] = Math.round(((Number(value?.[w.key]) || 0) / total) * 100) / 100;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {WEIGHT_LABELS.map((w) => (
        <div key={w.key} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-semibold text-ink/70">{w.label}</span>
          <input
            type="range"
            className="range flex-1"
            min={0}
            max={1}
            step={0.05}
            value={Number(value?.[w.key]) || 0}
            onChange={(e) => onChange({ ...value, [w.key]: Number(e.target.value) })}
            aria-label={w.label}
          />
          <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-ink/70">
            {Math.round((Number(value?.[w.key]) || 0) * 100)}%
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <span className={`text-xs ${Math.abs(total - 1) < 0.001 ? "text-ink/45" : "text-butter"}`}>
          Total: {Math.round(total * 100)}%
        </span>
        <button
          type="button"
          onClick={normalise}
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink/70 transition hover:text-ink"
        >
          Normalise to 100%
        </button>
      </div>
    </div>
  );
}
