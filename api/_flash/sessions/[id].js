import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { flashUserId, parsePositiveInt, sendMissingFlashTable } from "../../_lib/flashCards.js";
import { SESSION_CARDS_SQL, settingsFromRows } from "../../_lib/flashStudy.js";

// GET    /api/flash/sessions/:id - the session, its ordered queue and the
//                                  scheduler settings the client needs to
//                                  preview the four rating buttons
// DELETE /api/flash/sessions/:id - abandon a session (its queue cascades away;
//                                  the review history is deliberately kept)
//
// Scoped to the caller: a session that belongs to someone else is a 404.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "GET" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.id, "session id");
    if (id.error) return res.status(400).json({ error: id.error });
    const sessionId = id.value;

    if (req.method === "DELETE") {
      const deleted = await sql`
        DELETE FROM fc_sessions
        WHERE id = ${sessionId} AND user_id = ${uid}
        RETURNING id
      `;
      if (!deleted.length) {
        return res.status(404).json({ error: "session not found" });
      }
      return res.status(200).json({ id: deleted[0].id, deleted: true });
    }

    // One round trip: the session row, its queue, and the scheduler settings.
    const [sessionRows, cards, settingRows] = await sql.transaction((txn) => [
      txn`SELECT * FROM fc_sessions WHERE id = ${sessionId} AND user_id = ${uid}`,
      txn.query(SESSION_CARDS_SQL, [sessionId, uid]),
      txn`SELECT key, value FROM fc_settings WHERE user_id = ${uid}`,
    ]);

    if (!sessionRows.length) {
      return res.status(404).json({ error: "session not found" });
    }

    return res.status(200).json({
      session: sessionRows[0],
      cards,
      settings: settingsFromRows(settingRows),
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/DELETE /api/flash/sessions/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
