import sql from "../../_lib/db.js";
import { requireAccess } from "../../_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Reads: any signed-in user. Writes (POST/PATCH/PUT/DELETE): admin only.
  const user = requireAccess(req, res);
  if (!user) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id, excludeAttemptId } = req.query;
    const catId = Number(id);

    if (Number.isNaN(catId)) {
      return res.status(400).json({ error: "category id must be a number" });
    }

    let excludeId = -1;
    if (excludeAttemptId !== undefined) {
      excludeId = Number(excludeAttemptId);
      if (Number.isNaN(excludeId)) {
        return res.status(400).json({ error: "excludeAttemptId must be a number" });
      }
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
          AND aa.attempt_id != ${excludeId}
          AND aa.attempt_id IN (
            SELECT id FROM quiz_attempts
            WHERE category_id = ${catId} AND user_id = ${user.id}
          )
        ORDER BY aa.question_id, aa.attempt_id, aa.id DESC
      ),
      per_question AS (
        SELECT
          question_id,
          count(*) FILTER (WHERE is_correct = false) AS wrong_count,
          count(*)                                     AS total_attempts
        FROM latest_answers
        GROUP BY question_id
      )
      SELECT
        q.id AS question_id,
        COALESCE(pq.wrong_count, 0)    AS wrong_count,
        COALESCE(pq.total_attempts, 0) AS total_attempts
      FROM questions q
      LEFT JOIN per_question pq ON pq.question_id = q.id
      WHERE q.category_id = ${catId}
      ORDER BY q.id
    `;

    const result = rows.map((r) => ({
      question_id: Number(r.question_id),
      wrong_count: Number(r.wrong_count),
      total_attempts: Number(r.total_attempts),
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("GET /api/categories/:id/question-stats", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}