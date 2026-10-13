import sql from "../../../_lib/db.js";
import { requireAdmin } from "../../../_lib/auth.js";
import { sendMissingTable } from "../../../_lib/featureTables.js";

// GET /api/admin/questions/:id/flags
//
// Admin-only: every flag on one question, from all users, with the reporter's
// username and the current status. Newest open flags first.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const qId = Number(req.query.id);
    if (Number.isNaN(qId)) {
      return res.status(400).json({ error: "question id must be a number" });
    }

    const rows = await sql`
      SELECT
        f.id,
        f.question_id,
        f.reason,
        f.comment,
        f.status,
        f.created_at,
        f.resolved_at,
        f.user_id,
        u.username       AS username,
        f.resolved_by,
        ru.username      AS resolved_by_username
      FROM flagged_questions f
      LEFT JOIN users u  ON u.id  = f.user_id
      LEFT JOIN users ru ON ru.id = f.resolved_by
      WHERE f.question_id = ${qId}
      ORDER BY (f.status = 'open') DESC, f.created_at DESC, f.id DESC
    `;

    return res.status(200).json(rows);
  } catch (err) {
    if (sendMissingTable(res, err)) return;
    console.error("GET /api/admin/questions/:id/flags", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
