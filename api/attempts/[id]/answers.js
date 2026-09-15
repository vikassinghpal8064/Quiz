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

    const { question_id, selected_option_id } = req.body ?? {};

    if (!question_id || !selected_option_id) {
      return res
        .status(400)
        .json({ error: "question_id and selected_option_id are required" });
    }

    const qId = Number(question_id);
    const optId = Number(selected_option_id);

    if (Number.isNaN(qId) || Number.isNaN(optId)) {
      return res
        .status(400)
        .json({ error: "question_id and selected_option_id must be numbers" });
    }

    const attempt = await sql`SELECT * FROM quiz_attempts WHERE id = ${attemptId}`;
    if (!attempt.length) {
      return res.status(404).json({ error: "attempt not found" });
    }
    if (attempt[0].finished_at) {
      return res.status(400).json({ error: "attempt is already finished" });
    }

    const option = await sql`SELECT * FROM options WHERE id = ${optId}`;
    if (!option.length) {
      return res.status(404).json({ error: "option not found" });
    }

    const isCorrect = option[0].is_correct;

    const existing = await sql`
      SELECT id FROM attempt_answers
      WHERE attempt_id = ${attemptId} AND question_id = ${qId}
    `;

    let rows;
    let created = true;

    if (existing.length) {
      rows = await sql`
        UPDATE attempt_answers
        SET selected_option_id = ${optId}, is_correct = ${isCorrect}
        WHERE id = ${existing[0].id}
        RETURNING *
      `;
      created = false;
    } else {
      rows = await sql`
        INSERT INTO attempt_answers (attempt_id, question_id, selected_option_id, is_correct)
        VALUES (${attemptId}, ${qId}, ${optId}, ${isCorrect})
        RETURNING *
      `;
    }

    return res.status(created ? 201 : 200).json(rows[0]);
  } catch (err) {
    console.error("POST /api/attempts/:id/answers", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
