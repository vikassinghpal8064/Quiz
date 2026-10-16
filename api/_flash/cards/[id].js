import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  REPLACE_CARD_MEDIA_SQL,
  SELECT_CARD_MEDIA_URLS_SQL,
  flashUserId,
  mediaRowsFromSides,
  optionalBool,
  parsePositiveInt,
  replaceCardMediaArgs,
  sendMissingFlashTable,
  validateCardType,
  validateSide,
  validateTags,
} from "../../_lib/flashCards.js";
import { deleteUnreferencedBlobs } from "../../_lib/flashMedia.js";

// PATCH  /api/flash/cards/:id - edit content, retag, move or suspend one card
// DELETE /api/flash/cards/:id - delete a card (cascades to its state/media/logs)
//
// Scoped to the caller: a card that belongs to someone else is reported as 404,
// never edited. PATCH returns the card together with its scheduler state so the
// caller can refresh the row in place.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "PATCH" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.id, "card id");
    if (id.error) return res.status(400).json({ error: id.error });
    const cardId = id.value;

    if (req.method === "DELETE") {
      // Read the card's blob URLs before the delete: fc_media rows cascade away
      // with the card, so afterwards there is nothing left to look up. The blobs
      // themselves do not cascade, so they are removed from the store after.
      const mediaUrls = await sql.query(SELECT_CARD_MEDIA_URLS_SQL, [cardId, uid]);

      const deleted = await sql`
        DELETE FROM fc_cards
        WHERE id = ${cardId} AND user_id = ${uid}
        RETURNING id
      `;
      if (!deleted.length) {
        return res.status(404).json({ error: "card not found" });
      }

      // Best-effort: a Blob failure never fails the delete (the card is gone).
      await deleteUnreferencedBlobs(sql, mediaUrls.map((row) => row.url), uid);

      return res.status(200).json({ id: deleted[0].id, deleted: true });
    }

    // PATCH
    const body = req.body ?? {};
    const updates = [];
    const params = [];

    if (body.category_id !== undefined) {
      const category = parsePositiveInt(body.category_id, "category_id");
      if (category.error) return res.status(400).json({ error: category.error });

      const categoryRow = await sql`
        SELECT id FROM fc_categories WHERE id = ${category.value} AND user_id = ${uid}
      `;
      if (!categoryRow.length) {
        return res.status(404).json({ error: "category not found" });
      }
      params.push(category.value);
      updates.push(`category_id = $${params.length}`);
    }
    if (body.card_type !== undefined) {
      const cardType = validateCardType(body.card_type);
      if (cardType.error) return res.status(400).json({ error: cardType.error });
      params.push(cardType.value);
      updates.push(`card_type = $${params.length}`);
    }
    if (body.front !== undefined) {
      const front = validateSide(body.front, "front");
      if (front.error) return res.status(400).json({ error: front.error });
      params.push(JSON.stringify(front.value));
      updates.push(`front = $${params.length}::jsonb`);
    }
    if (body.back !== undefined) {
      const back = validateSide(body.back, "back");
      if (back.error) return res.status(400).json({ error: back.error });
      params.push(JSON.stringify(back.value));
      updates.push(`back = $${params.length}::jsonb`);
    }
    if (body.tags !== undefined) {
      const tags = validateTags(body.tags);
      if (tags.error) return res.status(400).json({ error: tags.error });
      params.push(tags.value);
      updates.push(`tags = $${params.length}::text[]`);
    }
    if (body.suspended !== undefined) {
      const suspended = optionalBool(body.suspended, "suspended");
      if (suspended.error) return res.status(400).json({ error: suspended.error });
      params.push(suspended.value ?? false);
      updates.push(`suspended = $${params.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: "nothing to update" });
    }

    params.push(cardId, uid);
    const idParam = params.length - 1;
    const userParam = params.length;

    const [updated, state] = await sql.transaction((txn) => [
      txn.query(
        `UPDATE fc_cards
            SET ${updates.join(", ")}, updated_at = now()
          WHERE id = $${idParam} AND user_id = $${userParam}
          RETURNING *`,
        params
      ),
      txn`
        SELECT state, due, reps, lapses, stability, difficulty
        FROM fc_card_state
        WHERE card_id = ${cardId}
      `,
    ]);

    if (!updated.length) {
      return res.status(404).json({ error: "card not found" });
    }

    // Media is derived from the block JSON, so only a front/back change can
    // change it. Resync fc_media and delete any blob the edit orphaned - the
    // old URLs are read before the rows are replaced.
    if (body.front !== undefined || body.back !== undefined) {
      const previousUrls = (await sql.query(SELECT_CARD_MEDIA_URLS_SQL, [cardId, uid])).map(
        (row) => row.url
      );
      const mediaRows = mediaRowsFromSides(updated[0].front, updated[0].back);
      await sql.query(REPLACE_CARD_MEDIA_SQL, replaceCardMediaArgs(cardId, uid, mediaRows));
      await deleteUnreferencedBlobs(sql, previousUrls, uid);
    }

    return res.status(200).json({ ...updated[0], ...(state[0] ?? {}) });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("PATCH/DELETE /api/flash/cards/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
