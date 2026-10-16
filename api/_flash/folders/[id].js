import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  optionalString,
  parsePositiveInt,
  requiredString,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";

// PATCH  /api/flash/folders/:id - rename / re-theme a folder
// DELETE /api/flash/folders/:id - delete a folder (cascades to categories + cards)
//
// Both return the category and card counts, so the UI can show what a delete
// removed without a follow-up request. Everything is scoped to the caller.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "PATCH" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.id, "folder id");
    if (id.error) return res.status(400).json({ error: id.error });
    const folderId = id.value;

    if (req.method === "PATCH") {
      const body = req.body ?? {};
      const updates = [];
      const params = [];

      if (body.name !== undefined) {
        const name = requiredString(body.name, "name", 200);
        if (name.error) return res.status(400).json({ error: name.error });
        params.push(name.value);
        updates.push(`name = $${params.length}`);
      }
      if (body.description !== undefined) {
        const description = optionalString(body.description, "description", 2000);
        if (description.error) return res.status(400).json({ error: description.error });
        params.push(description.value);
        updates.push(`description = $${params.length}`);
      }
      if (body.color !== undefined) {
        const color = optionalString(body.color, "color", 32);
        if (color.error) return res.status(400).json({ error: color.error });
        params.push(color.value);
        updates.push(`color = $${params.length}`);
      }
      if (body.icon !== undefined) {
        const icon = optionalString(body.icon, "icon", 64);
        if (icon.error) return res.status(400).json({ error: icon.error });
        params.push(icon.value);
        updates.push(`icon = $${params.length}`);
      }
      if (body.sort_order !== undefined) {
        const sortOrder = optionalInt(body.sort_order, "sort_order", { min: 0, max: 1_000_000 });
        if (sortOrder.error) return res.status(400).json({ error: sortOrder.error });
        params.push(sortOrder.value ?? 0);
        updates.push(`sort_order = $${params.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({ error: "nothing to update" });
      }

      params.push(folderId, uid);
      const idParam = params.length - 1;
      const userParam = params.length;

      // The update and the counts are independent, so one transaction batches
      // them into a single Neon round trip.
      const [updated, counts] = await sql.transaction((txn) => [
        txn.query(
          `UPDATE fc_folders
             SET ${updates.join(", ")}
           WHERE id = $${idParam} AND user_id = $${userParam}
           RETURNING *`,
          params
        ),
        txn`
          SELECT
            count(DISTINCT c.id)::int AS category_count,
            count(card.id)::int      AS card_count
          FROM fc_categories c
          LEFT JOIN fc_cards card ON card.category_id = c.id
          WHERE c.folder_id = ${folderId}
        `,
      ]);

      if (!updated.length) {
        return res.status(404).json({ error: "folder not found" });
      }

      return res.status(200).json({
        ...updated[0],
        category_count: counts[0].category_count ?? 0,
        card_count: counts[0].card_count ?? 0,
      });
    }

    // DELETE
    const existing = await sql`
      SELECT id FROM fc_folders WHERE id = ${folderId} AND user_id = ${uid}
    `;
    if (!existing.length) {
      return res.status(404).json({ error: "folder not found" });
    }

    // The counts must be read before the DELETE (the cascade removes the rows),
    // so both statements run in one transaction, in order.
    const [counts, deleted] = await sql.transaction((txn) => [
      txn`
        SELECT
          count(DISTINCT c.id)::int AS category_count,
          count(card.id)::int      AS card_count
        FROM fc_categories c
        LEFT JOIN fc_cards card ON card.category_id = c.id
        WHERE c.folder_id = ${folderId}
      `,
      txn`DELETE FROM fc_folders WHERE id = ${folderId} AND user_id = ${uid}
          RETURNING id, name`,
    ]);

    if (!deleted.length) {
      return res.status(404).json({ error: "folder not found" });
    }

    return res.status(200).json({
      id: deleted[0].id,
      name: deleted[0].name,
      deleted: {
        categories: counts[0].category_count ?? 0,
        cards: counts[0].card_count ?? 0,
      },
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("PATCH/DELETE /api/flash/folders/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
