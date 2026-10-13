import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { sendMissingTable } from "../../_lib/featureTables.js";

// Difficulty tagging is a per-user, per-question note ("this felt hard"),
// so it is auth-only like starring - never admin-only.
const LEVELS = ["easy", "medium", "hard"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== "PUT" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const qId = Number(req.query.id);
    if (Number.isNaN(qId)) {
      return res.status(400).json({ error: "question id must be a number" });
    }

    const question = await sql`SELECT id FROM questions WHERE id = ${qId}`;
    if (!question.length) {
      return res.status(404).json({ error: "question not found" });
    }

    if (req.method === "PUT") {
      const { difficulty } = req.body ?? {};

      if (typeof difficulty !== "string" || !LEVELS.includes(difficulty)) {
        return res
          .status(400)
          .json({ error: 'difficulty must be "easy", "medium" or "hard"' });
      }

      // Upsert MY tag. updated_at is bumped on every change.
      const rows = await sql`
        INSERT INTO question_difficulty_tags (question_id, user_id, difficulty)
        VALUES (${qId}, ${user.id}, ${difficulty})
        ON CONFLICT (question_id, user_id) DO UPDATE SET
          difficulty = EXCLUDED.difficulty,
          updated_at = now()
        RETURNING *
      `;

      return res.status(200).json(rows[0]);
    }

    // Clear MY tag only.
    await sql`
      DELETE FROM question_difficulty_tags
      WHERE question_id = ${qId} AND user_id = ${user.id}
    `;

    return res.status(200).json({ question_id: qId, difficulty: null });
  } catch (err) {
    if (sendMissingTable(res, err)) return;
    console.error("PUT/DELETE /api/questions/:id/difficulty", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
