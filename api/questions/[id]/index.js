import sql from "../../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { id } = req.query;
    const qId = Number(id);

    if (Number.isNaN(qId)) {
      return res.status(400).json({ error: "question id must be a number" });
    }

    if (req.method === "GET") {
      const rows = await sql`SELECT * FROM questions WHERE id = ${qId}`;
      if (!rows.length) {
        return res.status(404).json({ error: "question not found" });
      }

      const options = await sql`
        SELECT * FROM options WHERE question_id = ${qId} ORDER BY id
      `;

      return res.status(200).json({ ...rows[0], options });
    }

    if (req.method === "PATCH") {
      const { question_text, explanation, image_url, options } = req.body ?? {};

      if (!question_text || typeof question_text !== "string" || !question_text.trim()) {
        return res.status(400).json({ error: "question_text is required" });
      }

      if (!Array.isArray(options) || options.length !== 4) {
        return res
          .status(400)
          .json({ error: "options must be an array of exactly 4 items" });
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

      const trimmedOptions = options.map((o) => o.option_text.trim());
      const correctIdx = options.findIndex((o) => o.is_correct === true);

      const existingOptions = await sql`
        SELECT * FROM options WHERE question_id = ${qId} ORDER BY id
      `;

      const [questionRow] = await sql.transaction((txn) => {
        const qUpd = txn`
          UPDATE questions
          SET question_text = ${question_text.trim()},
              explanation   = ${explanation ?? null},
              image_url     = ${image_url ?? null}
          WHERE id = ${qId}
          RETURNING *
        `;

        let optUpd;
        if (existingOptions.length === trimmedOptions.length) {
          const parts = [];
          const params = [];
          existingOptions.forEach((eo, i) => {
            params.push(eo.id, trimmedOptions[i]);
            parts.push(`WHEN $${params.length - 1} THEN $${params.length}`);
          });
          params.push(existingOptions[correctIdx].id);
          const correctParam = params.length;
          params.push(qId);
          const qParam = params.length;
          optUpd = txn.query(
            `UPDATE options
               SET option_text = CASE id ${parts.join(" ")} END,
                   is_correct  = (id = $${correctParam})
             WHERE question_id = $${qParam}
             RETURNING *`,
            params
          );
        } else {
          optUpd = txn.query(
            `INSERT INTO options (question_id, option_text, is_correct)
             VALUES ${trimmedOptions
               .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}::boolean)`)
               .join(", ")}
             RETURNING *`,
            [qId, ...trimmedOptions.flatMap((text, i) => [text, i === correctIdx])]
          );
        }

        return [qUpd, optUpd];
      });

      if (!questionRow.length) {
        return res.status(404).json({ error: "question not found" });
      }

      const finalOptions = await sql`
        SELECT * FROM options WHERE question_id = ${qId} ORDER BY id
      `;

      return res.status(200).json({
        ...questionRow[0],
        options: finalOptions,
      });
    }

    if (req.method === "DELETE") {
      const existing = await sql`
        SELECT id, question_text FROM questions WHERE id = ${qId}
      `;
      if (!existing.length) {
        return res.status(404).json({ error: "question not found" });
      }

      await sql.transaction((txn) => [
        txn`DELETE FROM options WHERE question_id = ${qId}`,
        txn`DELETE FROM starred_questions WHERE question_id = ${qId}`,
        txn`DELETE FROM questions WHERE id = ${qId}`,
      ]);

      return res.status(200).json({ id: qId, deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("GET/PATCH/DELETE /api/questions/:id", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}