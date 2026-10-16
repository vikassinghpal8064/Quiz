import { requireAuth } from "../../../_lib/auth.js";
import { flashUserId, parsePositiveInt, sendMissingFlashTable } from "../../../_lib/flashCards.js";
import { performReview } from "../../../_lib/flashReview.js";

// POST /api/flash/sessions/:id/review
//
// Body: { card_id, rating, think_ms?, total_ms?, is_echo? }
//
// Thin wrapper: the session id comes from the path, then the shared core
// (api/_lib/flashReview.js) does the scheduling and the one-transaction write.
// Kept alongside POST /api/flash/reviews, which takes the session id in the
// body instead.
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

    const { status, json } = await performReview({
      uid,
      sessionId: id.value,
      body: req.body ?? {},
    });
    return res.status(status).json(json);
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/sessions/:id/review", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
