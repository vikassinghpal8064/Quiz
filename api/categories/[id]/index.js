import sql from "../../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { id } = req.query;
    const catId = Number(id);

    if (Number.isNaN(catId)) {
      return res.status(400).json({ error: "category id must be a number" });
    }

    if (req.method === "PATCH") {
      const { name, description } = req.body ?? {};

      if (name !== undefined && (typeof name !== "string" || !name.trim())) {
        return res.status(400).json({ error: "name cannot be empty" });
      }

      const updates = [];
      const params = [];
      if (name !== undefined) {
        params.push(name.trim());
        updates.push(`name = $${params.length}`);
      }
      if (description !== undefined) {
        params.push(description === "" ? null : description);
        updates.push(`description = $${params.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({ error: "nothing to update" });
      }

      params.push(catId);
      const rows = await sql.query(
        `UPDATE categories SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (!rows.length) {
        return res.status(404).json({ error: "category not found" });
      }

      return res.status(200).json(rows[0]);
    }

    if (req.method === "DELETE") {
      const existing = await sql`
        SELECT id, name FROM categories WHERE id = ${catId}
      `;

      if (!existing.length) {
        return res.status(404).json({ error: "category not found" });
      }

      const [questionRow, deletedRow] = await sql.transaction((txn) => [
        txn`SELECT count(*)::int AS c FROM questions WHERE category_id = ${catId}`,
        txn`DELETE FROM categories WHERE id = ${catId}
            RETURNING id, name`,
      ]);

      return res.status(200).json({
        id: deletedRow[0].id,
        name: deletedRow[0].name,
        deleted: {
          questions: questionRow[0].c,
        },
      });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
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