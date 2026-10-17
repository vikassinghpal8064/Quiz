import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSkeleton from "../../../components/LoadingSkeleton";
import Toast from "../../../components/Toast";
import useToast from "../hooks/useToast";
import { getSettings, updateSettings } from "../lib/api";
import { DEFAULT_SETTINGS } from "../lib/scheduler/constants.js";
import { IMAGE_QUALITY_NAMES } from "../lib/imageProcessing/presets.js";
import { setCachedImageQuality } from "../lib/imageQuality.js";
import { applyTheme, THEMES } from "../lib/theme";
import FlashBreadcrumbs from "../components/FlashBreadcrumbs";
import { ErrorState } from "../components/FlashStates";
import BackupPanel from "../components/settings/BackupPanel";
import {
  NumberField,
  RangeField,
  SegmentedControl,
  SettingRow,
  ToggleSwitch,
  WeightSliders,
} from "../components/settings/fields";

// /flash/settings - scheduler, focus, struggle and experience preferences, all
// persisted to fc_settings through GET/PATCH /api/flash/settings.
//
// The screen holds a local draft and only PATCHes the keys that actually
// changed, so a save is a small, reversible write. Bounds come from the API's
// `schema`; the "Reset" action restores DEFAULT_SETTINGS (the same frozen
// object the scheduler reads).

const SCHEDULER_OPTIONS = [
  { value: "fsrs", label: "FSRS" },
  { value: "sm2", label: "SM-2" },
];

const THEME_OPTIONS = THEMES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }));

// The image pipeline's WebP quality presets (lib/imageProcessing). Names come
// from the same frozen list the API whitelist uses.
const IMAGE_QUALITY_OPTIONS = IMAGE_QUALITY_NAMES.map((name) => ({
  value: name,
  label: name[0].toUpperCase() + name.slice(1),
}));

const pct = (v) => `${Math.round(Number(v) * 100)}%`;

// Only the keys the form edits; extra settings the API returns are ignored.
const EDITABLE_FIELDS = [
  "scheduler",
  "desired_retention",
  "new_cards_per_day",
  "daily_goal",
  "focus_fraction",
  "focus_min",
  "focus_max",
  "struggle_slow_ratio",
  "struggle_weights",
  "auto_downgrade_shaky_correct",
  "audio_autoplay",
  "image_quality",
  "theme",
];

// Local mirror of the API bounds, used only if `schema` is missing (older API).
const FALLBACK_SCHEMA = {
  desired_retention: { min: 0.8, max: 0.97 },
  new_cards_per_day: { min: 0, max: 1000 },
  daily_goal: { min: 1, max: 9999 },
  focus_fraction: { min: 0.1, max: 0.5 },
  focus_min: { min: 1, max: 500 },
  focus_max: { min: 1, max: 500 },
  struggle_slow_ratio: { min: 1, max: 5 },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function defaults() {
  const out = {};
  for (const key of EDITABLE_FIELDS) out[key] = clone(DEFAULT_SETTINGS[key]);
  return out;
}

// The subset of `draft` that differs from `base`, compared structurally.
function diffSettings(draft, base) {
  const patch = {};
  for (const key of EDITABLE_FIELDS) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) patch[key] = draft[key];
  }
  return patch;
}

export default function SettingsPage() {
  const { toasts, notify, dismiss } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [base, setBase] = useState(null); // last saved settings
  const [schema, setSchema] = useState(FALLBACK_SCHEMA);
  const [draft, setDraft] = useState(defaults);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSettings();
      const next = {};
      for (const key of EDITABLE_FIELDS) next[key] = data.settings?.[key] ?? DEFAULT_SETTINGS[key];
      setBase(clone(next));
      setDraft(clone(next));
      if (data.schema) setSchema({ ...FALLBACK_SCHEMA, ...data.schema });
      // Keep the app's theme in sync with the account's saved preference.
      if (data.settings?.theme) applyTheme(data.settings.theme);
      // Seed the upload pipeline's cached quality so the next image upload uses
      // the saved preset without waiting on another round trip.
      setCachedImageQuality(data.settings?.image_quality);
    } catch (err) {
      setError(err.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useMemo(() => (base ? diffSettings(draft, base) : {}), [draft, base]);
  const dirty = Object.keys(patch).length > 0;

  const bound = useCallback((key) => schema[key] ?? FALLBACK_SCHEMA[key] ?? { min: 0, max: 100 }, [schema]);
  const set = useCallback((key, value) => setDraft((prev) => ({ ...prev, [key]: value })), []);

  const changeTheme = useCallback(
    (theme) => {
      set("theme", theme);
      applyTheme(theme);
    },
    [set]
  );

  const save = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (!dirty) {
        notify("No changes to save");
        return;
      }
      setSaving(true);
      try {
        const data = await updateSettings(patch);
        const next = {};
        for (const key of EDITABLE_FIELDS) next[key] = data.settings?.[key] ?? DEFAULT_SETTINGS[key];
        setBase(clone(next));
        setDraft(clone(next));
        if (data.settings?.theme) applyTheme(data.settings.theme);
        setCachedImageQuality(data.settings?.image_quality);
        notify("Settings saved");
      } catch (err) {
        notify(err.message || "Failed to save settings", "error");
      } finally {
        setSaving(false);
      }
    },
    [dirty, notify, patch]
  );

  const reset = useCallback(() => {
    setDraft(defaults());
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 settings-panel">
      <FlashBreadcrumbs items={[{ label: "Flash Cards", to: "/flash" }, { label: "Settings" }]} />

      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Flash settings
        </h1>
        <p className="mt-2 max-w-prose text-sm text-ink/55">
          Tune how the scheduler spaces your reviews and how the study screen behaves. Everything
          here is saved to your account.
        </p>
      </header>

      {loading && <LoadingSkeleton />}

      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && base && (
        <form onSubmit={save} className="space-y-6">
          {/* ---------- Scheduling ---------- */}
          <section className="answer-card divide-y divide-line p-6">
            <h2 className="label-caps mb-1">Scheduling</h2>

            <SettingRow
              title="Scheduler"
              hint="FSRS adapts intervals to how you actually remember. SM-2 is the classic Anki algorithm."
              control={
                <SegmentedControl
                  name="Scheduler"
                  value={draft.scheduler}
                  options={SCHEDULER_OPTIONS}
                  onChange={(v) => set("scheduler", v)}
                />
              }
            />

            <SettingRow
              title="Desired retention"
              hint="The recall probability to aim for. Higher keeps cards fresher but means more reviews."
              control={
                <RangeField
                  id="desired_retention"
                  ariaLabel="Desired retention"
                  value={draft.desired_retention}
                  min={bound("desired_retention").min}
                  max={bound("desired_retention").max}
                  step={0.01}
                  format={pct}
                  onChange={(v) => set("desired_retention", v)}
                />
              }
            />

            <SettingRow
              title="New cards per day"
              hint="How many brand-new cards may enter the rotation each day."
              control={
                <NumberField
                  id="new_cards_per_day"
                  ariaLabel="New cards per day"
                  value={draft.new_cards_per_day}
                  min={bound("new_cards_per_day").min}
                  max={bound("new_cards_per_day").max}
                  onChange={(v) => set("new_cards_per_day", v)}
                />
              }
            />

            <SettingRow
              title="Daily goal"
              hint="Reviews you aim to finish each day. Shown as progress on the flash home screen."
              control={
                <NumberField
                  id="daily_goal"
                  ariaLabel="Daily goal"
                  value={draft.daily_goal}
                  min={bound("daily_goal").min}
                  max={bound("daily_goal").max}
                  onChange={(v) => set("daily_goal", v)}
                />
              }
            />
          </section>

          {/* ---------- Focus sessions ---------- */}
          <section className="answer-card divide-y divide-line p-6">
            <h2 className="label-caps mb-1">Focus sessions</h2>

            <SettingRow
              title="Focus fraction"
              hint="A focus session pulls this share of the deck: enough to make progress without burning out."
              control={
                <RangeField
                  id="focus_fraction"
                  ariaLabel="Focus fraction"
                  value={draft.focus_fraction}
                  min={bound("focus_fraction").min}
                  max={bound("focus_fraction").max}
                  step={0.01}
                  format={pct}
                  onChange={(v) => set("focus_fraction", v)}
                />
              }
            />

            <SettingRow
              title="Minimum session size"
              hint="Never build a focus session smaller than this many cards."
              control={
                <NumberField
                  id="focus_min"
                  ariaLabel="Minimum session size"
                  value={draft.focus_min}
                  min={bound("focus_min").min}
                  max={bound("focus_min").max}
                  onChange={(v) => set("focus_min", v)}
                />
              }
            />

            <SettingRow
              title="Maximum session size"
              hint="Cap on how many cards a single sitting can queue."
              control={
                <NumberField
                  id="focus_max"
                  ariaLabel="Maximum session size"
                  value={draft.focus_max}
                  min={bound("focus_max").min}
                  max={bound("focus_max").max}
                  onChange={(v) => set("focus_max", v)}
                />
              }
            />
          </section>

          {/* ---------- Struggle detection ---------- */}
          <section className="answer-card divide-y divide-line p-6">
            <h2 className="label-caps mb-1">Struggle detection</h2>

            <SettingRow
              title="Slow-answer threshold"
              hint="An answer this many times slower than your normal is treated as 'shaky'."
              control={
                <RangeField
                  id="struggle_slow_ratio"
                  ariaLabel="Slow-answer threshold"
                  value={draft.struggle_slow_ratio}
                  min={bound("struggle_slow_ratio").min}
                  max={bound("struggle_slow_ratio").max}
                  step={0.05}
                  format={(v) => `${Number(v).toFixed(2)}×`}
                  onChange={(v) => set("struggle_slow_ratio", v)}
                />
              }
            />

            <SettingRow
              stacked
              title="Struggle weights"
              hint="How the struggle score blends slow answers, Again ratings, lapses and Hard ratings."
              control={<WeightSliders value={draft.struggle_weights} onChange={(v) => set("struggle_weights", v)} />}
            />

            <SettingRow
              title="Auto-downgrade shaky-correct"
              hint="Treat a slow-but-correct answer as Hard so the card returns sooner, instead of re-queuing it."
              control={
                <ToggleSwitch
                  id="auto_downgrade_shaky_correct"
                  label="Auto-downgrade shaky-correct"
                  checked={draft.auto_downgrade_shaky_correct}
                  onChange={(v) => set("auto_downgrade_shaky_correct", v)}
                />
              }
            />
          </section>

          {/* ---------- Media ---------- */}
          <section className="answer-card divide-y divide-line p-6">
            <h2 className="label-caps mb-1">Media</h2>

            <SettingRow
              title="Image quality"
              hint="How uploads are compressed. Every image becomes WebP: PDF pages are capped at 2400 px and camera photos at 2000 px, crops are kept pixel-for-pixel. Balanced (0.85) is smaller, High (0.92) is the default, Lossless keeps every pixel of small crops and handwriting."
              control={
                <SegmentedControl
                  name="Image quality"
                  value={draft.image_quality}
                  options={IMAGE_QUALITY_OPTIONS}
                  onChange={(v) => set("image_quality", v)}
                />
              }
            />
          </section>

          {/* ---------- Experience ---------- */}
          <section className="answer-card divide-y divide-line p-6">
            <h2 className="label-caps mb-1">Experience</h2>

            <SettingRow
              title="Audio autoplay"
              hint="Play a card's audio automatically once the answer is revealed."
              control={
                <ToggleSwitch
                  id="audio_autoplay"
                  label="Audio autoplay"
                  checked={draft.audio_autoplay}
                  onChange={(v) => set("audio_autoplay", v)}
                />
              }
            />

            <SettingRow
              title="Theme"
              hint="Light, dark, or follow your device setting."
              control={
                <SegmentedControl
                  name="Theme"
                  value={draft.theme}
                  options={THEME_OPTIONS}
                  onChange={changeTheme}
                />
              }
            />
          </section>

          {/* ---------- Backup ---------- */}
          <BackupPanel notify={notify} />

          {/* ---------- Save bar ---------- */}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-elevated/95 px-4 py-3 backdrop-blur">
            <span className="text-xs text-ink/55">
              {dirty ? "You have unsaved changes" : "All changes saved"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-line px-3 py-2 text-sm font-semibold text-ink/70 transition hover:text-ink"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={!dirty || saving}
                className="rounded-xl bg-lavender-deep px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
