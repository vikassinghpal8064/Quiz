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
    const attemptId = Number(id);

    if (Number.isNaN(attemptId)) {
      return res.status(400).json({ error: "attempt id must be a number" });
    }

    const attempt = await sql`SELECT * FROM quiz_attempts WHERE id = ${attemptId}`;
    if (!attempt.length) {
      return res.status(404).json({ error: "attempt not found" });
    }

    const answers = await sql`
      SELECT
        aa.id               AS answer_id,
        aa.question_id,
        q.question_text,
        q.explanation,
        q.image_url,
        aa.selected_option_id,
        sel.option_text     AS selected_option_text,
        cor.id              AS correct_option_id,
        cor.option_text     AS correct_option_text,
        aa.is_correct
      FROM attempt_answers aa
      JOIN questions q       ON q.id  = aa.question_id
      JOIN options cor       ON cor.question_id = aa.question_id AND cor.is_correct = true
      LEFT JOIN options sel  ON sel.id = aa.selected_option_id
      WHERE aa.attempt_id = ${attemptId}
      ORDER BY aa.id
    `;

    return res.status(200).json({
      attempt: attempt[0],
      answers,
    });
  } catch (err) {
    console.error("GET /api/attempts/:id/results", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
