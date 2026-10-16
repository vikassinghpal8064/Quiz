import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  CREATE_CARD_SQL,
  MAX_CARD_SEARCH,
  MAX_TAG_LENGTH,
  REPLACE_CARD_MEDIA_SQL,
  createCardArgs,
  escapeLike,
  flashUserId,
  mediaRowsFromSides,
  optionalInt,
  optionalString,
  parsePositiveInt,
  replaceCardMediaArgs,
  sendMissingFlashTable,
  validateCardType,
  validateSide,
  validateTags,
} from "../../_lib/flashCards.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET  /api/flash/cards?categoryId=&q=&tag=&limit=&cursor=
// POST /api/flash/cards
//
// GET is keyset-paginated (newest id first) and searchable. `cursor` is the id
// of the last card from the previous page; the response carries nextCursor
// (null on the last page). Searching only looks at the text blocks, not the
// raw JSON, so a query for "text" does not match every card's block type.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  try {
    if (req.method === "GET") {
      const params = [uid];
      const where = ["c.user_id = $1"];

      const { categoryId, q, tag, limit: rawLimit, cursor } = req.query ?? {};

      if (categoryId !== undefined && categoryId !== "") {
        const cat = parsePositiveInt(categoryId, "categoryId");
        if (cat.error) return res.status(400).json({ error: cat.error });
        params.push(cat.value);
        where.push(`c.category_id = $${params.length}`);
      }

      if (tag !== undefined && String(tag).trim() !== "") {
        const value = String(tag).trim();
        if (value.length > MAX_TAG_LENGTH) {
          return res.status(400).json({ error: `tag must be at most ${MAX_TAG_LENGTH} characters` });
        }
        params.push(value);
        where.push(`c.tags @> ARRAY[$${params.length}]::text[]`);
      }

      if (q !== undefined && String(q).trim() !== "") {
        const value = String(q).trim();
        if (value.length > MAX_CARD_SEARCH) {
          return res.status(400).json({ error: `q must be at most ${MAX_CARD_SEARCH} characters` });
        }
        params.push(`%${escapeLike(value)}%`);
        const placeholder = `$${params.length}`;
        const textSide = (column) => `EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(${column}->'blocks') = 'array'
                 THEN ${column}->'blocks' ELSE '[]'::jsonb END
          ) b
          WHERE COALESCE(b->>'text', '') ILIKE ${placeholder}
        )`;
        where.push(
          `(${textSide("c.front")} OR ${textSide("c.back")} OR array_to_string(c.tags, ' ') ILIKE ${placeholder})`
        );
      }

      if (cursor !== undefined && cursor !== "") {
        const cur = parsePositiveInt(cursor, "cursor");
        if (cur.error) return res.status(400).json({ error: cur.error });
        params.push(cur.value);
        where.push(`c.id < $${params.length}`);
      }

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== undefined && rawLimit !== "") {
        const parsed = optionalInt(rawLimit, "limit", { min: 1, max: MAX_LIMIT });
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        limit = parsed.value ?? DEFAULT_LIMIT;
      }

      // Fetch one extra row to learn whether another page exists.
      params.push(limit + 1);
      const rows = await sql.query(
        `SELECT c.*,
                s.state, s.due, s.reps, s.lapses, s.stability, s.difficulty
         FROM fc_cards c
         LEFT JOIN fc_card_state s ON s.card_id = c.id
         WHERE ${where.join(" AND ")}
         ORDER BY c.id DESC
         LIMIT $${params.length}`,
        params
      );

      const hasMore = rows.length > limit;
      const cards = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? cards[cards.length - 1].id : null;

      return res.status(200).json({ cards, nextCursor });
    }

    if (req.method === "POST") {
      const body = req.body ?? {};

      const category = parsePositiveInt(body.category_id, "category_id");
      if (category.error) return res.status(400).json({ error: category.error });

      const cardType = validateCardType(body.card_type);
      if (cardType.error) return res.status(400).json({ error: cardType.error });

      const front = validateSide(body.front, "front");
      if (front.error) return res.status(400).json({ error: front.error });

      const back = validateSide(body.back, "back");
      if (back.error) return res.status(400).json({ error: back.error });

      const tags = validateTags(body.tags);
      if (tags.error) return res.status(400).json({ error: tags.error });

      const source = optionalString(body.source, "source", 200);
      if (source.error) return res.status(400).json({ error: source.error });

      const sourceRef = optionalString(body.source_ref, "source_ref", 200);
      if (sourceRef.error) return res.status(400).json({ error: sourceRef.error });

      // Friendly pre-check; the FK on fc_cards.category_id would also reject a
      // bad id, but this returns a clear 404 instead of a 500.
      const categoryRow = await sql`
        SELECT id FROM fc_categories WHERE id = ${category.value} AND user_id = ${uid}
      `;
      if (!categoryRow.length) {
        return res.status(404).json({ error: "category not found" });
      }

      const rows = await sql.query(
        CREATE_CARD_SQL,
        createCardArgs(uid, {
          categoryId: category.value,
          cardType: cardType.value,
          front: front.value,
          back: back.value,
          tags: tags.value,
          source: source.value,
          sourceRef: sourceRef.value,
        })
      );

      const card = rows[0];

      // Mirror the card's image / audio blocks into fc_media. A brand-new card
      // owns no blob yet, so there is nothing to delete first; the CTE still
      // runs the (empty) delete and the insert in one round trip.
      const mediaRows = mediaRowsFromSides(card.front, card.back);
      if (mediaRows.length) {
        await sql.query(REPLACE_CARD_MEDIA_SQL, replaceCardMediaArgs(card.id, uid, mediaRows));
      }

      return res.status(201).json(card);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/POST /api/flash/cards", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
