import sql from "../_lib/db.js";
import { requireAccess } from "../_lib/auth.js";

// Kept in sync with the client's chunk size (see AdminUpload.jsx). The client
// stays well under this, and the cap protects the function from a single
// oversized payload.
const MAX_BATCH_SIZE = 200;

// Bulk insert for the CSV uploader.
//
// Why this exists: the CSV flow used to POST one question per request. For a
// few hundred rows that is a few hundred browser -> serverless invocations,
// each with its own Neon round trip, so the upload was dominated by latency
// and took minutes. This handler inserts a whole batch in a single request.
//
// It reuses the exact same INSERT ... CTE as POST /api/questions (one
// statement creates the question and its four options), run once per question
// inside a single sql.transaction(). That batches every statement into one
// HTTP round trip while keeping the id -> options mapping exact, and makes the
// batch all-or-nothing: if any row is invalid the transaction rolls back and
// nothing is written.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Writes are admin-only; requireAccess sends the 401/403 itself.
  const user = requireAccess(req, res);
  if (!user) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { questions, category_id: fallbackCategoryId } = req.body ?? {};

    if (!Array.isArray(questions) || questions.length === 0) {
      return res
        .status(400)
        .json({ error: "questions must be a non-empty array" });
    }

    if (questions.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `questions must contain at most ${MAX_BATCH_SIZE} items`,
      });
    }

    // Validate everything before touching the database, so an invalid row in
    // the middle of a batch cannot leave a partial insert behind.
    const prepared = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] ?? {};
      const label = `questions[${i}]`;

      const rawCategoryId = q.category_id ?? fallbackCategoryId;
      const categoryId = Number(rawCategoryId);
      // Matches POST /api/questions: a falsy category_id (missing, null, 0,
      // "") is rejected rather than coerced to 0.
      if (!rawCategoryId || Number.isNaN(categoryId)) {
        return res
          .status(400)
          .json({ error: `${label}: category_id must be a number` });
      }

      if (
        !q.question_text ||
        typeof q.question_text !== "string" ||
        !q.question_text.trim()
      ) {
        return res
          .status(400)
          .json({ error: `${label}: question_text is required` });
      }

      if (!Array.isArray(q.options) || q.options.length !== 4) {
        return res
          .status(400)
          .json({ error: `${label}: options must be an array of exactly 4 items` });
      }

      for (const opt of q.options) {
        if (
          !opt ||
          !opt.option_text ||
          typeof opt.option_text !== "string" ||
          !opt.option_text.trim()
        ) {
          return res
            .status(400)
            .json({ error: `${label}: each option must have non-empty option_text` });
        }
      }

      const correctCount = q.options.filter((o) => o.is_correct === true).length;
      if (correctCount !== 1) {
        return res
          .status(400)
          .json({ error: `${label}: exactly one option must have is_correct = true` });
      }

      prepared.push({
        categoryId,
        questionText: q.question_text.trim(),
        explanation: q.explanation ?? null,
        imageUrl: q.image_url ?? null,
        options: q.options.map((o) => ({
          option_text: o.option_text.trim(),
          is_correct: o.is_correct === true,
        })),
      });
    }

    // One transaction, one HTTP request: every statement is sent together and
    // the driver returns one result array per statement, in order.
    const results = await sql.transaction((txn) =>
      prepared.map((q) =>
        txn.query(
          `WITH new_q AS (
             INSERT INTO questions (category_id, question_text, explanation, image_url)
             VALUES ($1, $2, $3, $4)
             RETURNING id
           )
           INSERT INTO options (question_id, option_text, is_correct)
           SELECT new_q.id, v.option_text, v.is_correct
           FROM new_q
           CROSS JOIN (VALUES ${q.options
             .map((_, i) => `($${5 + i * 2}, $${5 + i * 2 + 1}::boolean)`)
             .join(", ")}) AS v(option_text, is_correct)
           RETURNING *`,
          [
            q.categoryId,
            q.questionText,
            q.explanation,
            q.imageUrl,
            ...q.options.flatMap((o) => [o.option_text, o.is_correct]),
          ]
        )
      )
    );

    const created = results.map((rows, i) => {
      const optionRows = rows ?? [];
      return {
        id: optionRows[0]?.question_id ?? null,
        category_id: prepared[i].categoryId,
        question_text: prepared[i].questionText,
        explanation: prepared[i].explanation,
        image_url: prepared[i].imageUrl,
        options: optionRows,
      };
    });

    return res.status(201).json({ inserted: created.length, questions: created });
  } catch (err) {
    console.error("POST /api/questions/bulk", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
