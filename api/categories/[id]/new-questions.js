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

    const category = await sql`SELECT id FROM categories WHERE id = ${catId}`;
    if (!category.length) {
      return res.status(404).json({ error: "category not found" });
    }

    const questions = await sql`
      SELECT * FROM questions
      WHERE category_id = ${catId}
        AND id NOT IN (
          SELECT aa.question_id
          FROM attempt_answers aa
          JOIN quiz_attempts qa ON qa.id = aa.attempt_id
          WHERE qa.category_id = ${catId}
            AND qa.user_id = ${user.id}
        )
        AND id NOT IN (
          SELECT sq.question_id
          FROM starred_questions sq
          WHERE sq.category_id = ${catId}
            AND sq.user_id = ${user.id}
        )
      ORDER BY id
    `;

    const result = {
      count: questions.length,
      questions: [],
    };

    if (!questions.length) {
      return res.status(200).json(result);
    }

    const ids = questions.map((q) => q.id);
    const options = await sql`
      SELECT * FROM options
      WHERE question_id = ANY(${ids})
    `;

    const optionsByQuestion = {};
    for (const opt of options) {
      (optionsByQuestion[opt.question_id] ??= []).push(opt);
    }

    result.questions = questions.map((q) => ({
      ...q,
      options: optionsByQuestion[q.id] ?? [],
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("GET /api/categories/:id/new-questions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
