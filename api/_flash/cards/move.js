import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  parseIdList,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";

// POST /api/flash/cards/move   body { card_ids: [...], category_id }
//
// Moves any number of the caller's cards into another category in one UPDATE.
// Only the caller's rows are touched, and the destination must be one of the
// caller's categories. Cards that do not exist (or belong to someone else) are
// simply not moved - the response reports how many actually changed.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { card_ids, category_id } = req.body ?? {};

    const ids = parseIdList(card_ids, "card_ids");
    if (ids.error) return res.status(400).json({ error: ids.error });

    const target = parsePositiveInt(category_id, "category_id");
    if (target.error) return res.status(400).json({ error: target.error });

    const category = await sql`
      SELECT id FROM fc_categories WHERE id = ${target.value} AND user_id = ${uid}
    `;
    if (!category.length) {
      return res.status(404).json({ error: "category not found" });
    }

    const moved = await sql`
      UPDATE fc_cards
         SET category_id = ${target.value},
             updated_at  = now()
       WHERE id = ANY(${ids.value}) AND user_id = ${uid}
       RETURNING id
    `;

    return res.status(200).json({
      moved: moved.length,
      category_id: target.value,
      card_ids: moved.map((row) => row.id),
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/cards/move", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
