import { requireAuth } from "../../_lib/auth.js";
import { flashUserId, parsePositiveInt, sendMissingFlashTable } from "../../_lib/flashCards.js";
import { performReview } from "../../_lib/flashReview.js";

// POST /api/flash/reviews
//
// Body: { session_id, card_id, rating, think_ms?, total_ms?, is_echo? }
//
// The flat review endpoint: everything the answer needs travels in the body, so
// a client can queue a review offline and flush it later without having to
// remember which session URL it belonged to. The session id is validated here,
// then the shared core (api/_lib/flashReview.js) runs the scheduler and writes
// the state update, the review log and the completed counter in one
// transaction, returning the card's new due date.
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
    const body = req.body ?? {};
    const session = parsePositiveInt(body.session_id, "session_id");
    if (session.error) return res.status(400).json({ error: session.error });

    const { status, json } = await performReview({ uid, sessionId: session.value, body });
    return res.status(status).json(json);
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/reviews", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
