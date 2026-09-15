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
      const { subjectId } = req.query;

      if (!subjectId) {
        return res.status(400).json({ error: "subjectId query param is required" });
      }

      const id = Number(subjectId);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "subjectId must be a number" });
      }

      const rows = await sql`
        SELECT c.*, count(q.id)::int AS question_count
        FROM categories c
        LEFT JOIN questions q ON q.category_id = c.id
        WHERE c.subject_id = ${id}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `;
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const { subject_id, name, description } = req.body ?? {};

      if (!subject_id || !name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "subject_id and name are required" });
      }

      const subId = Number(subject_id);
      if (Number.isNaN(subId)) {
        return res.status(400).json({ error: "subject_id must be a number" });
      }

      const rows = await sql`
        INSERT INTO categories (subject_id, name, description)
        VALUES (${subId}, ${name.trim()}, ${description ?? null})
        RETURNING *
      `;
      return res.status(201).json(rows[0]);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("GET/POST /api/categories", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
