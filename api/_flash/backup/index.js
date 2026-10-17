import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { flashUserId, sendMissingFlashTable } from "../../_lib/flashCards.js";

// GET /api/flash/backup
//
// A complete, portable snapshot of the caller's flash data: folders, their
// categories (with parent links so nesting survives), every card, and the media
// rows attached to those cards. Card front/back already embed the media URLs, so
// the `media` array is a convenience index rather than the source of truth.
//
// The shape is deliberately flat and name-friendly so it can be restored by the
// client through the ordinary folders / categories / cards endpoints, and so a
// human can read it. Reads only - nothing here writes or deletes.
export const BACKUP_VERSION = 1;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const [folders, categories, cards, media] = await Promise.all([
      sql`
        SELECT id, name, description, color, icon, sort_order
        FROM fc_folders
        WHERE user_id = ${uid}
        ORDER BY sort_order ASC, id ASC
      `,
      sql`
        SELECT id, folder_id, parent_id, name, description, sort_order
        FROM fc_categories
        WHERE user_id = ${uid}
        ORDER BY folder_id ASC, sort_order ASC, id ASC
      `,
      sql`
        SELECT id, category_id, card_type, front, back, tags, source, source_ref, suspended
        FROM fc_cards
        WHERE user_id = ${uid}
        ORDER BY category_id ASC, id ASC
      `,
      sql`
        SELECT card_id, side, kind, url, mime, bytes
        FROM fc_media
        WHERE user_id = ${uid}
        ORDER BY id ASC
      `,
    ]);

    return res.status(200).json({
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      folders,
      categories,
      cards,
      media,
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET /api/flash/backup", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
