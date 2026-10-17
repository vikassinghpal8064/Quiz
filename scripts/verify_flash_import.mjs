// End-to-end verification for the import surface of the flash API:
//
//   GET/POST /api/flash/import/jobs
//   PATCH    /api/flash/import/jobs/:id
//   GET      /api/flash/import/duplicates
//
// It also exercises the quiz-bridge contract from the server side: it seeds a
// scratch quiz subject/category/question/options, reads them back through the
// existing quiz endpoints exactly as the bridge does, builds the same
// question -> card shape, and imports those cards through the flash bulk
// endpoint. The browser-side conversion itself is unit-tested in
// src/modules/flashcards/importers/__tests__/quizBridge.test.js.
//
// Drives the real dispatch entry (api/index.js) with real session cookies, so
// routing, auth and the database are all exercised. Requires db/flash_001.sql
// to be applied. Creates throwaway accounts, flash rows and quiz rows, then
// removes all of them in cleanup - no real user data is touched.
//
//   node scripts/verify_flash_import.mjs
//
// The API modules read process.env at import time, so .env is loaded first and
// everything else is a dynamic import.
process.loadEnvFile(".env");

const { createTestAccount } = await import("./_auth_fixture.mjs");
const { default: dispatch } = await import("../api/index.js");
const { default: sql } = await import("../api/_lib/db.js");

let pass = 0;
let fail = 0;
const failures = [];
function check(label, cond, extra = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(label);
    console.log(`  \u2717 ${label}${extra ? ` -> ${extra}` : ""}`);
  }
}

function makeRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = (code) => ({
    json: (p) => { r.statusCode = code; r.body = p; },
    end: () => { r.statusCode = code; },
  });
  r.json = (p) => { r.statusCode = 200; r.body = p; };
  r.end = () => {};
  return r;
}

async function call(method, path, { query, body, cookie } = {}) {
  const res = makeRes();
  const req = {
    method,
    url: path,
    query: { path, ...(query ?? {}) },
    body: body ?? null,
    headers: cookie ? { cookie } : {},
  };
  await dispatch(req, res);
  return res;
}

const text = (card, side = "front") => card?.[side]?.blocks?.[0]?.text;

// The bridge's conversion rule, inlined so this suite does not pull the browser
// module (and its fetch/sessionStorage imports) into Node.
function bridgeCard(question) {
  const correct = (question.options ?? []).filter((o) => o.is_correct);
  const back = [];
  if (correct.length) back.push(correct.map((o) => o.option_text.trim()).join(" / "));
  if (question.explanation) back.push(`Explanation: ${question.explanation}`);
  return {
    card_type: "basic",
    front: { blocks: [{ type: "text", text: question.question_text }] },
    back: { blocks: [{ type: "text", text: back.join("\n\n") }] },
    tags: [],
    source: "quiz-bridge",
    source_ref: String(question.id),
  };
}

async function main() {
  const a = await createTestAccount({ label: "flash_import_a" });
  const b = await createTestAccount({ label: "flash_import_b" });

  let folderId = null;
  let categoryId = null;
  let jobId = null;
  let quizSubjectId = null;
  let quizCategoryId = null;

  try {
    // ---------- setup: a folder + category ----------
    let res = await call("POST", "/api/flash/folders", { cookie: a.cookie, body: { name: "Import Deck" } });
    folderId = res.body.id;
    check("setup: folder created", res.statusCode === 201 && typeof folderId === "number");

    res = await call("POST", "/api/flash/categories", { cookie: a.cookie, body: { folder_id: folderId, name: "Main" } });
    categoryId = res.body.id;
    check("setup: category created", res.statusCode === 201 && typeof categoryId === "number");

    // ============================================================
    // IMPORT JOBS
    // ============================================================
    console.log("\nIMPORT JOBS");

    res = await call("GET", "/api/flash/import/jobs", { cookie: a.cookie });
    check("GET jobs starts empty", res.statusCode === 200 && Array.isArray(res.body) && res.body.length === 0);

    res = await call("POST", "/api/flash/import/jobs", {
      cookie: a.cookie,
      body: { source_type: "csv", filename: "deck.csv", category_id: categoryId, total: 12 },
    });
    check(
      "POST job -> 201 pending with total",
      res.statusCode === 201 && res.body.status === "pending" && res.body.total === 12 && res.body.created === 0,
      JSON.stringify(res.body)
    );
    jobId = res.body.id;

    res = await call("POST", "/api/flash/import/jobs", { cookie: a.cookie, body: { source_type: "" } });
    check("POST job without source_type -> 400", res.statusCode === 400 && typeof res.body.error === "string");

    res = await call("POST", "/api/flash/import/jobs", { cookie: a.cookie, body: { source_type: "csv", total: -1 } });
    check("POST job with negative total -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/import/jobs", {
      cookie: a.cookie,
      body: { source_type: "csv", category_id: 999999 },
    });
    check("POST job into an unknown category -> 404", res.statusCode === 404);

    res = await call("POST", "/api/flash/import/jobs", {
      cookie: b.cookie,
      body: { source_type: "csv", category_id: categoryId },
    });
    check("POST job into someone else's category -> 404", res.statusCode === 404);

    res = await call("POST", "/api/flash/import/jobs", { cookie: a.cookie, body: { source_type: "csv", error_log: "nope" } });
    check("POST job with non-array error_log -> 400", res.statusCode === 400);

    res = await call("GET", "/api/flash/import/jobs", { cookie: a.cookie });
    check(
      "GET jobs lists the job with its category name",
      res.statusCode === 200 && res.body.length === 1 && res.body[0].category_name === "Main",
      JSON.stringify(res.body)
    );

    res = await call("GET", "/api/flash/import/jobs", { cookie: a.cookie, query: { limit: "0" } });
    check("GET jobs limit=0 -> 400", res.statusCode === 400);

    res = await call("GET", "/api/flash/import/jobs", { cookie: a.cookie, query: { limit: "9999" } });
    check("GET jobs limit over max -> 400", res.statusCode === 400);

    // ---------- PATCH progress ----------
    res = await call("PATCH", `/api/flash/import/jobs/${jobId}`, {
      cookie: a.cookie,
      body: { status: "running", created: 5 },
    });
    check(
      "PATCH job records progress",
      res.statusCode === 200 && res.body.status === "running" && res.body.created === 5,
      JSON.stringify(res.body)
    );

    res = await call("PATCH", `/api/flash/import/jobs/${jobId}`, {
      cookie: a.cookie,
      body: { status: "done", created: 12, error_log: ["batch 2 failed"] },
    });
    check(
      "PATCH job finishes and stores errors",
      res.statusCode === 200 && res.body.status === "done" && Array.isArray(res.body.error_log) && res.body.error_log[0] === "batch 2 failed",
      JSON.stringify(res.body)
    );

    res = await call("PATCH", `/api/flash/import/jobs/${jobId}`, { cookie: a.cookie, body: { status: "nonsense" } });
    check("PATCH job with an unknown status -> 400", res.statusCode === 400);

    res = await call("PATCH", `/api/flash/import/jobs/${jobId}`, { cookie: a.cookie, body: { error_log: {} } });
    check("PATCH job with a non-array error_log -> 400", res.statusCode === 400);

    res = await call("PATCH", `/api/flash/import/jobs/${jobId}`, { cookie: a.cookie, body: {} });
    check("PATCH job with nothing to update -> 400", res.statusCode === 400);

    res = await call("PATCH", `/api/flash/import/jobs/${jobId}`, { cookie: b.cookie, body: { created: 99 } });
    check("PATCH someone else's job -> 404", res.statusCode === 404);

    res = await call("PATCH", "/api/flash/import/jobs/999999", { cookie: a.cookie, body: { created: 1 } });
    check("PATCH an unknown job -> 404", res.statusCode === 404);

    // ============================================================
    // DUPLICATE SIGNATURES
    // ============================================================
    console.log("\nDUPLICATE SIGNATURES");

    // Seed two cards, one with punctuation/casing that must fold.
    res = await call("POST", "/api/flash/cards/bulk", {
      cookie: a.cookie,
      body: {
        cards: [
          { category_id: categoryId, front: { blocks: [{ type: "text", text: "Paris, France" }] }, back: { blocks: [{ type: "text", text: "Capital" }] } },
          { category_id: categoryId, front: { blocks: [{ type: "text", text: "Rome" }] }, back: { blocks: [{ type: "text", text: "Capital" }] } },
        ],
      },
    });
    check("seed: two cards inserted", res.statusCode === 201 && res.body.inserted === 2, JSON.stringify(res.body).slice(0, 200));

    res = await call("GET", "/api/flash/import/duplicates", { cookie: a.cookie, query: { categoryId: String(categoryId) } });
    const signatures = res.body?.signatures ?? [];
    check(
      "GET duplicates returns normalised fronts",
      res.statusCode === 200 && res.body.category_id === categoryId && signatures.includes("paris france") && signatures.includes("rome"),
      JSON.stringify(signatures)
    );

    res = await call("GET", "/api/flash/import/duplicates", { cookie: b.cookie, query: { categoryId: String(categoryId) } });
    check("GET duplicates for someone else's category -> 404", res.statusCode === 404);

    res = await call("GET", "/api/flash/import/duplicates", { cookie: a.cookie, query: { categoryId: "999999" } });
    check("GET duplicates for an unknown category -> 404", res.statusCode === 404);

    res = await call("GET", "/api/flash/import/duplicates", { cookie: a.cookie });
    check("GET duplicates without categoryId -> 400", res.statusCode === 400);

    // ============================================================
    // BATCHED BULK IMPORT (the wizard's step 5)
    // ============================================================
    console.log("\nBATCHED IMPORT");

    const BATCH_SIZE = 200;
    const totalCards = 205; // two batches: 200 + 5
    const all = Array.from({ length: totalCards }, (_, i) => ({
      category_id: categoryId,
      card_type: "basic",
      front: { blocks: [{ type: "text", text: `import-${i}` }] },
      back: { blocks: [{ type: "text", text: "a" }] },
      tags: ["imported"],
      source: "import",
    }));

    let inserted = 0;
    let batches = 0;
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const batch = all.slice(i, i + BATCH_SIZE);
      batches++;
      res = await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards: batch } });
      check(`batch ${batches} (${batch.length} cards) -> 201`, res.statusCode === 201 && res.body.inserted === batch.length, JSON.stringify(res.body).slice(0, 120));
      inserted += res.body.inserted ?? 0;
    }
    check("every card inserted across batches", inserted === totalCards, `inserted=${inserted}`);
    check("205 cards split into 2 batches", batches === 2, `batches=${batches}`);

    // The duplicate check now sees the newly imported fronts too. Note the
    // signature is normalised: "import-0" folds to "import 0".
    res = await call("GET", "/api/flash/import/duplicates", { cookie: a.cookie, query: { categoryId: String(categoryId) } });
    check(
      "duplicates include the freshly imported cards",
      res.statusCode === 200 && res.body.signatures.includes("import 0") && res.body.signatures.includes("import 204"),
      `count=${res.body.signatures?.length}`
    );

    // ============================================================
    // QUIZ BRIDGE (server-side contract)
    // ============================================================
    console.log("\nQUIZ BRIDGE");

    const [subject] = await sql`INSERT INTO subjects (name, description) VALUES (${`zscratch import ${a.id}`}, 'bridge test') RETURNING id`;
    quizSubjectId = subject.id;
    const [quizCategory] = await sql`
      INSERT INTO categories (subject_id, name) VALUES (${quizSubjectId}, 'Bridge Cat') RETURNING id
    `;
    quizCategoryId = quizCategory.id;

    const [q1] = await sql`
      INSERT INTO questions (category_id, question_text, explanation)
      VALUES (${quizCategoryId}, ${"What is the capital of France?"}, ${"Paris since 987"})
      RETURNING id
    `;
    const [q2] = await sql`
      INSERT INTO questions (category_id, question_text, explanation)
      VALUES (${quizCategoryId}, ${"What is 2 + 2?"}, ${null})
      RETURNING id
    `;
    const [, wrongOption] = await sql.transaction((txn) => [
      txn`INSERT INTO options (question_id, option_text, is_correct) VALUES (${q1.id}, 'Paris', true) RETURNING id`,
      txn`INSERT INTO options (question_id, option_text, is_correct) VALUES (${q1.id}, 'London', false) RETURNING id`,
      txn`INSERT INTO options (question_id, option_text, is_correct) VALUES (${q2.id}, '4', true) RETURNING id`,
      txn`INSERT INTO options (question_id, option_text, is_correct) VALUES (${q2.id}, '5', false) RETURNING id`,
    ]);
    check("bridge seed: quiz rows created", typeof q1.id === "number" && typeof wrongOption[0].id === "number");

    // Exactly what the bridge reads.
    res = await call("GET", "/api/questions", { cookie: a.cookie, query: { categoryId: String(quizCategoryId) } });
    const questions = res.body ?? [];
    const france = questions.find((q) => q.question_text === "What is the capital of France?");
    check(
      "GET /api/questions exposes options with is_correct and explanation",
      res.statusCode === 200 &&
        questions.length === 2 &&
        france?.options.some((o) => o.is_correct) &&
        france?.explanation === "Paris since 987",
      JSON.stringify(questions).slice(0, 200)
    );

    // Build cards the way the bridge does and import them. Every card carries
    // its target category, matching what the wizard's toCardPayload produces.
    const bridgeCards = questions.map((q) => ({ ...bridgeCard(q), category_id: categoryId }));
    const franceCard = bridgeCards.find((c) => c.source_ref === String(q1.id));
    check(
      "bridge cards carry the correct answer and explanation",
      franceCard?.back.blocks[0].text.includes("Paris") &&
        franceCard?.back.blocks[0].text.includes("Explanation: Paris since 987"),
      franceCard?.back.blocks[0].text
    );
    check(
      "bridge cards trace back to the question",
      franceCard?.source === "quiz-bridge" && franceCard?.source_ref === String(q1.id)
    );

    res = await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards: bridgeCards } });
    check("bridge cards import through bulk", res.statusCode === 201 && res.body.inserted === 2, JSON.stringify(res.body).slice(0, 160));

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { q: "capital of France" } });
    check(
      "bridge cards land in the flash category",
      res.statusCode === 200 && res.body.cards.some((c) => text(c) === "What is the capital of France?"),
      JSON.stringify(res.body).slice(0, 160)
    );

    // ---------- "only previously-wrong questions" filter ----------
    const [attempt] = await sql`
      INSERT INTO quiz_attempts (user_id, category_id, mode, finished_at)
      VALUES (${a.id}, ${quizCategoryId}, 'full', now()) RETURNING id
    `;
    await sql`
      INSERT INTO attempt_answers (attempt_id, question_id, selected_option_id, is_correct)
      VALUES (${attempt.id}, ${q1.id}, ${wrongOption[0].id}, false)
    `;

    res = await call("GET", `/api/categories/${quizCategoryId}/wrong-questions`, { cookie: a.cookie });
    const wrongIds = (res.body ?? []).map((r) => r.question_id);
    check(
      "wrong-questions lists exactly the missed question",
      res.statusCode === 200 && wrongIds.length === 1 && wrongIds[0] === q1.id,
      JSON.stringify(res.body)
    );

    const wrongOnly = questions.filter((q) => wrongIds.includes(q.id)).map(bridgeCard);
    check("wrong-only filter keeps one candidate", wrongOnly.length === 1 && wrongOnly[0].source_ref === String(q1.id));

    // ============================================================
    // CROSS-USER ISOLATION
    // ============================================================
    console.log("\nCROSS-USER ISOLATION");
    res = await call("GET", "/api/flash/import/jobs", { cookie: b.cookie });
    check("other user sees no jobs", res.statusCode === 200 && res.body.length === 0);
  } finally {
    // fc_ rows are not FK'd to users, so delete them explicitly; quiz rows are
    // removed by deleting the scratch subject (cascades).
    try {
      if (folderId != null) await sql`DELETE FROM fc_folders WHERE id = ${folderId} AND user_id = ${String(a.id)}`;
      await sql`DELETE FROM fc_import_jobs WHERE user_id = ${String(a.id)} OR user_id = ${String(b.id)}`;
      if (quizSubjectId != null) await sql`DELETE FROM subjects WHERE id = ${quizSubjectId}`;
    } catch (err) {
      console.error("cleanup: flash/quiz rows", err);
    }
    await a.cleanup();
    await b.cleanup();
  }
}

try {
  await main();
} catch (err) {
  fail++;
  console.error("suite threw:", err);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
process.exit(fail ? 1 : 0);
