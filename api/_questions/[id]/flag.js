import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { sendMissingTable } from "../../_lib/featureTables.js";

// Flagging a question is something every signed-in user may do, so this is
// auth-only (requireAuth), never admin-only. The admin helper requireAccess
// would wrongly treat these writes as admin actions.
const REASONS = [
  "wrong_answer_key",
  "typo",
  "unclear_question",
  "wrong_explanation",
  "other",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== "POST" && req.method !== "DELETE") {
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

    if (req.method === "POST") {
      const { reason, comment } = req.body ?? {};

      if (typeof reason !== "string" || !REASONS.includes(reason)) {
        return res.status(400).json({
          error: `reason must be one of: ${REASONS.join(", ")}`,
        });
      }

      const trimmedComment =
        typeof comment === "string" && comment.trim() ? comment.trim() : null;
      if (trimmedComment && trimmedComment.length > 2000) {
        return res.status(400).json({ error: "comment is too long" });
      }

      // Upsert MY flag. Re-filing a previously resolved/dismissed flag
      // reopens it, which is why status/resolution are reset here.
      const rows = await sql`
        INSERT INTO flagged_questions (question_id, user_id, reason, comment, status)
        VALUES (${qId}, ${user.id}, ${reason}, ${trimmedComment}, 'open')
        ON CONFLICT (question_id, user_id) DO UPDATE SET
          reason      = EXCLUDED.reason,
          comment     = EXCLUDED.comment,
          status      = 'open',
          created_at  = now(),
          resolved_at = NULL,
          resolved_by = NULL
        RETURNING *
      `;

      return res.status(201).json(rows[0]);
    }

    // Withdraw MY flag only. Scoped by user_id so one user can never
    // remove another user's report.
    await sql`
      DELETE FROM flagged_questions
      WHERE question_id = ${qId} AND user_id = ${user.id}
    `;

    return res.status(200).json({ question_id: qId, flagged: false });
  } catch (err) {
    if (sendMissingTable(res, err)) return;
    console.error("POST/DELETE /api/questions/:id/flag", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
