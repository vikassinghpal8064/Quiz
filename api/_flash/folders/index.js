import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  optionalString,
  requiredString,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";

// GET  /api/flash/folders - list the caller's folders with category + card counts
// POST /api/flash/folders - create a folder
//
// Flash data is private to the signed-in account, so every query is scoped to
// the caller (auth-only, never admin-only - same rule as starring a question).
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
      // due_count is "cards reviewable today": not suspended and due before the
      // end of today, so overdue cards are included. The state join is 1:1 with
      // cards, so it never inflates card_count.
      const rows = await sql`
        SELECT f.*,
          count(DISTINCT c.id)::int AS category_count,
          count(card.id)::int      AS card_count,
          count(card.id) FILTER (
            WHERE st.due IS NOT NULL
              AND st.due < date_trunc('day', now()) + interval '1 day'
              AND card.suspended = false
          )::int AS due_count
        FROM fc_folders f
        LEFT JOIN fc_categories c    ON c.folder_id = f.id
        LEFT JOIN fc_cards      card ON card.category_id = c.id
        LEFT JOIN fc_card_state st   ON st.card_id = card.id
        WHERE f.user_id = ${uid}
        GROUP BY f.id
        ORDER BY f.sort_order ASC, f.created_at DESC
      `;
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};

      const name = requiredString(body.name, "name", 200);
      if (name.error) return res.status(400).json({ error: name.error });

      const description = optionalString(body.description, "description", 2000);
      if (description.error) return res.status(400).json({ error: description.error });

      const color = optionalString(body.color, "color", 32);
      if (color.error) return res.status(400).json({ error: color.error });

      const icon = optionalString(body.icon, "icon", 64);
      if (icon.error) return res.status(400).json({ error: icon.error });

      const sortOrder = optionalInt(body.sort_order, "sort_order", { min: 0, max: 1_000_000 });
      if (sortOrder.error) return res.status(400).json({ error: sortOrder.error });

      const rows = await sql`
        INSERT INTO fc_folders (user_id, name, description, color, icon, sort_order)
        VALUES (
          ${uid},
          ${name.value},
          ${description.value},
          ${color.value},
          ${icon.value},
          ${sortOrder.value ?? 0}
        )
        RETURNING *
      `;

      return res.status(201).json({ ...rows[0], category_count: 0, card_count: 0, due_count: 0 });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/POST /api/flash/folders", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
