import sql from "../../../_lib/db.js";
import { requireAuth } from "../../../_lib/auth.js";
import {
  flashUserId,
  parsePositiveInt,
  sendMissingFlashTable,
} from "../../../_lib/flashCards.js";
import {
  validateCount,
  validateErrorLog,
  validateFilename,
  validateJobStatus,
  validateSourceType,
} from "../../../_lib/flashImport.js";

// PATCH /api/flash/import/jobs/:id
//
// The wizard PATCHes this after every batch so the run's progress and any
// errors it hit are recorded as it goes, not only at the end. Only the fields
// present in the body are written, so a caller can bump `created` without
// resending the whole row.
//
// Scoped to the caller: someone else's job is a 404, never a 403 (the id is
// not a secret, but its existence is).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = parsePositiveInt(req.query?.id, "import job id");
    if (id.error) return res.status(400).json({ error: id.error });

    const body = req.body ?? {};

    // PATCH only writes the fields it is sent, so source_type is validated only
    // when present (POST is where it is required).
    let sourceType = { value: undefined };
    if (body.source_type !== undefined) {
      sourceType = validateSourceType(body.source_type);
      if (sourceType.error) return res.status(400).json({ error: sourceType.error });
    }

    const filename = validateFilename(body.filename);
    if (filename.error) return res.status(400).json({ error: filename.error });

    const status = validateJobStatus(body.status);
    if (status.error) return res.status(400).json({ error: status.error });

    const total = validateCount(body.total, "total");
    if (total.error) return res.status(400).json({ error: total.error });

    const created = validateCount(body.created, "created");
    if (created.error) return res.status(400).json({ error: created.error });

    const errors = validateErrorLog(body.error_log);
    if (errors.error) return res.status(400).json({ error: errors.error });

    // Build the SET list from what was actually sent, so a PATCH that only
    // moves `created` forward does not blank the other columns.
    const sets = [];
    const values = [];
    const push = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (sourceType.value !== null && sourceType.value !== undefined) push("source_type", sourceType.value);
    if (filename.value !== null && filename.value !== undefined) push("filename", filename.value);
    if (status.value !== null && status.value !== undefined) push("status", status.value);
    if (total.value !== null && total.value !== undefined) push("total", total.value);
    if (created.value !== null && created.value !== undefined) push("created", created.value);
    if (errors.value !== undefined) {
      values.push(JSON.stringify(errors.value ?? []));
      sets.push(`error_log = $${values.length}::jsonb`);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "nothing to update" });
    }

    values.push(id.value, uid);
    const rows = await sql.query(
      `UPDATE fc_import_jobs SET ${sets.join(", ")}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values
    );

    if (!rows.length) {
      return res.status(404).json({ error: "import job not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("PATCH /api/flash/import/jobs/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
