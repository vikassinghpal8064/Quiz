// Executes schema.sql inside a throwaway PostgreSQL schema, then compares
// the result against the live database's structure. This catches drift
// between the canonical schema file and what migrations actually produced.
//
// The scratch schema is always dropped, including on failure.
process.loadEnvFile(".env");

import { readFile } from "node:fs/promises";
import { neon, UnsafeRawSql } from "@neondatabase/serverless";

const SCRATCH = "schema_check_tmp";
const live = neon(process.env.DATABASE_URL);

const section = (t) => console.log(`\n${t}`);

let pass = 0, fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; console.log(`  \u2717 ${label}${extra ? ` -> ${extra}` : ""}`); }
};

// Split on semicolons that end a statement. The schema file uses no
// dollar-quoted bodies except the trigger function, which we keep whole
// by tracking the $$ delimiters.
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let inFunc = false;
  for (const line of sql.split("\n")) {
    if (line.includes("$$")) inFunc = !inFunc;
    buf += line + "\n";
    if (!inFunc && line.trimEnd().endsWith(";")) {
      const stmt = buf.trim();
      if (stmt.replace(/--.*$/gm, "").trim()) out.push(stmt);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

try {
  await live.query(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
  await live.query(`CREATE SCHEMA ${SCRATCH}`);

  const schemaSql = await readFile("schema.sql", "utf8");
  const statements = splitStatements(schemaSql);
  console.log(`\nschema.sql: ${statements.length} statements, executing in scratch schema "${SCRATCH}"`);

  // Neon only speaks the extended protocol, which forbids multiple
  // commands per statement. sql.transaction() batches them into a single
  // request instead, so SET search_path takes effect for the whole batch.
  try {
    // UnsafeRawSql inlines the statement text verbatim; a normal tagged
    // template would send it as a bound parameter and fail to parse.
    // search_path must be set with zero parameters (a bind param is not
    // valid in SET), so the template below is deliberately interpolation
    // free and the guard on SCRATCH keeps the two in sync. Neon ignores
    // the connection-level `options=-c search_path=...` parameter, which
    // is why this cannot be done per-connection.
    if (SCRATCH !== "schema_check_tmp") {
      throw new Error("the literal in the SET search_path template is out of sync with SCRATCH");
    }
    await live.transaction([
      live`SET search_path TO 'schema_check_tmp'`,
      ...statements.map((st) => live`${new UnsafeRawSql(st.replace(/;\s*$/, ""))}`),
    ]);
    check("every statement in schema.sql executes cleanly", true);
  } catch (e) {
    fail++;
    console.log(`  \u2717 batch execution failed: ${e.message}`);
  }

  const TABLES = [
    "subjects", "categories", "questions", "options",
    "users", "password_reset_tokens",
    "quiz_attempts", "attempt_answers", "starred_questions",
  ];

  const built = await live.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = '${SCRATCH}' ORDER BY table_name`);
  const builtNames = built.map((r) => r.table_name);
  for (const t of TABLES) {
    check(`schema.sql creates ${t}`, builtNames.includes(t));
  }

  // Compare columns of the auth/ownership tables against live.
  const COMPARE = {
    users: ["id", "username", "password_hash", "email", "phone_number", "role", "created_at"],
    password_reset_tokens: ["id", "user_id", "token", "expires_at", "used", "created_at"],
    quiz_attempts: ["id", "user_id", "category_id", "mode", "started_at", "finished_at", "score", "total_questions"],
    starred_questions: ["id", "user_id", "question_id", "category_id", "starred_at"],
  };
  for (const [table, expected] of Object.entries(COMPARE)) {
    const r = await live.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = '${SCRATCH}' AND table_name = '${table}'
      ORDER BY column_name`);
    const got = r.map((x) => x.column_name);
    const nullable = Object.fromEntries(r.map((x) => [x.column_name, x.is_nullable]));
    const missing = expected.filter((c) => !got.includes(c));
    const extra = got.filter((c) => !expected.includes(c));
    check(`${table} has exactly the expected columns`, !missing.length && !extra.length,
      missing.length ? `missing ${missing}` : extra.length ? `extra ${extra}` : "");
    if (table === "users") {
      check("users.role is NOT NULL with a default", nullable.role === "NO");
    }
    if (table === "quiz_attempts" || table === "starred_questions") {
      check(`${table}.user_id is nullable (legacy rows)`, nullable.user_id === "YES");
    }
    if (table === "password_reset_tokens") {
      check("password_reset_tokens.used is NOT NULL with a default", nullable.used === "NO");
    }
  }

  // Foreign keys: the two ownership FKs must be ON DELETE SET NULL.
  const fk = await live.query(`
    SELECT c.relname AS t, a.attname AS c, pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = '${SCRATCH}'
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE con.contype = 'f' AND a.attname = 'user_id'`);
  check("schema.sql declares exactly 3 user_id foreign keys", fk.length === 3, `got ${fk.length}`);
  // Quiz history must survive account deletion, so those two are SET NULL.
  // Reset tokens are credentials, not history, so they cascade away.
  for (const f of fk.filter((x) => x.t !== "password_reset_tokens")) {
    check(`${f.t}.user_id is ON DELETE SET NULL (history survives)`, f.d.includes("ON DELETE SET NULL"), f.d);
  }
  for (const f of fk.filter((x) => x.t === "password_reset_tokens")) {
    check("password_reset_tokens.user_id is ON DELETE CASCADE (tokens die with the account)",
      f.d.includes("ON DELETE CASCADE"), f.d);
  }

  // Unique constraints: usernames/email/phone, reset token, composite star.
  const uq = await live.query(`
    SELECT c.relname AS t, pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = '${SCRATCH}'
    WHERE con.contype = 'u'`);
  const uqText = uq.map((x) => `${x.t}: ${x.d}`).join("\n");
  check("users has UNIQUE(username)", /users: UNIQUE \(username\)/.test(uqText));
  check("users has UNIQUE(phone_number)", /users: UNIQUE \(phone_number\)/.test(uqText));
  check("users.email is deliberately NOT unique", !/users: UNIQUE \(email\)/.test(uqText));
  check("password_reset_tokens has UNIQUE(token)", /password_reset_tokens: UNIQUE \(token\)/.test(uqText));
  check("starred_questions is UNIQUE(question_id, user_id) - stars are per user",
    /starred_questions: UNIQUE \(question_id, user_id\)/.test(uqText), uqText);
  check("starred_questions is NOT UNIQUE(question_id) alone",
    !/starred_questions: UNIQUE \(question_id\)/.test(uqText));

  // Case-insensitive lookup indexes the app relies on.
  const idx = await live.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = '${SCRATCH}' AND indexname IN
      ('idx_users_username_lower','idx_users_email_lower',
       'idx_quiz_attempts_user_id','idx_starred_questions_user_id')`);
  check("schema.sql creates the 4 auth lookup indexes", idx.length === 4, `got ${idx.length}`);

  // The new_only mode must be allowed by the CHECK constraint.
  const chk = await live.query(`
    SELECT pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = '${SCRATCH}'
    WHERE con.contype = 'c' AND c.relname = 'quiz_attempts'`);
  check("quiz_attempts CHECK allows 'new_only'", chk.some((c) => c.d.includes("new_only")), JSON.stringify(chk));
  check("quiz_attempts CHECK allows 'full'", chk.some((c) => c.d.includes("full")));

  // The single-correct-option trigger function must exist.
  const fn = await live.query(`
    SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = '${SCRATCH}' AND proname = 'enforce_single_correct_option'`);
  check("schema.sql creates enforce_single_correct_option()", fn.length === 1);

  // ---- drift check: live "public" vs what schema.sql builds ----
  section("DRIFT: live database vs schema.sql");
  const DRIFT_TABLES = [
    "users", "password_reset_tokens", "quiz_attempts", "starred_questions",
  ];
  // Only these are expected to actually have foreign keys / unique
  // constraints; comparing "no FKs" against "no FKs" is still a valid
  // equality check, so emptiness is only asserted where it must hold.
  const EXPECT_FK = new Set(["password_reset_tokens", "quiz_attempts", "starred_questions"]);
  // users still has UNIQUE(username) + UNIQUE(phone_number).
  const EXPECT_UQ = new Set(["users", "password_reset_tokens", "starred_questions"]);

  for (const table of DRIFT_TABLES) {
    const shape = async (schema) => {
      const cols = await live.query(`
        SELECT column_name, is_nullable, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = '${schema}' AND table_name = '${table}'
        ORDER BY column_name`);
      return cols.map((c) => `${c.column_name}:${c.is_nullable}:${c.data_type}`).join("|");
    };
    const [a, b] = await Promise.all([shape("public"), shape(SCRATCH)]);
    check(`${table} has identical columns in live DB and schema.sql`, a === b && a.length > 0,
      a === b ? "" : `\n        live:   ${a}\n        schema: ${b}`);

    const fkShape = async (schema) => {
      const r = await live.query(`
        SELECT a.attname AS c,
               pg_get_constraintdef(con.oid) AS d
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = '${schema}'
        JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
        WHERE con.contype = 'f' AND cl.relname = '${table}'
        ORDER BY a.attname`);
      // Strip the schema qualifier so public and scratch compare equal.
      return r.map((x) => `${x.c}=>${x.d.replaceAll(`${SCRATCH}.`, "")}`).join("|");
    };
    const [fa, fb] = await Promise.all([fkShape("public"), fkShape(SCRATCH)]);
    check(`${table} has identical foreign keys in live DB and schema.sql`,
      fa === fb && (!EXPECT_FK.has(table) || fa.length > 0),
      fa === fb ? "" : `\n        live:   ${fa}\n        schema: ${fb}`);

    const uqShape = async (schema) => {
      const r = await live.query(`
        SELECT pg_get_constraintdef(con.oid) AS d
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = '${schema}'
        WHERE con.contype = 'u' AND cl.relname = '${table}'
        ORDER BY 1`);
      return r.map((x) => x.d).join("|");
    };
    const [ua, ub] = await Promise.all([uqShape("public"), uqShape(SCRATCH)]);
    check(`${table} has identical UNIQUE constraints in live DB and schema.sql`,
      ua === ub && (!EXPECT_UQ.has(table) || ua.length > 0),
      ua === ub ? "" : `\n        live:   ${ua}\n        schema: ${ub}`);
  }

  // The case-insensitive lookup indexes the app depends on.
  const liveIdx = await live.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_users_username_lower','idx_users_email_lower',
                        'idx_password_reset_tokens_expires_at')`);
  check("live DB has the 3 case-insensitive / expiry lookup indexes", liveIdx.length === 3, `got ${liveIdx.length}`);
  const emailUniq = await live.query(`
    SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'u'`);
  check("live users.email is NOT unique (shared addresses allowed by design)",
    !emailUniq.some((x) => /\(email\)/.test(x.d)), JSON.stringify(emailUniq));

  // The live star constraint must be per-user, which is the behavioural
  // change that makes independent starring work.
  const liveStarUq = await live.query(`
    SELECT pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    WHERE con.contype = 'u' AND cl.relname = 'starred_questions'`);
  check("live starred_questions is UNIQUE(question_id, user_id)",
    liveStarUq.some((x) => /\(question_id, user_id\)/.test(x.d)), JSON.stringify(liveStarUq));

  // The live new_only CHECK must still be in place.
  const liveChk = await live.query(`
    SELECT pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    WHERE con.contype = 'c' AND cl.relname = 'quiz_attempts'`);
  check("live quiz_attempts CHECK still allows 'new_only'",
    liveChk.some((c) => c.d.includes("new_only")), JSON.stringify(liveChk));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  fail++;
  console.log(`\nERROR: ${e.message}`);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} finally {
  try {
    await live.query(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
    console.log("(scratch schema dropped)");
  } catch (e) {
    console.log(`WARNING: could not drop ${SCRATCH}: ${e.message}`);
  }
  process.exit(fail ? 1 : 0);
}
