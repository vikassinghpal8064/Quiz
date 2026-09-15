import sql from "./_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { category_id, mode } = req.body ?? {};

    if (!category_id) {
      return res.status(400).json({ error: "category_id is required" });
    }

    if (mode !== "full" && mode !== "wrong_only" && mode !== "starred_only") {
      return res
        .status(400)
        .json({ error: 'mode must be "full", "wrong_only" or "starred_only"' });
    }

    const catId = Number(category_id);
    if (Number.isNaN(catId)) {
      return res.status(400).json({ error: "category_id must be a number" });
    }

    const rows = await sql`
      INSERT INTO quiz_attempts (category_id, mode)
      VALUES (${catId}, ${mode})
      RETURNING *
    `;

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/attempts", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
