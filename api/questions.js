import sql from "./_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      const { categoryId, questionIds } = req.query;

      if (!categoryId && !questionIds) {
        return res
          .status(400)
          .json({ error: "categoryId or questionIds query param is required" });
      }

      let questionFilter;
      if (questionIds) {
        const ids = questionIds
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n));

        if (ids.length === 0) {
          return res.status(400).json({ error: "questionIds must be numbers" });
        }

        questionFilter = sql`
          SELECT * FROM questions
          WHERE id = ANY(${ids})
          ORDER BY id
        `;
      } else {
        const id = Number(categoryId);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: "categoryId must be a number" });
        }

        questionFilter = sql`
          SELECT * FROM questions
          WHERE category_id = ${id}
          ORDER BY created_at DESC
        `;
      }

      const questions = await questionFilter;

      if (!questions.length) {
        return res.status(200).json([]);
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

      const result = questions.map((q) => ({
        ...q,
        options: optionsByQuestion[q.id] ?? [],
      }));

      return res.status(200).json(result);
    }

    if (req.method === "POST") {
      const { category_id, question_text, explanation, image_url, options } =
        req.body ?? {};

      if (!category_id || !question_text) {
        return res
          .status(400)
          .json({ error: "category_id and question_text are required" });
      }

      if (!Array.isArray(options) || options.length !== 4) {
        return res
          .status(400)
          .json({ error: "options must be an array of exactly 4 items" });
      }

      const catId = Number(category_id);
      if (Number.isNaN(catId)) {
        return res.status(400).json({ error: "category_id must be a number" });
      }

      const correctCount = options.filter((o) => o.is_correct === true).length;
      if (correctCount !== 1) {
        return res
          .status(400)
          .json({ error: "exactly one option must have is_correct = true" });
      }

      for (const opt of options) {
        if (!opt.option_text || typeof opt.option_text !== "string" || !opt.option_text.trim()) {
          return res.status(400).json({ error: "each option must have non-empty option_text" });
        }
      }

      const insertedOptions = await sql.query(
        `WITH new_q AS (
           INSERT INTO questions (category_id, question_text, explanation, image_url)
           VALUES ($1, $2, $3, $4)
           RETURNING id
         )
         INSERT INTO options (question_id, option_text, is_correct)
         SELECT new_q.id, v.option_text, v.is_correct
         FROM new_q
         CROSS JOIN (VALUES ${options
           .map((_, i) => `($${5 + i * 2}, $${5 + i * 2 + 1}::boolean)`)
           .join(", ")}) AS v(option_text, is_correct)
         RETURNING *`,
        [
          catId,
          question_text.trim(),
          explanation ?? null,
          image_url ?? null,
          ...options.flatMap((o) => [o.option_text.trim(), o.is_correct === true]),
        ]
      );

      const created = insertedOptions[0];
      return res.status(201).json({
        id: created.question_id,
        category_id: catId,
        question_text: question_text.trim(),
        explanation: explanation ?? null,
        image_url: image_url ?? null,
        created_at: new Date().toISOString(),
        options: insertedOptions,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("GET/POST /api/questions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
