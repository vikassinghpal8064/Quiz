import sql from "../../../_lib/db.js";
import { requireAuth } from "../../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../../_lib/flashCards.js";
import {
  INSERT_REVIEW_SQL,
  REVIEW_CONTEXT_SQL,
  UPDATE_STATE_SQL,
  insertReviewArgs,
  loadSettings,
  planReview,
  previewFor,
  updateStateArgs,
} from "../../../_lib/flashStudy.js";

const MAX_MS = 3_600_000;

// POST /api/flash/sessions/:id/review
//
// Body: { card_id, rating, think_ms?, total_ms? }
//
// Records one answer. The next scheduler state is computed on the server from
// the current fc_card_state row (never trusted from the client), then the state
// update, the append-only review log and the session's completed counter are
// written in one transaction. Re-answering a card in the same session updates
// its state and logs the event but does not double-count it.
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

    const body = req.body ?? {};
    const card = parsePositiveInt(body.card_id, "card_id");
    if (card.error) return res.status(400).json({ error: card.error });
    const cardId = card.value;

    const thinkMs = optionalInt(body.think_ms, "think_ms", { min: 0, max: MAX_MS });
    if (thinkMs.error) return res.status(400).json({ error: thinkMs.error });

    const totalMs = optionalInt(body.total_ms, "total_ms", { min: 0, max: MAX_MS });
    if (totalMs.error) return res.status(400).json({ error: totalMs.error });

    const session = await sql`
      SELECT id, finished_at FROM fc_sessions WHERE id = ${sessionId} AND user_id = ${uid}
    `;
    if (!session.length) {
      return res.status(404).json({ error: "session not found" });
    }
    if (session[0].finished_at) {
      return res.status(409).json({ error: "session is already finished" });
    }

    const contextRows = await sql.query(REVIEW_CONTEXT_SQL, [cardId, uid, sessionId]);
    if (!contextRows.length) {
      return res.status(404).json({ error: "card not found" });
    }
    const context = contextRows[0];
    if (!context.in_session) {
      return res.status(400).json({ error: "card is not part of this session" });
    }

    const settings = await loadSettings(sql, uid);
    const now = new Date();

    let plan;
    try {
      plan = planReview({ context, rating: body.rating, thinkMs: thinkMs.value, now, settings });
    } catch (err) {
      return res.status(400).json({ error: err?.message ?? "Invalid rating" });
    }

    const [, , sessionRows] = await sql.transaction((txn) => [
      txn.query(UPDATE_STATE_SQL, updateStateArgs(cardId, plan, sessionId, uid)),
      txn.query(
        INSERT_REVIEW_SQL,
        insertReviewArgs(uid, cardId, sessionId, plan, {
          thinkMs: thinkMs.value,
          totalMs: totalMs.value,
        })
      ),
      txn`
        UPDATE fc_sessions
        SET completed_count = LEAST(
          planned_count,
          completed_count + CASE WHEN ${!context.already_reviewed} THEN 1 ELSE 0 END
        )
        WHERE id = ${sessionId} AND user_id = ${uid}
        RETURNING completed_count, planned_count
      `,
    ]);

    return res.status(200).json({
      card_id: cardId,
      already_reviewed: context.already_reviewed,
      state: plan.after,
      struggle_score: plan.struggleScore,
      avg_think_ms: plan.avgThinkMs,
      preview: previewFor(plan.after, now, settings),
      completed_count: sessionRows?.[0]?.completed_count ?? null,
      planned_count: sessionRows?.[0]?.planned_count ?? null,
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/sessions/:id/review", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
