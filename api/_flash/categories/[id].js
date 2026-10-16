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

// GET    /api/flash/categories/:id - the category, its folder name and its counts
// PATCH  /api/flash/categories/:id - rename / reshuffle / re-parent a category
// DELETE /api/flash/categories/:id - delete a category and its subtree
//
// Scoped to the caller. Re-parenting is validated: a category may not become
// its own parent, and it may not move under one of its own descendants (which
// would create a cycle). All operations report how many cards they affect.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "GET" && req.method !== "PATCH" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.id, "category id");
    if (id.error) return res.status(400).json({ error: id.error });
    const categoryId = id.value;

    // GET: one request powers the category header and its breadcrumb - the
    // category row, its folder's name, and the same card / due / struggling
    // counts the folder list returns.
    if (req.method === "GET") {
      const rows = await sql`
        SELECT c.*, f.name AS folder_name,
          count(card.id)::int AS card_count,
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
        JOIN fc_folders f ON f.id = c.folder_id
        LEFT JOIN fc_cards      card ON card.category_id = c.id
        LEFT JOIN fc_card_state st   ON st.card_id = card.id
        WHERE c.id = ${categoryId} AND c.user_id = ${uid}
        GROUP BY c.id, f.name
      `;
      if (!rows.length) {
        return res.status(404).json({ error: "category not found" });
      }
      return res.status(200).json(rows[0]);
    }

    const existing = await sql`
      SELECT id, folder_id FROM fc_categories
      WHERE id = ${categoryId} AND user_id = ${uid}
    `;
    if (!existing.length) {
      return res.status(404).json({ error: "category not found" });
    }
    const folderId = existing[0].folder_id;

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
      if (body.sort_order !== undefined) {
        const sortOrder = optionalInt(body.sort_order, "sort_order", { min: 0, max: 1_000_000 });
        if (sortOrder.error) return res.status(400).json({ error: sortOrder.error });
        params.push(sortOrder.value ?? 0);
        updates.push(`sort_order = $${params.length}`);
      }
      if (body.parent_id !== undefined) {
        // null / "" detaches the category (moves it to the top level).
        if (body.parent_id === null || body.parent_id === "") {
          params.push(null);
          updates.push(`parent_id = $${params.length}`);
        } else {
          const parent = parsePositiveInt(body.parent_id, "parent_id");
          if (parent.error) return res.status(400).json({ error: parent.error });
          if (parent.value === categoryId) {
            return res.status(400).json({ error: "a category cannot be its own parent" });
          }

          const parentRow = await sql`
            SELECT id FROM fc_categories
            WHERE id = ${parent.value} AND user_id = ${uid} AND folder_id = ${folderId}
          `;
          if (!parentRow.length) {
            return res.status(400).json({ error: "parent_id must be a category in the same folder" });
          }

          // Reject a parent that lives inside this category's own subtree.
          const cycle = await sql`
            WITH RECURSIVE descendants AS (
              SELECT id FROM fc_categories WHERE parent_id = ${categoryId}
              UNION ALL
              SELECT c.id
              FROM fc_categories c
              JOIN descendants d ON c.parent_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = ${parent.value}
          `;
          if (cycle.length) {
            return res.status(400).json({ error: "parent_id cannot be a descendant of this category" });
          }

          params.push(parent.value);
          updates.push(`parent_id = $${params.length}`);
        }
      }

      if (!updates.length) {
        return res.status(400).json({ error: "nothing to update" });
      }

      params.push(categoryId, uid);
      const idParam = params.length - 1;
      const userParam = params.length;

      const [updated, counts] = await sql.transaction((txn) => [
        txn.query(
          `UPDATE fc_categories
             SET ${updates.join(", ")}
           WHERE id = $${idParam} AND user_id = $${userParam}
           RETURNING *`,
          params
        ),
        txn`
          SELECT count(card.id)::int AS card_count,
            count(card.id) FILTER (
              WHERE st.due IS NOT NULL
                AND st.due < date_trunc('day', now()) + interval '1 day'
                AND card.suspended = false
            )::int AS due_count,
            count(card.id) FILTER (
              WHERE st.struggle_score >= ${STRUGGLE_THRESHOLD}
                AND card.suspended = false
            )::int AS struggling_count
          FROM fc_cards card
          LEFT JOIN fc_card_state st ON st.card_id = card.id
          WHERE card.category_id = ${categoryId}
        `,
      ]);

      if (!updated.length) {
        return res.status(404).json({ error: "category not found" });
      }

      return res.status(200).json({
        ...updated[0],
        card_count: counts[0].card_count ?? 0,
        due_count: counts[0].due_count ?? 0,
        struggling_count: counts[0].struggling_count ?? 0,
      });
    }

    // DELETE. The recursive CTE counts the whole subtree (children, their
    // children, ...) and every card in it before the cascade removes them.
    const [counts, deleted] = await sql.transaction((txn) => [
      txn`
        WITH RECURSIVE subtree AS (
          SELECT id FROM fc_categories WHERE id = ${categoryId}
          UNION ALL
          SELECT c.id
          FROM fc_categories c
          JOIN subtree s ON c.parent_id = s.id
        )
        SELECT
          (SELECT count(*)::int FROM fc_cards WHERE category_id IN (SELECT id FROM subtree))
            AS card_count,
          (SELECT count(*)::int FROM subtree) - 1 AS child_count
      `,
      txn`DELETE FROM fc_categories WHERE id = ${categoryId} AND user_id = ${uid}
          RETURNING id, name`,
    ]);

    if (!deleted.length) {
      return res.status(404).json({ error: "category not found" });
    }

    return res.status(200).json({
      id: deleted[0].id,
      name: deleted[0].name,
      deleted: {
        categories: counts[0].child_count ?? 0,
        cards: counts[0].card_count ?? 0,
      },
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("PATCH/DELETE /api/flash/categories/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
