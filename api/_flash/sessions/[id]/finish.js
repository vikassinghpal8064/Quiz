import sql from "../../../_lib/db.js";
import { requireAuth } from "../../../_lib/auth.js";
import {
  STRUGGLE_THRESHOLD,
  flashUserId,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../../_lib/flashCards.js";
import { summarizeRatings } from "../../../_lib/flashStudy.js";

// POST /api/flash/sessions/:id/finish
//
// Marks a session finished and answers with the summary the study screen shows:
// the per-rating counts plus accuracy, the time spent, and how many queued cards
// are flagged as struggling. Finishing is idempotent: calling it twice returns
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

    const [closed, ratingRows, timeRows, struggleRows] = await sql.transaction((txn) => [
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
      // total_ms is "shown to rating"; think_ms is the fallback for rows written
      // before the client sent a total.
      txn`
        SELECT COALESCE(sum(COALESCE(total_ms, think_ms, 0)), 0)::int AS total_ms,
               COALESCE(sum(think_ms), 0)::int AS think_ms
        FROM fc_review_logs
        WHERE session_id = ${sessionId} AND user_id = ${uid}
      `,
      // Cards in this sitting whose struggle_score has crossed the line.
      txn`
        SELECT count(*)::int AS n
        FROM fc_session_cards sc
        JOIN fc_card_state s ON s.card_id = sc.card_id
        WHERE sc.session_id = ${sessionId} AND sc.user_id = ${uid}
          AND s.struggle_score >= ${STRUGGLE_THRESHOLD}
      `,
    ]);

    if (!closed.length) {
      return res.status(404).json({ error: "session not found" });
    }

    const summary = summarizeRatings(ratingRows);
    const correct = summary.good + summary.easy;
    summary.accuracy = summary.total > 0 ? correct / summary.total : 0;
    summary.total_ms = timeRows?.[0]?.total_ms ?? 0;
    summary.think_ms = timeRows?.[0]?.think_ms ?? 0;
    summary.struggling = struggleRows?.[0]?.n ?? 0;

    return res.status(200).json({ session: closed[0], summary });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/sessions/:id/finish", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
