import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { sendMissingFlashTable } from "../../_lib/flashCards.js";
import { removeStoredObjects } from "../../_lib/flashMedia.js";
import { isSafeStoragePath } from "../../../src/modules/flashcards/lib/storage/paths.js";

// POST /api/flash/media/remove   { paths: ["flash/2026/<uuid>.webp", ...] }
//
// Deletes objects the caller no longer needs - the client calls this when it
// replaces a file it uploaded in the current (unsaved) editing session, so the
// superseded object never lingers in the bucket. Card / category / folder
// deletion and saved-card replacement do NOT go through here; those handlers
// delete by storage_path server-side (see api/_lib/flashMedia.js
// deleteUnreferencedMedia).
//
// Safety: only paths under flash/ are accepted, and a path is refused if ANY
// fc_media row still references it - including this caller's own. That means a
// file already saved to a card can never be deleted from here (the save-time
// reconciliation owns those), while a superseded, never-saved upload (no row)
// is removed.
const MAX_REMOVE_PATHS = 100;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const raw = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const list = [...new Set(raw.filter(isSafeStoragePath))].slice(0, MAX_REMOVE_PATHS);
    if (!list.length) return res.status(200).json({ removed: [] });

    // Refuse anything a saved card (anyone's) still points at; delete the rest.
    const referenced = await sql`
      SELECT DISTINCT storage_path FROM fc_media
      WHERE storage_path = ANY(${list})
    `;
    const blocked = new Set(referenced.map((row) => row.storage_path));
    const removable = list.filter((path) => !blocked.has(path));

    const result = await removeStoredObjects(removable);
    return res.status(200).json(result);
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/media/remove", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
