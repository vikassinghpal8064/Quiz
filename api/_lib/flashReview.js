// Shared core for recording one flash-card review.
//
// Two routes funnel through here so the scheduling rules live in exactly one
// place:
//
//   POST /api/flash/sessions/:id/review   (session id in the path)
//   POST /api/flash/reviews               (session id in the body)
//
// Lives in api/_lib/ on purpose: shared library, not a route, so it is excluded
// from the router / function-count checks in scripts/verify_routing.mjs.
//
// Body: { card_id, rating, think_ms?, total_ms?, is_echo? }
//
// The next scheduler state is computed on the server from the current
// fc_card_state row (never trusted from the client). The state update, the
// append-only review log and the session's completed counter are then written
// in ONE transaction. `is_echo` marks a repeat answer of a card already met in
// this session; it is logged but never moves the completed counter again.

import sql from "./db.js";
import { optionalBool, optionalInt, parsePositiveInt } from "./flashCards.js";
import {
  INSERT_REVIEW_SQL,
  REVIEW_CONTEXT_SQL,
  UPDATE_STATE_SQL,
  insertReviewArgs,
  loadSettings,
  planReview,
  previewFor,
  updateStateArgs,
} from "./flashStudy.js";

// One hour is far longer than any real answer; a larger think_ms is a bad
// client clock, not data worth storing.
export const MAX_REVIEW_MS = 3_600_000;

// Records one answer and returns { status, json }. Callers own the HTTP
// response so this stays reusable from any route shape.
export async function performReview({ uid, sessionId, body = {} }) {
  const card = parsePositiveInt(body.card_id, "card_id");
  if (card.error) return { status: 400, json: { error: card.error } };
  const cardId = card.value;

  const thinkMs = optionalInt(body.think_ms, "think_ms", { min: 0, max: MAX_REVIEW_MS });
  if (thinkMs.error) return { status: 400, json: { error: thinkMs.error } };

  const totalMs = optionalInt(body.total_ms, "total_ms", { min: 0, max: MAX_REVIEW_MS });
  if (totalMs.error) return { status: 400, json: { error: totalMs.error } };

  const isEcho = optionalBool(body.is_echo, "is_echo");
  if (isEcho.error) return { status: 400, json: { error: isEcho.error } };

  const session = await sql`
    SELECT id, finished_at FROM fc_sessions WHERE id = ${sessionId} AND user_id = ${uid}
  `;
  if (!session.length) {
    return { status: 404, json: { error: "session not found" } };
  }
  if (session[0].finished_at) {
    return { status: 409, json: { error: "session is already finished" } };
  }

  const contextRows = await sql.query(REVIEW_CONTEXT_SQL, [cardId, uid, sessionId]);
  if (!contextRows.length) {
    return { status: 404, json: { error: "card not found" } };
  }
  const context = contextRows[0];
  if (!context.in_session) {
    return { status: 400, json: { error: "card is not part of this session" } };
  }

  const settings = await loadSettings(sql, uid);
  const now = new Date();

  let plan;
  try {
    plan = planReview({ context, rating: body.rating, thinkMs: thinkMs.value, now, settings });
  } catch (err) {
    return { status: 400, json: { error: err?.message ?? "Invalid rating" } };
  }

  // Default an unspecified echo flag to "was this card already answered in this
  // sitting?" - the same condition that has always guarded the counter.
  const echo = isEcho.value ?? context.already_reviewed;

  const [, , sessionRows] = await sql.transaction((txn) => [
    txn.query(UPDATE_STATE_SQL, updateStateArgs(cardId, plan, sessionId, uid)),
    txn.query(
      INSERT_REVIEW_SQL,
      insertReviewArgs(uid, cardId, sessionId, plan, {
        thinkMs: thinkMs.value,
        totalMs: totalMs.value,
        isEcho: echo,
      })
    ),
    txn`
      UPDATE fc_sessions
      SET completed_count = LEAST(
        planned_count,
        completed_count + CASE WHEN ${!context.already_reviewed && !echo} THEN 1 ELSE 0 END
      )
      WHERE id = ${sessionId} AND user_id = ${uid}
      RETURNING completed_count, planned_count
    `,
  ]);

  return {
    status: 200,
    json: {
      card_id: cardId,
      session_id: sessionId,
      rating: plan.rating,
      is_echo: echo,
      already_reviewed: context.already_reviewed,
      // The new due date is the headline of the response: the client advances
      // its local queue with it without re-reading the session.
      due: plan.after.due,
      state: plan.after,
      struggle_score: plan.struggleScore,
      avg_think_ms: plan.avgThinkMs,
      preview: previewFor(plan.after, now, settings),
      completed_count: sessionRows?.[0]?.completed_count ?? null,
      planned_count: sessionRows?.[0]?.planned_count ?? null,
    },
  };
}
