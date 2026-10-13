import sql from "../_lib/db.js";
import { requireAdmin } from "../_lib/auth.js";
import { sendMissingTable } from "../_lib/featureTables.js";

const DIFFICULTIES = ["easy", "medium", "hard"];

// GET /api/admin/questions
//
// Admin-only list with optional filters. This is a NEW endpoint; the existing
// GET /api/questions is untouched, so quizzes keep working exactly as before.
//
// Filters (all optional):
//   categoryId=<id>
//   starred=true            -> only questions the ADMIN starred
//   flagged=true            -> only questions with >= 1 open flag from anyone
//   difficulty=easy,hard    -> questions the ADMIN tagged easy OR hard
//
// Group logic: the difficulty values are OR-ed together; starred, flagged and
// the difficulty group are AND-ed with each other.
//
// Each row returns the question fields (plus options, same shape as
// GET /api/questions), plus:
//   is_starred    - the admin's own star
//   my_difficulty - the admin's own tag
//   flag_count    - open flags from ALL users
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { categoryId, starred, flagged, difficulty } = req.query;

    const params = [admin.id];
    const where = [];

    if (categoryId !== undefined && categoryId !== "") {
      const id = Number(categoryId);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "categoryId must be a number" });
      }
      params.push(id);
      where.push(`q.category_id = $${params.length}`);
    }

    if (starred === "true") {
      where.push(`sq.question_id IS NOT NULL`);
    }

    if (flagged === "true") {
      where.push(
        `EXISTS (SELECT 1 FROM flagged_questions f WHERE f.question_id = q.id AND f.status = 'open')`
      );
    }

    let diffs = [];
    if (difficulty !== undefined && difficulty !== "") {
      const tokens = String(difficulty)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const invalid = tokens.filter((t) => !DIFFICULTIES.includes(t));
      if (invalid.length) {
        return res.status(400).json({
          error: `difficulty must be a comma list of: ${DIFFICULTIES.join(", ")}`,
        });
      }
      diffs = [...new Set(tokens)];
      if (diffs.length) {
        const ors = diffs.map((d) => {
          params.push(d);
          return `dt.difficulty = $${params.length}`;
        });
        where.push(`(${ors.join(" OR ")})`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await sql.query(
      `SELECT q.*,
              (sq.question_id IS NOT NULL)                AS is_starred,
              dt.difficulty                               AS my_difficulty,
              COALESCE(fc.flag_count, 0)::int             AS flag_count
       FROM questions q
       LEFT JOIN starred_questions sq
              ON sq.question_id = q.id AND sq.user_id = $1
       LEFT JOIN question_difficulty_tags dt
              ON dt.question_id = q.id AND dt.user_id = $1
       LEFT JOIN (
         SELECT question_id, count(*) AS flag_count
         FROM flagged_questions
         WHERE status = 'open'
         GROUP BY question_id
       ) fc ON fc.question_id = q.id
       ${whereSql}
       ORDER BY q.id`,
      params
    );

    if (!rows.length) {
      return res.status(200).json([]);
    }

    const ids = rows.map((q) => q.id);
    const options = await sql`
      SELECT * FROM options WHERE question_id = ANY(${ids}) ORDER BY id
    `;
    const optionsByQuestion = {};
    for (const opt of options) {
      (optionsByQuestion[opt.question_id] ??= []).push(opt);
    }

    return res.status(200).json(
      rows.map((q) => ({
        ...q,
        is_starred: Boolean(q.is_starred),
        my_difficulty: q.my_difficulty ?? null,
        flag_count: Number(q.flag_count) || 0,
        options: optionsByQuestion[q.id] ?? [],
      }))
    );
  } catch (err) {
    if (sendMissingTable(res, err)) return;
    console.error("GET /api/admin/questions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
