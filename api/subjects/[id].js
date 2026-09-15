import sql from "../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { id } = req.query;
    const subjectId = Number(id);

    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: "subject id must be a number" });
    }

    if (req.method === "GET") {
      const rows = await sql`
        SELECT s.*,
          count(DISTINCT c.id)::int AS category_count,
          count(q.id)::int AS question_count
        FROM subjects s
        LEFT JOIN categories c ON c.subject_id = s.id
        LEFT JOIN questions q ON q.category_id = c.id
        WHERE s.id = ${subjectId}
        GROUP BY s.id
      `;

      if (!rows.length) {
        return res.status(404).json({ error: "subject not found" });
      }

      return res.status(200).json(rows[0]);
    }

    if (req.method === "PATCH") {
      const { name, description, icon_name } = req.body ?? {};

      if (name !== undefined && (typeof name !== "string" || !name.trim())) {
        return res.status(400).json({ error: "name cannot be empty" });
      }

      const updates = [];
      const params = [];
      if (name !== undefined) {
        params.push(name.trim());
        updates.push(`name = $${params.length}`);
      }
      if (description !== undefined) {
        params.push(description === "" ? null : description);
        updates.push(`description = $${params.length}`);
      }
      if (icon_name !== undefined) {
        params.push(icon_name === "" ? null : icon_name);
        updates.push(`icon_name = $${params.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({ error: "nothing to update" });
      }

      params.push(subjectId);
      const rows = await sql.query(
        `UPDATE subjects SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (!rows.length) {
        return res.status(404).json({ error: "subject not found" });
      }

      return res.status(200).json(rows[0]);
    }

    if (req.method === "DELETE") {
      const existing = await sql`
        SELECT id, name FROM subjects WHERE id = ${subjectId}
      `;

      if (!existing.length) {
        return res.status(404).json({ error: "subject not found" });
      }

      const [categoryRow, questionRow, deletedRow] = await sql.transaction(
        (txn) => [
          txn`SELECT count(*)::int AS c FROM categories WHERE subject_id = ${subjectId}`,
          txn`SELECT count(*)::int AS c FROM questions q JOIN categories cat ON cat.id = q.category_id WHERE cat.subject_id = ${subjectId}`,
          txn`DELETE FROM subjects WHERE id = ${subjectId}
              RETURNING id, name`,
        ]
      );

      return res.status(200).json({
        id: deletedRow[0].id,
        name: deletedRow[0].name,
        deleted: {
          categories: categoryRow[0].c,
          questions: questionRow[0].c,
        },
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("GET/PATCH/DELETE /api/subjects/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}