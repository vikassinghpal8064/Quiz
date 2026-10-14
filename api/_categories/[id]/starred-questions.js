import sql from "../../_lib/db.js";
import { requireAccess } from "../../_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Reads: any signed-in user. Writes (POST/PATCH/PUT/DELETE): admin only.
  const user = requireAccess(req, res);
  if (!user) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id } = req.query;
    const catId = Number(id);

    if (Number.isNaN(catId)) {
      return res.status(400).json({ error: "category id must be a number" });
    }

    const starred = await sql`
      SELECT sq.id, sq.question_id, sq.category_id, sq.starred_at
      FROM starred_questions sq
      WHERE sq.category_id = ${catId}
        AND sq.user_id = ${user.id}
      ORDER BY sq.starred_at DESC, sq.id DESC
    `;

    const result = {
      count: starred.length,
      starred_questions: starred.map((r) => ({
        id: r.id,
        question_id: Number(r.question_id),
        category_id: Number(r.category_id),
        starred_at: r.starred_at,
      })),
    };

    if (!starred.length) {
      return res.status(200).json(result);
    }

    const ids = starred.map((r) => r.question_id);
    const questions = await sql`
      SELECT q.*, COALESCE(
        (SELECT json_agg(row_to_json(o) ORDER BY o.id)
         FROM options o WHERE o.question_id = q.id),
        '[]'::json
      ) AS options
      FROM questions q
      WHERE q.id = ANY(${ids})
    `;

    result.questions = questions.map((q) => ({
      ...q,
      options: q.options ?? [],
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("GET /api/categories/:id/starred-questions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}