import sql from "../../_lib/db.js";
import { requireAdmin } from "../../_lib/auth.js";
import { sendMissingTable } from "../../_lib/featureTables.js";

const STATUSES = ["open", "resolved", "dismissed"];

// PATCH /api/admin/flags/:id   body { status }
//
// Admin triage: resolve, dismiss, or reopen a single flag. resolved_at /
// resolved_by are stamped on resolve/dismiss and cleared on reopen.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const flagId = Number(req.query.id);
    if (Number.isNaN(flagId)) {
      return res.status(400).json({ error: "flag id must be a number" });
    }

    const { status } = req.body ?? {};
    if (typeof status !== "string" || !STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    }

    const rows = await sql`
      UPDATE flagged_questions
      SET status      = ${status},
          resolved_at = CASE WHEN ${status} = 'open' THEN NULL ELSE now() END,
          resolved_by = CASE WHEN ${status} = 'open' THEN NULL ELSE ${admin.id}::int END
      WHERE id = ${flagId}
      RETURNING *
    `;

    if (!rows.length) {
      return res.status(404).json({ error: "flag not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    if (sendMissingTable(res, err)) return;
    console.error("PATCH /api/admin/flags/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
