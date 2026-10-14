import sql from "../../_lib/db.js";
import { requireAccess } from "../../_lib/auth.js";

// GET /api/categories/:id/summary
//
// Everything the quiz-intro screen needs, in one round trip. It returns the
// same fields as GET /api/categories/:id (category fields, question_count,
// attempt_count, best_score, recent_attempts) plus three counts that used to
// require separate endpoints:
//
//   wrong_count   - questions with a wrong answer in the caller's latest attempt
//   starred_count - the caller's starred questions in this category
//   new_count     - questions the caller never attempted and never starred
//
// The individual endpoints (wrong-questions, starred-questions, new-questions)
// still exist and are unchanged: quiz-taking needs the full question bodies.
// This is only a lighter aggregate for the intro screen, which previously
// downloaded every wrong/starred/new question just to display their lengths.
//
// All seven statements are independent, so a single sql.transaction() batches
// them into one HTTP round trip to Neon. Everything user-specific is scoped to
// req.user.id and can never leak to another account.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Reads: any signed-in user.
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

    const [rows, stats, recentAttempts, wrong, starred, fresh] =
      await sql.transaction((txn) => [
        txn`
          SELECT c.*, count(q.id)::int AS question_count
          FROM categories c
          LEFT JOIN questions q ON q.category_id = c.id
          WHERE c.id = ${catId}
          GROUP BY c.id
        `,
        txn`
          SELECT
            count(*)::int AS attempt_count,
            max(score)::int AS best_score
          FROM quiz_attempts
          WHERE category_id = ${catId}
            AND finished_at IS NOT NULL
            AND user_id = ${user.id}
        `,
        txn`
          SELECT id, mode, score, total_questions, finished_at
          FROM quiz_attempts
          WHERE category_id = ${catId}
            AND finished_at IS NOT NULL
            AND user_id = ${user.id}
          ORDER BY finished_at DESC
          LIMIT 10
        `,
        // Same per-question rule as GET /categories/:id/wrong-questions, but
        // only the count is needed here.
        txn`
          WITH latest_answers AS (
            SELECT DISTINCT ON (aa.question_id, aa.attempt_id)
              aa.question_id,
              aa.attempt_id,
              aa.is_correct
            FROM attempt_answers aa
            JOIN questions q       ON q.id  = aa.question_id
            JOIN quiz_attempts qa  ON qa.id = aa.attempt_id
            WHERE q.category_id = ${catId}
              AND qa.user_id = ${user.id}
            ORDER BY aa.question_id, aa.attempt_id, aa.id DESC
          )
          SELECT count(*)::int AS c
          FROM (
            SELECT question_id
            FROM latest_answers
            GROUP BY question_id
            HAVING count(*) FILTER (WHERE is_correct = false) > 0
          ) t
        `,
        txn`
          SELECT count(*)::int AS c
          FROM starred_questions
          WHERE category_id = ${catId}
            AND user_id = ${user.id}
        `,
        // Same "new" rule as GET /categories/:id/new-questions.
        txn`
          SELECT count(*)::int AS c
          FROM questions
          WHERE category_id = ${catId}
            AND id NOT IN (
              SELECT aa.question_id
              FROM attempt_answers aa
              JOIN quiz_attempts qa ON qa.id = aa.attempt_id
              WHERE qa.user_id = ${user.id}
            )
            AND id NOT IN (
              SELECT sq.question_id
              FROM starred_questions sq
              WHERE sq.category_id = ${catId}
                AND sq.user_id = ${user.id}
            )
        `,
      ]);

    if (!rows.length) {
      return res.status(404).json({ error: "category not found" });
    }

    return res.status(200).json({
      ...rows[0],
      question_count: rows[0].question_count ?? 0,
      attempt_count: stats[0].attempt_count ?? 0,
      best_score: stats[0].best_score,
      recent_attempts: recentAttempts,
      wrong_count: wrong[0].c ?? 0,
      starred_count: starred[0].c ?? 0,
      new_count: fresh[0].c ?? 0,
    });
  } catch (err) {
    console.error("GET /api/categories/:id/summary", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
