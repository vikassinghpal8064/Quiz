import sql from "../../_lib/db.js";

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
    const { id } = req.query;
    const attemptId = Number(id);

    if (Number.isNaN(attemptId)) {
      return res.status(400).json({ error: "attempt id must be a number" });
    }

    const attempt = await sql`SELECT * FROM quiz_attempts WHERE id = ${attemptId}`;
    if (!attempt.length) {
      return res.status(404).json({ error: "attempt not found" });
    }
    if (attempt[0].finished_at) {
      return res.status(400).json({ error: "attempt is already finished" });
    }

    const stats = await sql`
      SELECT
        count(*)::int       AS total_questions,
        count(*) FILTER (WHERE is_correct)::int AS score
      FROM attempt_answers
      WHERE attempt_id = ${attemptId}
    `;

    const { total_questions, score } = stats[0];

    const rows = await sql`
      UPDATE quiz_attempts
      SET score           = ${score},
          total_questions = ${total_questions},
          finished_at     = now()
      WHERE id = ${attemptId}
      RETURNING *
    `;

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error("POST /api/attempts/:id/finish", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
