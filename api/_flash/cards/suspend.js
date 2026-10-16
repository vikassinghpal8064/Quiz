import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  optionalBool,
  parseIdList,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";

// POST /api/flash/cards/suspend   body { card_ids: [...], suspended? }
//
// Suspends (default) or un-suspends a batch of the caller's cards. Suspended
// cards are excluded from study sessions by the scheduler; nothing is deleted.
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
    const { card_ids, suspended: rawSuspended } = req.body ?? {};

    const ids = parseIdList(card_ids, "card_ids");
    if (ids.error) return res.status(400).json({ error: ids.error });

    const suspended = optionalBool(rawSuspended, "suspended");
    if (suspended.error) return res.status(400).json({ error: suspended.error });
    const value = suspended.value ?? true;

    const updated = await sql`
      UPDATE fc_cards
         SET suspended  = ${value},
             updated_at = now()
       WHERE id = ANY(${ids.value}) AND user_id = ${uid}
       RETURNING id
    `;

    return res.status(200).json({
      updated: updated.length,
      suspended: value,
      card_ids: updated.map((row) => row.id),
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/cards/suspend", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
