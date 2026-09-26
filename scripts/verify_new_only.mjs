process.loadEnvFile(".env");

const h = (p) => import(p).then((m) => m.default);

const [subjectsHandler, categoriesHandler, questionsHandler,
  attemptsHandler, answersHandler, finishHandler,
  newQuestionsHandler, wrongQuestionsHandler, starredQuestionsHandler,
  questionStatsHandler, starHandler] = await Promise.all([
  h("../api/_subjects/index.js"),
  h("../api/_categories/index.js"),
  h("../api/_questions/index.js"),
  h("../api/_attempts/index.js"),
  h("../api/_attempts/[id]/answers.js"),
  h("../api/_attempts/[id]/finish.js"),
  h("../api/_categories/[id]/new-questions.js"),
  h("../api/_categories/[id]/wrong-questions.js"),
  h("../api/_categories/[id]/starred-questions.js"),
  h("../api/_categories/[id]/question-stats.js"),
  h("../api/_questions/[id]/star.js"),
]);

// Every endpoint requires a session now. Loaded dynamically so the API
// modules see DATABASE_URL / JWT_SECRET from .env.
const { createTestAccount } = await import("./_auth_fixture.mjs");
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

// This suite creates subjects/categories/questions (admin-only) and also
// takes quizzes and stars questions, so it needs an admin account. An admin
// can do everything a regular user can.
let account = null;
let cookie = null;

// Every request is made as this account, so a missing session shows up as a
// loud 401 rather than silently testing nothing.
async function requestHeaders() {
  if (!cookie) throw new Error("no session cookie: call createTestAccount() first");
  return { cookie };
}

function makeRes() {
  const r = {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return {
        json: (p) => { this.body = p; },
        end: () => {},
      };
    },
    json(p) { this.statusCode = 200; this.body = p; },
    end() {},
  };
  return r;
}

async function raw(handler, method, query, body) {
  const res = makeRes();
  await handler({ method, query, body, url: "", headers: await requestHeaders() }, res);
  return res;
}

async function call(handler, method, query, body) {
  const res = await raw(handler, method, query, body);
  if (res.statusCode >= 400) {
    throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

let pass = 0, fail = 0;
const failures = [];
function check(label, cond) {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; failures.push(label); console.log(`  \u2717 ${label}`); }
}
function section(t) { console.log(`\n${t}`); }

let subjectId;

function mkQuestion(categoryId, text) {
  return call(questionsHandler, "POST", {}, {
    category_id: categoryId,
    question_text: text,
    explanation: `exp for ${text}`,
    options: [
      { option_text: `${text} A`, is_correct: true },
      { option_text: `${text} B`, is_correct: false },
      { option_text: `${text} C`, is_correct: false },
      { option_text: `${text} D`, is_correct: false },
    ],
  });
}
const correctOpt = (q) => q.options.find((o) => o.is_correct).id;
const wrongOpt = (q) => q.options.find((o) => !o.is_correct).id;

try {
  console.log("Creating test account...");
  account = await createTestAccount({ role: "admin", label: "newonly" });
  cookie = account.cookie;
  console.log(`  logged in as ${account.username} (${account.role})`);

  console.log("Creating scratch fixtures...");
  subjectId = (await call(subjectsHandler, "POST", {}, { name: "ZZ_NewOnly_Test", description: "temp" })).id;
  const catA = (await call(categoriesHandler, "POST", {}, { subject_id: subjectId, name: "ZZ_NewOnly_A", description: "temp" }));
  const catB = (await call(categoriesHandler, "POST", {}, { subject_id: subjectId, name: "ZZ_NewOnly_B", description: "temp" }));
  const catAId = catA.id, catBId = catB.id;

  const q1 = await mkQuestion(catAId, "Q1 never touched");
  const q2 = await mkQuestion(catAId, "Q2 never touched");
  const q3 = await mkQuestion(catAId, "Q3 never touched");
  const qb = await mkQuestion(catBId, "QB other category");
  console.log(`  categoryA=${catAId} (q=${q1.id},${q2.id},${q3.id})  categoryB=${catBId} (q=${qb.id})`);

  // ---------------------------------------------------------------- 6a
  section("CHECK 6a: freshly added question appears under New Questions");
  let fresh = await call(newQuestionsHandler, "GET", { id: catAId }, {});
  check("count is 3 (all three fresh questions)", fresh.count === 3);
  check("count matches questions array length", Array.isArray(fresh.questions) && fresh.questions.length === fresh.count);
  const freshIds = fresh.questions.map((q) => q.id);
  check("q1 present", freshIds.includes(q1.id));
  check("q2 present", freshIds.includes(q2.id));
  check("q3 present", freshIds.includes(q3.id));
  const f1 = fresh.questions.find((q) => q.id === q1.id);
  check("full question payload returned (text/explanation/category_id)",
    f1.question_text === "Q1 never touched" && f1.explanation === "exp for Q1 never touched" && f1.category_id === catAId);
  check("exactly 4 options nested on each question",
    f1.options.length === 4 && fresh.questions.every((q) => q.options.length === 4));
  check("exactly one correct option per returned question",
    fresh.questions.every((q) => q.options.filter((o) => o.is_correct).length === 1));
  check("no leakage: category B question excluded from category A",
    !freshIds.includes(qb.id));

  section("CHECK 6a (scope): attempt in another category does not affect category A");
  const otherAttempt = await call(attemptsHandler, "POST", {}, { category_id: catBId, mode: "full" });
  await call(answersHandler, "POST", { id: otherAttempt.id }, { question_id: qb.id, selected_option_id: correctOpt(qb) });
  fresh = await call(newQuestionsHandler, "GET", { id: catAId }, {});
  check("category A count still 3 after category B attempt", fresh.count === 3);
  const freshB = await call(newQuestionsHandler, "GET", { id: catBId }, {});
  check("category B count drops to 0 after its own attempt", freshB.count === 0);
  check("empty result returns count 0 and empty questions array",
    freshB.count === 0 && Array.isArray(freshB.questions) && freshB.questions.length === 0);

  // ---------------------------------------------------------------- 6b
  section("CHECK 6b: attempting a question removes it from New Questions");
  const newAttempt = await call(attemptsHandler, "POST", {}, { category_id: catAId, mode: "new_only" });
  check("POST /api/attempts accepted mode='new_only'", newAttempt.mode === "new_only" && newAttempt.category_id === catAId);

  await call(answersHandler, "POST", { id: newAttempt.id }, { question_id: q1.id, selected_option_id: correctOpt(q1) });
  fresh = await call(newQuestionsHandler, "GET", { id: catAId }, {});
  check("count drops 3 -> 2 after answering q1 correctly", fresh.count === 2);
  check("q1 removed from New Questions", !fresh.questions.map((q) => q.id).includes(q1.id));
  check("q2 and q3 still present", fresh.questions.map((q) => q.id).includes(q2.id) && fresh.questions.map((q) => q.id).includes(q3.id));

  await call(answersHandler, "POST", { id: newAttempt.id }, { question_id: q2.id, selected_option_id: wrongOpt(q2) });
  fresh = await call(newQuestionsHandler, "GET", { id: catAId }, {});
  check("count drops 2 -> 1 after answering q2 incorrectly", fresh.count === 1);
  check("q2 removed from New Questions regardless of right/wrong", !fresh.questions.map((q) => q.id).includes(q2.id));

  await call(finishHandler, "POST", { id: newAttempt.id }, {});
  const newResults = await call(newQuestionsHandler, "GET", { id: catAId }, {});
  check("count drops to 1 after finishing the new_only attempt", newResults.count === 1);
  check("only the never-attempted, never-starred q3 remains",
    newResults.count === 1 && newResults.questions[0].id === q3.id);

  section("CHECK 6b: attempted questions still behave correctly elsewhere");
  const fullList = await call(questionsHandler, "GET", { categoryId: catAId }, {});
  check("Full Test still serves all 3 questions", fullList.length === 3);
  check("Full Test serves the attempted q1 and q2 with options",
    fullList.filter((q) => q.options.length === 4).length === 3);
  let wrong = await call(wrongQuestionsHandler, "GET", { id: catAId }, {});
  check("wrong list contains only the missed q2", wrong.length === 1 && wrong[0].question_id === q2.id);
  check("wrong list does NOT contain correctly-answered q1", !wrong.some((w) => w.question_id === q1.id));
  const stats = await call(questionStatsHandler, "GET", { id: catAId }, {});
  const st1 = stats.find((s) => s.question_id === q1.id);
  const st2 = stats.find((s) => s.question_id === q2.id);
  const st3 = stats.find((s) => s.question_id === q3.id);
  check("q1 stats: 1 attempt, 0 wrong", st1.total_attempts === 1 && st1.wrong_count === 0);
  check("q2 stats: 1 attempt, 1 wrong", st2.total_attempts === 1 && st2.wrong_count === 1);
  check("q3 stats: still 0 attempts (untouched)", st3.total_attempts === 0 && st3.wrong_count === 0);

  // ---------------------------------------------------------------- 6c
  section("CHECK 6c: starring a never-attempted question removes it from New Questions");
  check("q3 is New right before starring", newResults.questions[0]?.id === q3.id);
  await call(starHandler, "POST", { id: q3.id }, {});
  const afterStar = await call(newQuestionsHandler, "GET", { id: catAId }, {});
  check("count drops 1 -> 0 after starring the only new question", afterStar.count === 0);
  check("q3 excluded from New Questions though never attempted", !afterStar.questions.some((q) => q.id === q3.id));
  const starQ3Stats = (await call(questionStatsHandler, "GET", { id: catAId }, {})).find((s) => s.question_id === q3.id);
  check("q3 was genuinely never attempted (starred only)", starQ3Stats.total_attempts === 0);
  const starred = await call(starredQuestionsHandler, "GET", { id: catAId }, {});
  check("starred list now shows q3", starred.count === 1 && starred.starred_questions.some((s) => s.question_id === q3.id));
  wrong = await call(wrongQuestionsHandler, "GET", { id: catAId }, {});
  check("starring did not fabricate a wrong answer (wrong list still just q2)", wrong.length === 1 && wrong[0].question_id === q2.id);

  // ---------------------------------------------------------------- 6d
  section("CHECK 6d: existing three modes unchanged");
  const fullAttempt = await call(attemptsHandler, "POST", {}, { category_id: catAId, mode: "full" });
  check("mode='full' attempt still created", fullAttempt.mode === "full");
  const fullQs = await call(questionsHandler, "GET", { categoryId: catAId }, {});
  check("Full Test count still 3 (attempts/stars do not remove questions)", fullQs.length === 3);

  const wrongAttempt = await call(attemptsHandler, "POST", {}, { category_id: catAId, mode: "wrong_only" });
  check("mode='wrong_only' attempt still created", wrongAttempt.mode === "wrong_only");
  const wrongIds = wrong.map((w) => w.question_id);
  const wrongQs = await call(questionsHandler, "GET", { questionIds: wrongIds.join(",") }, {});
  check("wrong_only question set resolves to exactly the missed questions",
    wrongQs.length === wrongIds.length && wrongIds.every((id) => wrongQs.some((q) => q.id === id)));

  const starAttempt = await call(attemptsHandler, "POST", {}, { category_id: catAId, mode: "starred_only" });
  check("mode='starred_only' attempt still created", starAttempt.mode === "starred_only");
  const starQs = await call(questionsHandler, "GET", { questionIds: String(q3.id) }, {});
  check("starred_only question set resolves to exactly the starred questions", starQs.length === 1 && starQs[0].id === q3.id);

  const badMode = await raw(attemptsHandler, "POST", {}, { category_id: catAId, mode: "bogus_mode" });
  check("invalid mode still rejected with 400", badMode.statusCode === 400);
  const noCat = await raw(attemptsHandler, "POST", {}, { mode: "full" });
  check("missing category_id still rejected with 400", noCat.statusCode === 400);
  const badNew = await raw(newQuestionsHandler, "GET", { id: "not-a-number" }, {});
  check("new-questions rejects non-numeric id with 400", badNew.statusCode === 400);
  const postNew = await raw(newQuestionsHandler, "POST", { id: catAId }, {});
  check("new-questions is read-only (POST -> 405)", postNew.statusCode === 405);
  const missingNew = await raw(newQuestionsHandler, "GET", { id: 999999 }, {});
  check("new-questions 404s on unknown category", missingNew.statusCode === 404);

  section("CHECK 6d: pre-existing production data intact, and not attributed to new accounts");
  // Cross-check new-questions against an independently derived expected set,
  // using only the three pre-existing read endpoints. Covers categories that
  // are fully attempted, partly attempted, heavily starred, and untouched.
  for (const cid of [1, 2, 5, 16, 19, 28]) {
    const allQs = await call(questionsHandler, "GET", { categoryId: cid }, {});
    const st = await call(questionStatsHandler, "GET", { id: cid }, {});
    const sq = await call(starredQuestionsHandler, "GET", { id: cid }, {});
    const starIds = new Set((sq.starred_questions ?? []).map((s) => s.question_id));
    const attempted = new Set(st.filter((s) => s.total_attempts > 0).map((s) => s.question_id));
    const expected = allQs
      .map((q) => q.id)
      .filter((id) => !attempted.has(id) && !starIds.has(id))
      .sort((a, b) => a - b);

    const got = await call(newQuestionsHandler, "GET", { id: cid }, {});
    const gotIds = got.questions.map((q) => q.id).sort((a, b) => a - b);
    check(
      `cat ${cid}: new-questions count matches derived set (${got.count} of ${allQs.length} total, ${attempted.size} attempted, ${starIds.size} starred)`,
      got.count === expected.length && JSON.stringify(gotIds) === JSON.stringify(expected)
    );
    // The right invariant is not "4 options" (some pre-existing questions have 5)
    // but that the new endpoint serves byte-identical question+option data to the
    // existing full category endpoint for the same question ids.
    const fullById = new Map(allQs.map((q) => [q.id, q]));
    check(
      `cat ${cid}: question+option data identical to the full category endpoint`,
      got.questions.every((q) => {
        const f = fullById.get(q.id);
        if (!f) return false;
        const key = (o) => `${o.id}:${o.option_text}:${o.is_correct}`;
        return (
          q.question_text === f.question_text &&
          q.explanation === f.explanation &&
          q.image_url === f.image_url &&
          q.category_id === f.category_id &&
          q.options.length > 0 &&
          q.options.map(key).sort().join("|") === f.options.map(key).sort().join("|")
        );
      })
    );
    check(
      `cat ${cid}: exactly one correct option per returned question`,
      got.questions.every((q) => q.options.filter((o) => o.is_correct).length === 1)
    );
  }

  const prodFull = await call(questionsHandler, "GET", { categoryId: 1 }, {});
  check(`category 1 full test still returns 30 questions (got ${prodFull.length})`, prodFull.length === 30);

  // Pre-accounts history is preserved in the database but is ownerless
  // (user_id IS NULL), so it is deliberately NOT attributed to this fresh
  // account. That is the intended behaviour, and it is asserted here at the
  // database level so "untouched" is still verified.
  const freshWrong = await call(wrongQuestionsHandler, "GET", { id: 1 }, {});
  const freshStars5 = await call(starredQuestionsHandler, "GET", { id: 5 }, {});
  check("a fresh account sees no wrong questions in category 1 (legacy rows are not attributed to anyone)",
    freshWrong.length === 0);
  check("a fresh account sees no starred questions in category 5", freshStars5.count === 0);

  const legacyAttempts = await sql`
    SELECT count(*)::int AS c FROM quiz_attempts WHERE user_id IS NULL`;
  const legacyStars = await sql`
    SELECT count(*)::int AS c FROM starred_questions WHERE user_id IS NULL`;
  check(`legacy quiz_attempts rows are still present and ownerless (${legacyAttempts[0].c})`,
    legacyAttempts[0].c === 48);
  check(`legacy starred_questions rows are still present and ownerless (${legacyStars[0].c})`,
    legacyStars[0].c === 114);
  const owned = await sql`
    SELECT
      (SELECT count(*)::int FROM quiz_attempts     WHERE user_id IS NOT NULL) AS a,
      (SELECT count(*)::int FROM starred_questions WHERE user_id IS NOT NULL) AS s`;
  check("this run's activity is owned by the test account",
    owned[0].a > 0 && owned[0].s > 0, JSON.stringify(owned[0]));
} catch (err) {
  fail++;
  failures.push(`EXCEPTION: ${err.message}`);
  console.error("\nERROR DURING TEST:", err.message);
  console.error(err.stack);
} finally {
  if (subjectId) {
    try {
      const del = await h("../api/_subjects/[id].js");
      await call(del, "DELETE", { id: subjectId }, {});
      console.log(`\n(cleanup: deleted scratch subject ${subjectId})`);
    } catch (e) { console.error("scratch subject cleanup failed:", e.message); }
  }
  if (account) {
    try {
      await account.cleanup();
      console.log(`(cleanup: deleted test account ${account.username})`);
    } catch (e) { console.error("account cleanup failed:", e.message); }
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
  process.exit(fail ? 1 : 0);
}
