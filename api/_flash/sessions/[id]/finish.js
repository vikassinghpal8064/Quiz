import sql from "../../../_lib/db.js";
import { requireAuth } from "../../../_lib/auth.js";
import { flashUserId, parsePositiveInt, sendMissingFlashTable } from "../../../_lib/flashCards.js";
import { summarizeRatings } from "../../../_lib/flashStudy.js";

// POST /api/flash/sessions/:id/finish
//
// Marks a session finished and answers with a summary the study screen can show
// ("12 reviewed, 3 again"). Finishing is idempotent: calling it twice returns
// the same session, so a double-click or a retry never errors.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.id, "session id");
    if (id.error) return res.status(400).json({ error: id.error });
    const sessionId = id.value;

    const [closed, ratingRows] = await sql.transaction((txn) => [
      txn`
        UPDATE fc_sessions
        SET finished_at = COALESCE(finished_at, now())
        WHERE id = ${sessionId} AND user_id = ${uid}
        RETURNING *
      `,
      txn`
        SELECT rating, count(*)::int AS n
        FROM fc_review_logs
        WHERE session_id = ${sessionId} AND user_id = ${uid}
        GROUP BY rating
      `,
    ]);

    if (!closed.length) {
      return res.status(404).json({ error: "session not found" });
    }

    return res.status(200).json({
      session: closed[0],
      summary: summarizeRatings(ratingRows),
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/sessions/:id/finish", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
