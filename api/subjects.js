import sql from "./_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      const rows = await sql`
        SELECT s.*, count(c.id)::int AS category_count
        FROM subjects s
        LEFT JOIN categories c ON c.subject_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC
      `;
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const { name, description, icon_name } = req.body ?? {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }

      const rows = await sql`
        INSERT INTO subjects (name, description, icon_name)
        VALUES (${name.trim()}, ${description ?? null}, ${icon_name ?? null})
        RETURNING *
      `;
      return res.status(201).json(rows[0]);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("GET/POST /api/subjects", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
