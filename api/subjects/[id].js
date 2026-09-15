import sql from "../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id } = req.query;
    const subjectId = Number(id);

    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: "subject id must be a number" });
    }

    const rows = await sql`
      SELECT s.*, count(c.id)::int AS category_count
      FROM subjects s
      LEFT JOIN categories c ON c.subject_id = s.id
      WHERE s.id = ${subjectId}
      GROUP BY s.id
    `;

    if (!rows.length) {
      return res.status(404).json({ error: "subject not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error("GET /api/subjects/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}