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

    // Category existence check and the question list are independent, so a
    // single transaction batches them into one round trip. Options are pulled
    // back with the rows via a correlated json_agg, which removes the third
    // query the endpoint used to make.
    const [category, questions] = await sql.transaction((txn) => [
      txn`SELECT id FROM categories WHERE id = ${catId}`,
      txn`
        SELECT q.*, COALESCE(
          (SELECT json_agg(row_to_json(o) ORDER BY o.id)
           FROM options o WHERE o.question_id = q.id),
          '[]'::json
        ) AS options
        FROM questions q
        WHERE q.category_id = ${catId}
          AND q.id NOT IN (
            SELECT aa.question_id
            FROM attempt_answers aa
            JOIN quiz_attempts qa ON qa.id = aa.attempt_id
            WHERE qa.user_id = ${user.id}
          )
          AND q.id NOT IN (
            SELECT sq.question_id
            FROM starred_questions sq
            WHERE sq.category_id = ${catId}
              AND sq.user_id = ${user.id}
          )
        ORDER BY q.id
      `,
    ]);

    if (!category.length) {
      return res.status(404).json({ error: "category not found" });
    }

    const result = {
      count: questions.length,
      questions: [],
    };

    if (!questions.length) {
      return res.status(200).json(result);
    }

    result.questions = questions.map((q) => ({
      ...q,
      options: q.options ?? [],
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("GET /api/categories/:id/new-questions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
