import sql from "../_lib/db.js";
import { requireAuth } from "../_lib/auth.js";
import { sendMissingTable } from "../_lib/featureTables.js";

// GET /api/questions/meta?questionIds=1,2,3
//
// Returns the CALLER'S OWN flag and difficulty for each requested question, so
// the quiz-taking and results screens can render the flag icon "filled" and the
// selected difficulty chip on load.
//
// This is a new endpoint on purpose: the response shape of the existing
// GET /api/questions is unchanged. Per-user data is scoped to req.user.id, so
// it can never leak to another user.
//
// Response:
//   { "12": { flagged: true,  flag: { reason, comment, status }, difficulty: "hard" },
//     "13": { flagged: false, flag: null,                         difficulty: null } }
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const raw = req.query.questionIds;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "questionIds query param is required" });
    }

    const ids = [...new Set(
      raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
    )];

    if (!ids.length) {
      return res.status(400).json({ error: "questionIds must be numbers" });
    }

    // Flags and difficulty tags are independent reads, so one transaction
    // batches them into a single round trip.
    const [flags, tags] = await sql.transaction((txn) => [
      txn`
        SELECT question_id, reason, comment, status
        FROM flagged_questions
        WHERE user_id = ${user.id} AND question_id = ANY(${ids})
      `,
      txn`
        SELECT question_id, difficulty
        FROM question_difficulty_tags
        WHERE user_id = ${user.id} AND question_id = ANY(${ids})
      `,
    ]);

    const flagsById = new Map(flags.map((f) => [Number(f.question_id), f]));
    const tagsById = new Map(tags.map((t) => [Number(t.question_id), t.difficulty]));

    const meta = {};
    for (const id of ids) {
      const flag = flagsById.get(id) ?? null;
      meta[String(id)] = {
        flagged: Boolean(flag),
        flag: flag
          ? { reason: flag.reason, comment: flag.comment, status: flag.status }
          : null,
        difficulty: tagsById.get(id) ?? null,
      };
    }

    return res.status(200).json(meta);
  } catch (err) {
    if (sendMissingTable(res, err)) return;
    console.error("GET /api/questions/meta", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
