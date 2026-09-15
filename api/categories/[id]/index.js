import sql from "../../_lib/db.js";

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
    const catId = Number(id);

    if (Number.isNaN(catId)) {
      return res.status(400).json({ error: "category id must be a number" });
    }

    const rows = await sql`
      SELECT c.*, count(q.id)::int AS question_count
      FROM categories c
      LEFT JOIN questions q ON q.category_id = c.id
      WHERE c.id = ${catId}
      GROUP BY c.id
    `;

    if (!rows.length) {
      return res.status(404).json({ error: "category not found" });
    }

    const stats = await sql`
      SELECT
        count(*)::int AS attempt_count,
        max(score)::int AS best_score
      FROM quiz_attempts
      WHERE category_id = ${catId} AND finished_at IS NOT NULL
    `;

    const recentAttempts = await sql`
      SELECT id, mode, score, total_questions, finished_at
      FROM quiz_attempts
      WHERE category_id = ${catId} AND finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 10
    `;

    return res.status(200).json({
      ...rows[0],
      question_count: rows[0].question_count ?? 0,
      attempt_count: stats[0].attempt_count ?? 0,
      best_score: stats[0].best_score,
      recent_attempts: recentAttempts,
    });
  } catch (err) {
    console.error("GET /api/categories/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}