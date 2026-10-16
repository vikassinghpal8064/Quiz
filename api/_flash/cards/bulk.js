import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  CREATE_CARD_SQL,
  MAX_BULK_CARDS,
  createCardArgs,
  flashUserId,
  optionalString,
  parsePositiveInt,
  sendMissingFlashTable,
  validateCardType,
  validateSide,
  validateTags,
} from "../../_lib/flashCards.js";

// POST /api/flash/cards/bulk   body { cards: [...], category_id? }
//
// Inserts up to MAX_BULK_CARDS cards in a single transaction. Every card is
// validated before the database is touched, so one bad row cannot leave a
// partial import behind. Each insert creates the card and its fc_card_state
// row together (see CREATE_CARD_SQL). A top-level category_id is used as the
// fallback for any card that does not carry its own.
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
    const { cards, category_id: rawFallback } = req.body ?? {};

    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: "cards must be a non-empty array" });
    }
    if (cards.length > MAX_BULK_CARDS) {
      return res.status(400).json({ error: `cards must contain at most ${MAX_BULK_CARDS} items` });
    }

    let fallbackCategoryId = null;
    if (rawFallback !== undefined && rawFallback !== null && rawFallback !== "") {
      const parsed = parsePositiveInt(rawFallback, "category_id");
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      fallbackCategoryId = parsed.value;
    }

    // Validate every card up front.
    const prepared = [];
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i] ?? {};
      const label = `cards[${i}]`;

      const category = parsePositiveInt(card.category_id ?? fallbackCategoryId, "category_id");
      if (category.error) return res.status(400).json({ error: `${label}: ${category.error}` });

      const cardType = validateCardType(card.card_type);
      if (cardType.error) return res.status(400).json({ error: `${label}: ${cardType.error}` });

      const front = validateSide(card.front, "front");
      if (front.error) return res.status(400).json({ error: `${label}: ${front.error}` });

      const back = validateSide(card.back, "back");
      if (back.error) return res.status(400).json({ error: `${label}: ${back.error}` });

      const tags = validateTags(card.tags);
      if (tags.error) return res.status(400).json({ error: `${label}: ${tags.error}` });

      const source = optionalString(card.source, "source", 200);
      if (source.error) return res.status(400).json({ error: `${label}: ${source.error}` });

      const sourceRef = optionalString(card.source_ref, "source_ref", 200);
      if (sourceRef.error) return res.status(400).json({ error: `${label}: ${sourceRef.error}` });

      prepared.push({
        categoryId: category.value,
        cardType: cardType.value,
        front: front.value,
        back: back.value,
        tags: tags.value,
        source: source.value,
        sourceRef: sourceRef.value,
      });
    }

    // Every target category must exist and belong to the caller. Checking once
    // for all distinct ids keeps this to a single extra round trip.
    const categoryIds = [...new Set(prepared.map((card) => card.categoryId))];
    const found = await sql`
      SELECT id FROM fc_categories
      WHERE id = ANY(${categoryIds}) AND user_id = ${uid}
    `;
    const foundIds = new Set(found.map((row) => row.id));
    const missing = categoryIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return res.status(404).json({ error: `category not found: ${missing.join(", ")}` });
    }

    // One transaction, one HTTP round trip: every statement is sent together,
    // and any failure rolls the whole batch back.
    const results = await sql.transaction((txn) =>
      prepared.map((card) => txn.query(CREATE_CARD_SQL, createCardArgs(uid, card)))
    );

    const created = results.map((rows) => rows[0]);
    return res.status(201).json({ inserted: created.length, cards: created });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("POST /api/flash/cards/bulk", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
