import sql from "../../_lib/db.js";
import { requireAdmin } from "../../_lib/auth.js";

// POST /api/admin/questions/move   body { question_ids: [...], target_category_id }
//
// Admin-only. Moves one or more questions to another category in ONE
// transaction:
//   1. questions.category_id
//   2. starred_questions.category_id   (so a star follows its question)
// Any failure rolls the whole thing back.
//
// This is the one place the app intentionally updates existing rows (the move
// the user triggered). Attempt history - quiz_attempts / attempt_answers - is
// never rewritten or deleted.
//
// Cache: there is no Redis/KV/cache layer in this project (nothing to
// invalidate). If one is ever added, invalidate the source and target
// category keys here.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question_ids, target_category_id } = req.body ?? {};

    if (!Array.isArray(question_ids) || question_ids.length === 0) {
      return res
        .status(400)
        .json({ error: "question_ids must be a non-empty array" });
    }

    const ids = [...new Set(question_ids.map(Number))];
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
      return res.status(400).json({ error: "question_ids must be positive integers" });
    }

    const targetId = Number(target_category_id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "target_category_id must be a number" });
    }

    // Friendly pre-check. The FK on questions.category_id would also abort the
    // transaction by itself, but this gives a clear 400 instead of a 500.
    const target = await sql`SELECT id, name FROM categories WHERE id = ${targetId}`;
    if (!target.length) {
      return res.status(404).json({ error: "target category not found" });
    }

    const existing = await sql`
      SELECT id, category_id, question_text FROM questions WHERE id = ANY(${ids})
    `;

    const [movedRows, starredRows] = await sql.transaction((txn) => [
      txn`UPDATE questions
            SET category_id = ${targetId}
          WHERE id = ANY(${ids})
          RETURNING id`,
      txn`UPDATE starred_questions
            SET category_id = ${targetId}
          WHERE question_id = ANY(${ids})
          RETURNING id`,
    ]);

    return res.status(200).json({
      moved: movedRows.length,
      starred_updated: starredRows.length,
      target_category_id: targetId,
      target_category_name: target[0].name,
      question_ids: existing.map((q) => q.id),
    });
  } catch (err) {
    // A vanished target category (deleted between the check and the UPDATE)
    // trips the foreign key; the transaction has already rolled back.
    if (err?.code === "23503") {
      return res.status(400).json({ error: "target category does not exist" });
    }
    console.error("POST /api/admin/questions/move", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
