import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";
import { CATEGORY_CARD_FRONTS_SQL, categoryFrontsArgs, signaturesFromFronts } from "../../_lib/flashImport.js";

// GET /api/flash/import/duplicates?categoryId=
//
// The signatures of every card already in a target category, so the import
// wizard can flag a row it is about to send as "you already have this".
//
// The normalisation lives in src/modules/flashcards/importers/signature.js and
// is imported here rather than reimplemented, so the browser and the server
// cannot disagree about what counts as the same front. Blank fronts are dropped
// server-side too: an empty signature matches everything.
//
// Scoped to the caller: a category that belongs to someone else is a 404.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.categoryId, "categoryId");
    if (id.error) return res.status(400).json({ error: id.error });

    const [category, fronts] = await sql.transaction((txn) => [
      txn`
        SELECT id, name FROM fc_categories
        WHERE id = ${id.value} AND user_id = ${uid}
      `,
      txn.query(CATEGORY_CARD_FRONTS_SQL, categoryFrontsArgs(id.value, uid)),
    ]);

    if (!category.length) {
      return res.status(404).json({ error: "category not found" });
    }

    return res.status(200).json({
      category_id: category[0].id,
      category_name: category[0].name,
      signatures: signaturesFromFronts(fronts),
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET /api/flash/import/duplicates", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
