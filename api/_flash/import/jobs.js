import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";
import {
  validateCount,
  validateErrorLog,
  validateFilename,
  validateSourceType,
} from "../../_lib/flashImport.js";

// GET  /api/flash/import/jobs?limit= - the caller's most recent import jobs
// POST /api/flash/import/jobs       - open a job before an import starts
//
// A job is the durable record of one import run. The wizard opens one before it
// starts POSTing batches and PATCHes it after each batch, so progress survives a
// reload and a failed run can be inspected afterwards (see jobs/[id].js).
//
// Scoped to the caller throughout: a job is never visible to anyone else.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  try {
    if (req.method === "GET") {
      let limit = DEFAULT_LIMIT;
      if (req.query?.limit !== undefined && req.query?.limit !== "") {
        const parsed = optionalInt(req.query.limit, "limit", { min: 1, max: MAX_LIMIT });
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        limit = parsed.value ?? DEFAULT_LIMIT;
      }

      const rows = await sql`
        SELECT j.id, j.user_id, j.source_type, j.filename, j.category_id,
               j.status, j.total, j.created, j.error_log, j.created_at,
               c.name AS category_name
        FROM fc_import_jobs j
        LEFT JOIN fc_categories c ON c.id = j.category_id AND c.user_id = j.user_id
        WHERE j.user_id = ${uid}
        ORDER BY j.id DESC
        LIMIT ${limit}
      `;
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};

      const sourceType = validateSourceType(body.source_type);
      if (sourceType.error) return res.status(400).json({ error: sourceType.error });

      const filename = validateFilename(body.filename);
      if (filename.error) return res.status(400).json({ error: filename.error });

      const total = validateCount(body.total, "total");
      if (total.error) return res.status(400).json({ error: total.error });

      const errors = validateErrorLog(body.error_log);
      if (errors.error) return res.status(400).json({ error: errors.error });

      let categoryId = null;
      if (body.category_id !== undefined && body.category_id !== null && body.category_id !== "") {
        const parsed = parsePositiveInt(body.category_id, "category_id");
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        categoryId = parsed.value;
      }

      // The category must exist and belong to the caller: the column is an FK,
      // and a job is private to the account that ran it.
      if (categoryId !== null) {
        const category = await sql`
          SELECT id FROM fc_categories WHERE id = ${categoryId} AND user_id = ${uid}
        `;
        if (!category.length) {
          return res.status(404).json({ error: "category not found" });
        }
      }

      const rows = await sql`
        INSERT INTO fc_import_jobs (user_id, source_type, filename, category_id, status, total, created, error_log)
        VALUES (${uid}, ${sourceType.value}, ${filename.value}, ${categoryId}, 'pending', ${total.value ?? 0}, 0, ${JSON.stringify(errors.value ?? [])}::jsonb)
        RETURNING *
      `;

      return res.status(201).json(rows[0]);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/POST /api/flash/import/jobs", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
