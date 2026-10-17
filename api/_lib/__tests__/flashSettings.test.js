import { describe, it, expect } from "vitest";
import {
  EDITABLE_SETTINGS,
  SETTINGS_SCHEMA,
  SETTINGS_SPEC,
  UPSERT_SETTING_SQL,
  parseSettingValue,
  parseSettingsPatch,
  upsertSettingArgs,
} from "../flashSettings.js";

// The settings endpoint writes a whitelisted, typed set of keys; these cover the
// validation without a database.

describe("parseSettingsPatch", () => {
  it("accepts integer keys", () => {
    expect(parseSettingsPatch({ daily_goal: 25 })).toEqual({ value: [{ key: "daily_goal", value: 25 }] });
    expect(parseSettingsPatch({ daily_goal: "40", new_cards_per_day: 10 })).toEqual({
      value: [
        { key: "new_cards_per_day", value: 10 },
        { key: "daily_goal", value: 40 },
      ],
    });
  });

  it("accepts float, bool, enum and weights keys", () => {
    const parsed = parseSettingsPatch({
      desired_retention: 0.9,
      focus_fraction: 0.3,
      scheduler: "sm2",
      auto_downgrade_shaky_correct: true,
      audio_autoplay: false,
      theme: "dark",
      struggle_weights: { time: 0.5, again: 0.5 },
    });
    expect(parsed.error).toBeUndefined();
    const byKey = Object.fromEntries(parsed.value.map((u) => [u.key, u.value]));
    expect(byKey.desired_retention).toBe(0.9);
    expect(byKey.focus_fraction).toBe(0.3);
    expect(byKey.scheduler).toBe("sm2");
    expect(byKey.auto_downgrade_shaky_correct).toBe(true);
    expect(byKey.audio_autoplay).toBe(false);
    expect(byKey.theme).toBe("dark");
    expect(byKey.struggle_weights).toEqual({ time: 0.5, again: 0.5 });
  });

  it("accepts a bool sent as the string 'true'/'false'", () => {
    expect(parseSettingValue("audio_autoplay", "false")).toEqual({ value: false });
    expect(parseSettingValue("audio_autoplay", "true")).toEqual({ value: true });
  });

  it("ignores unknown keys but still applies the known ones", () => {
    expect(parseSettingsPatch({ not_a_setting: 1, daily_goal: 50 }).value).toEqual([
      { key: "daily_goal", value: 50 },
    ]);
  });

  it("rejects a body with nothing editable", () => {
    expect(parseSettingsPatch({}).error).toMatch(/at least one/);
    expect(parseSettingsPatch({ not_a_setting: 1 }).error).toMatch(/at least one/);
    expect(parseSettingsPatch(null).error).toBeTruthy();
  });

  it("rejects out-of-range and non-integer values", () => {
    expect(parseSettingsPatch({ daily_goal: 0 }).error).toMatch(/daily_goal/);
    expect(parseSettingsPatch({ daily_goal: 5000 }).error).toMatch(/daily_goal/);
    expect(parseSettingsPatch({ daily_goal: 1.5 }).error).toMatch(/daily_goal/);
    expect(parseSettingsPatch({ desired_retention: 0.5 }).error).toMatch(/desired_retention/);
    expect(parseSettingsPatch({ desired_retention: 1 }).error).toMatch(/desired_retention/);
    // new_cards_per_day is allowed to be 0.
    expect(parseSettingsPatch({ new_cards_per_day: 0 }).value).toEqual([
      { key: "new_cards_per_day", value: 0 },
    ]);
  });

  it("rejects enum values that are not in the allow-list", () => {
    expect(parseSettingsPatch({ scheduler: "anki" }).error).toMatch(/scheduler/);
    expect(parseSettingsPatch({ theme: "neon" }).error).toMatch(/theme/);
    expect(parseSettingsPatch({ image_quality: "ultra" }).error).toMatch(/image_quality/);
  });

  it("accepts the image_quality presets from the pipeline", () => {
    expect(parseSettingsPatch({ image_quality: "balanced" })).toEqual({
      value: [{ key: "image_quality", value: "balanced" }],
    });
    expect(parseSettingsPatch({ image_quality: "high" }).error).toBeUndefined();
    expect(parseSettingsPatch({ image_quality: "lossless" }).error).toBeUndefined();
  });

  it("validates struggle_weights", () => {
    expect(parseSettingValue("struggle_weights", "nope").error).toMatch(/struggle_weights/);
    expect(parseSettingValue("struggle_weights", []).error).toMatch(/struggle_weights/);
    expect(parseSettingValue("struggle_weights", {}).error).toMatch(/struggle_weights/);
    expect(parseSettingValue("struggle_weights", { time: 4 }).error).toMatch(/time/);
    expect(parseSettingValue("struggle_weights", { time: -1 }).error).toMatch(/time/);
  });

  it("treats an empty string as 'leave unchanged'", () => {
    expect(parseSettingsPatch({ daily_goal: "" }).error).toBeTruthy();
  });
});

describe("settings spec + upsert", () => {
  it("exposes exactly the editable keys", () => {
    expect(EDITABLE_SETTINGS).toContain("daily_goal");
    expect(EDITABLE_SETTINGS).toContain("new_cards_per_day");
    expect(EDITABLE_SETTINGS).toContain("desired_retention");
    expect(EDITABLE_SETTINGS).toContain("scheduler");
    expect(Object.keys(SETTINGS_SPEC).sort()).toEqual([...EDITABLE_SETTINGS].sort());
  });

  it("publishes a schema the UI can drive its controls from", () => {
    expect(SETTINGS_SCHEMA.desired_retention).toMatchObject({ type: "number", min: 0.8, max: 0.97 });
    expect(SETTINGS_SCHEMA.focus_fraction).toMatchObject({ type: "number", min: 0.1, max: 0.5 });
    expect(SETTINGS_SCHEMA.scheduler.values).toEqual(["fsrs", "sm2"]);
    expect(SETTINGS_SCHEMA.image_quality.values).toEqual(["balanced", "high", "lossless"]);
    expect(SETTINGS_SCHEMA.struggle_weights.type).toBe("weights");
  });

  it("stringifies the value for the jsonb cast and targets the key", () => {
    expect(UPSERT_SETTING_SQL).toContain("ON CONFLICT (user_id, key)");
    expect(upsertSettingArgs("7", { key: "daily_goal", value: 25 })).toEqual(["7", "daily_goal", "25"]);
    expect(upsertSettingArgs("7", { key: "struggle_weights", value: { time: 1 } })).toEqual([
      "7",
      "struggle_weights",
      '{"time":1}',
    ]);
  });
});
