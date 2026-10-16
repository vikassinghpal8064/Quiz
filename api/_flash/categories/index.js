import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  optionalString,
  parsePositiveInt,
  requiredString,
  sendMissingFlashTable,
  STRUGGLE_THRESHOLD,
} from "../../_lib/flashCards.js";

// GET  /api/flash/categories?folderId= - list a folder's categories with card counts
// POST /api/flash/categories           - create a category inside a folder
//
// Scoped to the caller. A category may nest under a parent category (parent_id)
// but must stay inside the same folder.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  try {
    if (req.method === "GET") {
      const folderId = parsePositiveInt(req.query?.folderId, "folderId");
      if (folderId.error) return res.status(400).json({ error: folderId.error });

      // card_count is the whole deck; due_count is "reviewable today" (not
      // suspended, due before the end of today - overdue included); and
      // struggling_count flags cards whose scheduler struggle_score has crossed
      // STRUGGLE_THRESHOLD. fc_card_state is 1:1 with fc_cards, so the extra
      // join never multiplies the counts.
      const rows = await sql`
        SELECT c.*, count(card.id)::int AS card_count,
          count(card.id) FILTER (
            WHERE st.due IS NOT NULL
              AND st.due < date_trunc('day', now()) + interval '1 day'
              AND card.suspended = false
          )::int AS due_count,
          count(card.id) FILTER (
            WHERE st.struggle_score >= ${STRUGGLE_THRESHOLD}
              AND card.suspended = false
          )::int AS struggling_count
        FROM fc_categories c
        LEFT JOIN fc_cards      card ON card.category_id = c.id
        LEFT JOIN fc_card_state st   ON st.card_id = card.id
        WHERE c.folder_id = ${folderId.value} AND c.user_id = ${uid}
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.created_at DESC
      `;
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};

      const folderId = parsePositiveInt(body.folder_id, "folder_id");
      if (folderId.error) return res.status(400).json({ error: folderId.error });

      const name = requiredString(body.name, "name", 200);
      if (name.error) return res.status(400).json({ error: name.error });

      const description = optionalString(body.description, "description", 2000);
      if (description.error) return res.status(400).json({ error: description.error });

      const sortOrder = optionalInt(body.sort_order, "sort_order", { min: 0, max: 1_000_000 });
      if (sortOrder.error) return res.status(400).json({ error: sortOrder.error });

      // The folder must exist and belong to the caller, otherwise the FK would
      // fail (or attach the category to someone else's folder).
      const folder = await sql`
        SELECT id FROM fc_folders WHERE id = ${folderId.value} AND user_id = ${uid}
      `;
      if (!folder.length) {
        return res.status(404).json({ error: "folder not found" });
      }

      let parentId = null;
      if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== "") {
        const parent = parsePositiveInt(body.parent_id, "parent_id");
        if (parent.error) return res.status(400).json({ error: parent.error });

        const parentRow = await sql`
          SELECT id FROM fc_categories
          WHERE id = ${parent.value} AND user_id = ${uid} AND folder_id = ${folderId.value}
        `;
        if (!parentRow.length) {
          return res.status(400).json({ error: "parent_id must be a category in the same folder" });
        }
        parentId = parent.value;
      }

      const rows = await sql`
        INSERT INTO fc_categories (user_id, folder_id, parent_id, name, description, sort_order)
        VALUES (
          ${uid},
          ${folderId.value},
          ${parentId},
          ${name.value},
          ${description.value},
          ${sortOrder.value ?? 0}
        )
        RETURNING *
      `;

      return res.status(201).json({ ...rows[0], card_count: 0, due_count: 0, struggling_count: 0 });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/POST /api/flash/categories", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
