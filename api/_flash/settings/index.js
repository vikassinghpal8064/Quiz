import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { flashUserId, sendMissingFlashTable } from "../../_lib/flashCards.js";
import { settingsFromRows } from "../../_lib/flashStudy.js";
import {
  EDITABLE_SETTINGS,
  SETTINGS_SCHEMA,
  UPSERT_SETTING_SQL,
  parseSettingsPatch,
  upsertSettingArgs,
} from "../../_lib/flashSettings.js";

// GET   /api/flash/settings - the caller's flash settings (defaults filled in)
// PATCH /api/flash/settings - update the editable subset
//
// Only the keys in api/_lib/flashSettings.js can be written. Values are stored
// in fc_settings, so they are per-account and survive a reload. The response
// also carries `schema` (each key's type + bounds) so the UI can build its
// controls without hardcoding ranges.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  try {
    if (req.method === "GET") {
      const rows = await sql`SELECT key, value FROM fc_settings WHERE user_id = ${uid}`;
      return res.status(200).json({
        settings: settingsFromRows(rows),
        editable: EDITABLE_SETTINGS,
        schema: SETTINGS_SCHEMA,
      });
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const parsed = parseSettingsPatch(req.body ?? {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      await sql.transaction((txn) =>
        parsed.value.map((update) => txn.query(UPSERT_SETTING_SQL, upsertSettingArgs(uid, update)))
      );

      const rows = await sql`SELECT key, value FROM fc_settings WHERE user_id = ${uid}`;
      return res.status(200).json({
        settings: settingsFromRows(rows),
        editable: EDITABLE_SETTINGS,
        schema: SETTINGS_SCHEMA,
        updated: parsed.value.map((update) => update.key),
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/PATCH /api/flash/settings", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
