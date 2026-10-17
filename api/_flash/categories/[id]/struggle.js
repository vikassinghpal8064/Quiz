import sql from "../../../_lib/db.js";
import { requireAuth } from "../../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../../_lib/flashCards.js";

// GET /api/flash/categories/:id/struggle?limit=
//
// The "struggle list" for one category: its hardest cards, hardest first, each
// with the struggle_score and the average think time the scheduler has recorded.
// A category includes every category nested beneath it, matching the scope a
// category study session uses.
//
// Scoped to the caller: a category that belongs to someone else is a 404.
// Suspended cards are left out - they are already parked and cannot be studied.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
    const id = parsePositiveInt(req.query?.id, "category id");
    if (id.error) return res.status(400).json({ error: id.error });
    const categoryId = id.value;

    let limit = DEFAULT_LIMIT;
    if (req.query?.limit !== undefined && req.query?.limit !== "") {
      const parsed = optionalInt(req.query.limit, "limit", { min: 1, max: MAX_LIMIT });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      limit = parsed.value ?? DEFAULT_LIMIT;
    }

    const [categoryRows, cards] = await sql.transaction((txn) => [
      txn`
        SELECT id, name, description, folder_id, parent_id
        FROM fc_categories
        WHERE id = ${categoryId} AND user_id = ${uid}
      `,
      // The recursive CTE walks the category subtree, so a parent category's
      // struggle list also covers its children. LEFT JOIN keeps a card with no
      // state row yet (score treated as the lowest) rather than dropping it.
      txn`
        WITH RECURSIVE sub AS (
          SELECT id FROM fc_categories WHERE id = ${categoryId} AND user_id = ${uid}
          UNION ALL
          SELECT child.id FROM fc_categories child JOIN sub ON child.parent_id = sub.id
        )
        SELECT c.id, c.card_type, c.front, c.back, c.tags, c.source, c.source_ref,
               s.state, s.due, s.stability, s.difficulty, s.reps, s.lapses,
               s.last_review, s.avg_think_ms, s.struggle_score
        FROM fc_cards c
        LEFT JOIN fc_card_state s ON s.card_id = c.id
        WHERE c.user_id = ${uid} AND c.suspended = false
          AND c.category_id IN (SELECT id FROM sub)
        ORDER BY s.struggle_score DESC NULLS LAST,
                 s.lapses DESC NULLS LAST,
                 c.id DESC
        LIMIT ${limit}
      `,
    ]);

    if (!categoryRows.length) {
      return res.status(404).json({ error: "category not found" });
    }

    return res.status(200).json({ category: categoryRows[0], cards });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET /api/flash/categories/:id/struggle", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
