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
      WITH latest_answers AS (
        SELECT DISTINCT ON (aa.question_id, aa.attempt_id)
          aa.question_id,
          aa.attempt_id,
          aa.is_correct
        FROM attempt_answers aa
        JOIN questions q ON q.id = aa.question_id
        WHERE q.category_id = ${catId}
        ORDER BY aa.question_id, aa.attempt_id, aa.id DESC
      )
      SELECT
        question_id,
        count(*) FILTER (WHERE is_correct = false) AS wrong_count,
        count(*)                                     AS total_attempts
      FROM latest_answers
      GROUP BY question_id
      HAVING count(*) FILTER (WHERE is_correct = false) > 0
      ORDER BY wrong_count DESC
    `;

    const result = rows.map((r) => ({
      question_id: r.question_id,
      wrong_count: Number(r.wrong_count),
      total_attempts: Number(r.total_attempts),
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("GET /api/categories/:id/wrong-questions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}