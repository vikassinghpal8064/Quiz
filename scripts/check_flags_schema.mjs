// Verifies that migrations/005_flags_difficulty.sql has been applied.
//
// The migration is additive and is NOT assumed to be applied. Run this after
// (or instead of) the migration to confirm the flags/difficulty tables and
// indexes exist:
//
//   node scripts/check_flags_schema.mjs
//
// Exits 0 when everything is present, 1 otherwise, printing the exact command
// that fixes it.
process.loadEnvFile(".env");

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const HINT = "Run it now with:  node scripts/migrate.mjs 005_flags_difficulty";

let pass = 0;
let fail = 0;
const missing = [];

function check(label, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${label}`);
  } else {
    fail++;
    missing.push(label);
    console.log(`  \u2717 ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const REQUIRED = {
  flagged_questions: [
    "id", "question_id", "user_id", "reason", "comment",
    "status", "created_at", "resolved_at", "resolved_by",
  ],
  question_difficulty_tags: ["id", "question_id", "user_id", "difficulty", "updated_at"],
};

const REQUIRED_INDEXES = [
  "idx_flagged_questions_user_id",
  "idx_flagged_questions_question_id",
  "idx_flagged_questions_status",
  "idx_question_difficulty_tags_user_id",
  "idx_question_difficulty_tags_question_id",
];

try {
  console.log("FLAGS/DIFFICULTY SCHEMA (migration 005)\n");

  for (const [table, columns] of Object.entries(REQUIRED)) {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `;
    const present = new Set(rows.map((r) => r.column_name));
    check(`table ${table} exists`, rows.length > 0);
    if (rows.length) {
      for (const col of columns) {
        check(`${table}.${col}`, present.has(col));
      }
    }
  }

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY(${REQUIRED_INDEXES})
  `;
  const idxSet = new Set(idx.map((r) => r.indexname));
  for (const name of REQUIRED_INDEXES) {
    check(`index ${name}`, idxSet.has(name));
  }

  // Both tables must be unique per (question_id, user_id).
  const uq = await sql`
    SELECT c.relname AS t, pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE con.contype = 'u' AND c.relname IN ('flagged_questions','question_difficulty_tags')
  `;
  const uqText = uq.map((x) => `${x.t}: ${x.d}`).join("\n");
  check("flagged_questions UNIQUE(question_id, user_id)",
    /flagged_questions: UNIQUE \(question_id, user_id\)/.test(uqText), uqText);
  check("question_difficulty_tags UNIQUE(question_id, user_id)",
    /question_difficulty_tags: UNIQUE \(question_id, user_id\)/.test(uqText), uqText);

  // ON DELETE CASCADE on question_id so deleting a question leaves no orphans.
  const fk = await sql`
    SELECT c.relname AS t, a.attname AS col, pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE con.contype = 'f' AND c.relname IN ('flagged_questions','question_difficulty_tags')
      AND a.attname = 'question_id'
  `;
  check("question_id FKs are ON DELETE CASCADE",
    fk.length === 2 && fk.every((f) => f.d.includes("ON DELETE CASCADE")),
    JSON.stringify(fk.map((f) => `${f.t}: ${f.d}`)));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(`\nMissing pieces above. ${HINT}`);
    process.exit(1);
  }
  console.log("Schema is ready.");
} catch (err) {
  console.log(`\nERROR: ${err.message}`);
  console.log(`\n${HINT}`);
  process.exit(1);
}
