import sql from "../../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id } = req.query;
    const qId = Number(id);

    if (Number.isNaN(qId)) {
      return res.status(400).json({ error: "question id must be a number" });
    }

    const question = await sql`
      SELECT id, category_id FROM questions WHERE id = ${qId}
    `;
    if (!question.length) {
      return res.status(404).json({ error: "question not found" });
    }
    const { category_id } = question[0];

    if (req.method === "POST") {
      const rows = await sql`
        INSERT INTO starred_questions (question_id, category_id)
        VALUES (${qId}, ${category_id})
        ON CONFLICT (question_id) DO NOTHING
        RETURNING *
      `;

      if (!rows.length) {
        const existing = await sql`
          SELECT * FROM starred_questions WHERE question_id = ${qId}
        `;
        return res.status(200).json(existing[0]);
      }

      return res.status(201).json(rows[0]);
    }

    await sql`
      DELETE FROM starred_questions WHERE question_id = ${qId}
    `;

    return res.status(200).json({ question_id: qId, starred: false });
  } catch (err) {
    console.error("POST/DELETE /api/questions/:id/star", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}