// Verification suite for the flags/difficulty/move feature.
//
// Runs the REAL handlers against the configured Neon database, exactly like
// the other verify_*.mjs suites. Creates its own scratch subject(s),
// categories, questions and users, then tears them all down.
//
//   node scripts/migrate.mjs 005_flags_difficulty   # once
//   node scripts/verify_flags_difficulty.mjs
process.loadEnvFile(".env");

const h = (p) => import(p).then((m) => m.default);
const { neon } = await import("@neondatabase/serverless");
const { createTestAccount } = await import("./_auth_fixture.mjs");
const sql = neon(process.env.DATABASE_URL);

const [
  questionsH, questionByIdH, questionMetaH, starH, flagH, difficultyH,
  subjectsH, subjectByIdH, categoriesH,
  attemptsH, answersH, finishH,
  newQ_H, wrongQ_H, starredQ_H, statsH,
  adminQuestionsH, adminQuestionFlagsH, moveQuestionsH, adminFlagByIdH,
] = await Promise.all([
  h("../api/_questions/index.js"),
  h("../api/_questions/[id]/index.js"),
  h("../api/_questions/meta.js"),
  h("../api/_questions/[id]/star.js"),
  h("../api/_questions/[id]/flag.js"),
  h("../api/_questions/[id]/difficulty.js"),
  h("../api/_subjects/index.js"),
  h("../api/_subjects/[id].js"),
  h("../api/_categories/index.js"),
  h("../api/_attempts/index.js"),
  h("../api/_attempts/[id]/answers.js"),
  h("../api/_attempts/[id]/finish.js"),
  h("../api/_categories/[id]/new-questions.js"),
  h("../api/_categories/[id]/wrong-questions.js"),
  h("../api/_categories/[id]/starred-questions.js"),
  h("../api/_categories/[id]/question-stats.js"),
  h("../api/_admin/questions.js"),
  h("../api/_admin/questions/[id]/flags.js"),
  h("../api/_admin/questions/move.js"),
  h("../api/_admin/flags/[id].js"),
]);

// ---------------- harness ----------------
function makeRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) {
      this.statusCode = code;
      return { json: (p) => { this.body = p; }, end: () => {} };
    },
    json(p) { this.statusCode = 200; this.body = p; },
    end() {},
  };
}

async function call(handler, method, query = {}, body = {}, cookie = null) {
  const res = makeRes();
  await handler({ method, query, body, url: "", headers: cookie ? { cookie } : {} }, res);
  return res;
}

async function ok(handler, method, query, body, cookie) {
  const res = await call(handler, method, query, body, cookie);
  if (res.statusCode >= 400) {
    throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra = "") {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; failures.push(label); console.log(`  \u2717 ${label}${extra ? ` -> ${extra}` : ""}`); }
}
const section = (t) => console.log(`\n${t}`);

const stamp = Date.now().toString(36);
const idsOf = (rows) => rows.map((r) => Number(r.id)).sort((a, b) => a - b);
const qIds = (rows) => rows.map((r) => Number(r.question_id)).sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let adminAcct, userA, userB, cookieAdmin, cookieA, cookieB;
let subA, subB, catA1, catA2, catB1, catF, catG;

function mkQuestion(cat, text, cookie) {
  const categoryId = typeof cat === "object" && cat !== null ? cat.id : cat;
  return ok(questionsH, "POST", {}, {
    category_id: categoryId,
    question_text: text,
    explanation: `exp ${text}`,
    options: [
      { option_text: `${text} A`, is_correct: true },
      { option_text: `${text} B`, is_correct: false },
      { option_text: `${text} C`, is_correct: false },
      { option_text: `${text} D`, is_correct: false },
    ],
  }, cookie);
}
const correctOpt = (q) => q.options.find((o) => o.is_correct).id;
const wrongOpt = (q) => q.options.find((o) => !o.is_correct).id;

async function setDifficulty(questionId, level, cookie) {
  return ok(difficultyH, "PUT", { id: questionId }, { difficulty: level }, cookie);
}
async function fileFlag(questionId, reason, comment, cookie) {
  return ok(flagH, "POST", { id: questionId }, { reason, comment }, cookie);
}
async function metaFor(questionId, cookie) {
  const meta = await ok(questionMetaH, "GET", { questionIds: String(questionId) }, {}, cookie);
  return meta[String(questionId)];
}
async function adminList(query, cookie = cookieAdmin) {
  return ok(adminQuestionsH, "GET", query, {}, cookie);
}

try {
  adminAcct = await createTestAccount({ role: "admin", label: "flagadmin" });
  userA = await createTestAccount({ role: "user", label: "flaga" });
  userB = await createTestAccount({ role: "user", label: "flagb" });
  cookieAdmin = adminAcct.cookie;
  cookieA = userA.cookie;
  cookieB = userB.cookie;
  console.log(`scratch users: admin=${adminAcct.username} A=${userA.username} B=${userB.username}`);

  subA = await ok(subjectsH, "POST", {}, { name: `ZZ_Flag_A_${stamp}` }, cookieAdmin);
  subB = await ok(subjectsH, "POST", {}, { name: `ZZ_Flag_B_${stamp}` }, cookieAdmin);
  catA1 = await ok(categoriesH, "POST", {}, { subject_id: subA.id, name: "Cat A1" }, cookieAdmin);
  catA2 = await ok(categoriesH, "POST", {}, { subject_id: subA.id, name: "Cat A2" }, cookieAdmin);
  catB1 = await ok(categoriesH, "POST", {}, { subject_id: subB.id, name: "Cat B1" }, cookieAdmin);
  catF = await ok(categoriesH, "POST", {}, { subject_id: subA.id, name: "Cat Filter" }, cookieAdmin);
  catG = await ok(categoriesH, "POST", {}, { subject_id: subA.id, name: "Cat Modes" }, cookieAdmin);

  // ============================================================ (a)
  section("(a) flag as User A -> admin sees reason + count; User B does not see A's flag");
  const q1 = await mkQuestion(catA1, "Flag Q1", cookieAdmin);

  const filed = await fileFlag(q1.id, "typo", "typo in option B", cookieA);
  check("POST flag returns the reporter's row", filed.question_id === q1.id && filed.status === "open");

  // Idempotent upsert: re-filing does not create a second row.
  await fileFlag(q1.id, "unclear_question", "still unclear", cookieA);
  const rowCount = await sql`SELECT count(*)::int c FROM flagged_questions WHERE question_id = ${q1.id}`;
  check("re-filing upserts (still exactly 1 row for the pair)", rowCount[0].c === 1);

  const adminQ1 = (await adminList({ categoryId: catA1.id })).find((q) => q.id === q1.id);
  check("admin list shows flag_count = 1 (open, all users)", adminQ1?.flag_count === 1, JSON.stringify(adminQ1));
  check("admin list shows reason is NOT leaked as a separate column (only count)", adminQ1 && !("reason" in adminQ1));

  const flagsForQ1 = await ok(adminQuestionFlagsH, "GET", { id: q1.id }, {}, cookieAdmin);
  check("admin flags list returns the report", flagsForQ1.length === 1);
  check("flag carries reason", flagsForQ1[0].reason === "unclear_question");
  check("flag carries comment", flagsForQ1[0].comment === "still unclear");
  check("flag carries the reporter username", flagsForQ1[0].username === userA.username, flagsForQ1[0].username);
  check("flag status is open", flagsForQ1[0].status === "open");

  const bFlags = await call(adminQuestionFlagsH, "GET", { id: q1.id }, {}, cookieB);
  check("USER B CANNOT READ THE ADMIN FLAG LIST (403)", bFlags.statusCode === 403);

  const metaB = await metaFor(q1.id, cookieB);
  check("USER B DOES NOT SEE USER A'S FLAG", metaB.flagged === false, JSON.stringify(metaB));
  const metaA = await metaFor(q1.id, cookieA);
  check("user A sees their own flag", metaA.flagged === true && metaA.flag.reason === "unclear_question");

  // Admin triage: resolve hides it from the Flagged filter, reopen brings it back.
  const resolved = await ok(adminFlagByIdH, "PATCH", { id: flagsForQ1[0].id }, { status: "resolved" }, cookieAdmin);
  check("PATCH resolves the flag and stamps resolved_by", resolved.status === "resolved" && resolved.resolved_by === adminAcct.id);
  const afterResolve = (await adminList({ categoryId: catA1.id })).find((q) => q.id === q1.id);
  check("resolved flag drops out of flag_count", afterResolve?.flag_count === 0);
  check("flagged=true no longer returns q1", !(await adminList({ categoryId: catA1.id, flagged: "true" })).some((q) => q.id === q1.id));
  await ok(adminFlagByIdH, "PATCH", { id: flagsForQ1[0].id }, { status: "open" }, cookieAdmin);
  check("reopening restores flag_count", (await adminList({ categoryId: catA1.id })).find((q) => q.id === q1.id)?.flag_count === 1);

  // ============================================================ (b)
  section("(b) set / change / clear a difficulty tag; per-user");
  await setDifficulty(q1.id, "hard", cookieA);
  check("A set difficulty=hard", (await metaFor(q1.id, cookieA)).difficulty === "hard");
  await setDifficulty(q1.id, "easy", cookieA);
  check("A changed it to easy", (await metaFor(q1.id, cookieA)).difficulty === "easy");
  const tagRows = await sql`SELECT count(*)::int c FROM question_difficulty_tags WHERE question_id = ${q1.id} AND user_id = ${userA.id}`;
  check("change upserts (still 1 tag row)", tagRows[0].c === 1);

  check("USER B DOES NOT SEE A'S DIFFICULTY", (await metaFor(q1.id, cookieB)).difficulty === null);
  check("admin's own difficulty is independent (null)", (await metaFor(q1.id, cookieAdmin)).difficulty === null);
  await setDifficulty(q1.id, "medium", cookieB);
  check("B can set their own difficulty without touching A's",
    (await metaFor(q1.id, cookieB)).difficulty === "medium" && (await metaFor(q1.id, cookieA)).difficulty === "easy");

  await ok(difficultyH, "DELETE", { id: q1.id }, {}, cookieA);
  check("A cleared their tag", (await metaFor(q1.id, cookieA)).difficulty === null);
  check("B's tag survived A's clear", (await metaFor(q1.id, cookieB)).difficulty === "medium");

  const badLevel = await call(difficultyH, "PUT", { id: q1.id }, { difficulty: "impossible" }, cookieA);
  check("invalid difficulty rejected with 400", badLevel.statusCode === 400);
  const badReason = await call(flagH, "POST", { id: q1.id }, { reason: "meh" }, cookieA);
  check("invalid flag reason rejected with 400", badReason.statusCode === 400);

  // ============================================================ (c)
  section("(c) filters alone and in combination");
  const qF1 = await mkQuestion(catF, "F1", cookieAdmin);
  const qF2 = await mkQuestion(catF, "F2", cookieAdmin);
  const qF3 = await mkQuestion(catF, "F3", cookieAdmin);
  const qF4 = await mkQuestion(catF, "F4", cookieAdmin);
  await ok(starH, "POST", { id: qF1.id }, {}, cookieAdmin);   // starred only
  await fileFlag(qF2.id, "typo", null, cookieA);              // flagged only
  await setDifficulty(qF3.id, "easy", cookieAdmin);           // easy only
  await ok(starH, "POST", { id: qF4.id }, {}, cookieAdmin);   // starred + flagged + hard
  await fileFlag(qF4.id, "wrong_answer_key", "key is off", cookieA);
  await setDifficulty(qF4.id, "hard", cookieAdmin);

  const onlyF = { categoryId: catF.id };
  check("starred=true -> {F1,F4}", same(idsOf(await adminList({ ...onlyF, starred: "true" })), idsOf([qF1, qF4])));
  check("flagged=true -> {F2,F4}", same(idsOf(await adminList({ ...onlyF, flagged: "true" })), idsOf([qF2, qF4])));
  check("difficulty=easy -> {F3}", same(idsOf(await adminList({ ...onlyF, difficulty: "easy" })), idsOf([qF3])));
  check("difficulty=easy,hard ORs -> {F3,F4}", same(idsOf(await adminList({ ...onlyF, difficulty: "easy,hard" })), idsOf([qF3, qF4])));
  check("starred=true & difficulty=hard ANDs -> {F4}", same(idsOf(await adminList({ ...onlyF, starred: "true", difficulty: "hard" })), idsOf([qF4])));
  check("starred=true & flagged=true -> {F4}", same(idsOf(await adminList({ ...onlyF, starred: "true", flagged: "true" })), idsOf([qF4])));
  check("flagged=true & difficulty=easy -> {} (F2 not easy, F3 not flagged)", same(idsOf(await adminList({ ...onlyF, flagged: "true", difficulty: "easy" })), []));
  check("all three -> {F4}", same(idsOf(await adminList({ ...onlyF, starred: "true", flagged: "true", difficulty: "hard" })), idsOf([qF4])));
  check("no filters returns the whole category", same(idsOf(await adminList(onlyF)), idsOf([qF1, qF2, qF3, qF4])));
  check("my_difficulty is the admin's own tag on each row",
    (await adminList({ ...onlyF, difficulty: "hard" }))[0]?.my_difficulty === "hard");
  const badFilter = await call(adminQuestionsH, "GET", { difficulty: "extreme" }, {}, cookieAdmin);
  check("invalid difficulty filter rejected with 400", badFilter.statusCode === 400);
  const nonAdminFilter = await call(adminQuestionsH, "GET", { categoryId: catF.id }, {}, cookieA);
  check("non-admin cannot reach the admin list (403)", nonAdminFilter.statusCode === 403);

  // ============================================================ (d)
  section("(d) move one question A1 -> A2; leaves old, appears new, star intact, modes correct");
  const qMove = await mkQuestion(catA1, "Move Me", cookieAdmin);
  const qStay = await mkQuestion(catA1, "Stay Put", cookieAdmin);

  await ok(starH, "POST", { id: qMove.id }, {}, cookieA);
  const attemptD = await ok(attemptsH, "POST", {}, { category_id: catA1.id, mode: "full" }, cookieA);
  await ok(answersH, "POST", { id: attemptD.id }, { question_id: qMove.id, selected_option_id: wrongOpt(qMove) }, cookieA);
  await ok(finishH, "POST", { id: attemptD.id }, {}, cookieA);

  const preWrongA1 = await ok(wrongQ_H, "GET", { id: catA1.id }, {}, cookieA);
  check("before move: qMove is wrong in A1", qIds(preWrongA1).includes(qMove.id));
  const preStarA1 = await ok(starredQ_H, "GET", { id: catA1.id }, {}, cookieA);
  check("before move: qMove starred in A1", preStarA1.starred_questions.some((s) => s.question_id === qMove.id));

  const moveRes = await ok(moveQuestionsH, "POST", {}, { question_ids: [qMove.id], target_category_id: catA2.id }, cookieAdmin);
  check("move reports 1 moved", moveRes.moved === 1, JSON.stringify(moveRes));
  check("move reports 1 star row updated", moveRes.starred_updated === 1);

  const dbQ = await sql`SELECT category_id FROM questions WHERE id = ${qMove.id}`;
  check("questions.category_id updated to A2", Number(dbQ[0].category_id) === catA2.id);

  const a1List = await ok(questionsH, "GET", { categoryId: catA1.id }, {}, cookieA);
  const a2List = await ok(questionsH, "GET", { categoryId: catA2.id }, {}, cookieA);
  check("qMove LEFT the old category quiz", !a1List.some((q) => q.id === qMove.id));
  check("qMove APPEARS in the new category quiz", a2List.some((q) => q.id === qMove.id));
  check("old category still has its other question", a1List.some((q) => q.id === qStay.id));

  const starA1 = await ok(starredQ_H, "GET", { id: catA1.id }, {}, cookieA);
  const starA2 = await ok(starredQ_H, "GET", { id: catA2.id }, {}, cookieA);
  check("star LEFT A1", !starA1.starred_questions.some((s) => s.question_id === qMove.id));
  check("STAR IS STILL THERE in A2 (followed the question)", starA2.starred_questions.some((s) => s.question_id === qMove.id));

  const wrongA1 = await ok(wrongQ_H, "GET", { id: catA1.id }, {}, cookieA);
  const wrongA2 = await ok(wrongQ_H, "GET", { id: catA2.id }, {}, cookieA);
  check("wrong_only: qMove gone from A1", !qIds(wrongA1).includes(qMove.id));
  check("wrong_only: qMove now shows as wrong in A2 (history-by-question_id fix)", qIds(wrongA2).includes(qMove.id));

  const newA2 = await ok(newQ_H, "GET", { id: catA2.id }, {}, cookieA);
  check("new_only: qMove is NOT 'new' in A2 (already answered) (fix)", !newA2.questions.some((q) => q.id === qMove.id));
  const newA1 = await ok(newQ_H, "GET", { id: catA1.id }, {}, cookieA);
  check("new_only: qStay is still new in A1", newA1.questions.some((q) => q.id === qStay.id));

  const statsA2 = await ok(statsH, "GET", { id: catA2.id }, {}, cookieA);
  check("question-stats for A2 counts the pre-move answer (fix)",
    statsA2.find((s) => s.question_id === qMove.id)?.total_attempts === 1);

  // Attempt history is NOT rewritten.
  const attemptRow = await sql`SELECT category_id FROM quiz_attempts WHERE id = ${attemptD.id}`;
  check("attempt row still carries its ORIGINAL category (history untouched)", Number(attemptRow[0].category_id) === catA1.id);
  const answerRow = await sql`SELECT count(*)::int c FROM attempt_answers WHERE attempt_id = ${attemptD.id} AND question_id = ${qMove.id}`;
  check("attempt_answers row survives the move", answerRow[0].c === 1);

  // ============================================================ (e)
  section("(e) bulk move 3 questions to a different subject's category");
  const qB1 = await mkQuestion(catA1, "Bulk 1", cookieAdmin);
  const qB2 = await mkQuestion(catA1, "Bulk 2", cookieAdmin);
  const qB3 = await mkQuestion(catA1, "Bulk 3", cookieAdmin);
  await ok(starH, "POST", { id: qB2.id }, {}, cookieA);

  const bulk = await ok(moveQuestionsH, "POST", {}, {
    question_ids: [qB1.id, qB2.id, qB3.id], target_category_id: catB1.id,
  }, cookieAdmin);
  check("bulk move reports 3 moved", bulk.moved === 3, JSON.stringify(bulk));
  check("bulk move reports 1 star updated", bulk.starred_updated === 1);

  const bulkDb = await sql`
    SELECT category_id FROM questions WHERE id = ANY(${[qB1.id, qB2.id, qB3.id]})
  `;
  check("all 3 now live in the target category", bulkDb.every((r) => Number(r.category_id) === catB1.id));
  const b1List = await ok(questionsH, "GET", { categoryId: catB1.id }, {}, cookieA);
  check("target category quiz lists all 3", [qB1, qB2, qB3].every((q) => b1List.some((r) => r.id === q.id)));
  const starB1 = await ok(starredQ_H, "GET", { id: catB1.id }, {}, cookieA);
  check("the bulk-moved star followed to the new category", starB1.starred_questions.some((s) => s.question_id === qB2.id));
  const a1AfterBulk = await ok(questionsH, "GET", { categoryId: catA1.id }, {}, cookieA);
  check("old category no longer lists the bulk-moved questions", ![qB1, qB2, qB3].some((q) => a1AfterBulk.some((r) => r.id === q.id)));

  const moveEmpty = await call(moveQuestionsH, "POST", {}, { question_ids: [], target_category_id: catB1.id }, cookieAdmin);
  check("empty question_ids rejected with 400", moveEmpty.statusCode === 400);
  const moveBadTarget = await call(moveQuestionsH, "POST", {}, { question_ids: [qB1.id], target_category_id: 999999999 }, cookieAdmin);
  check("unknown target category rejected (404/400)", moveBadTarget.statusCode === 404 || moveBadTarget.statusCode === 400, String(moveBadTarget.statusCode));
  const moveAsUser = await call(moveQuestionsH, "POST", {}, { question_ids: [qB1.id], target_category_id: catA1.id }, cookieA);
  check("non-admin cannot move (403)", moveAsUser.statusCode === 403);

  // ============================================================ (f)
  section("(f) delete a question that has flags and tags -> no orphans, no errors");
  const qDel = await mkQuestion(catB1, "Delete Me", cookieAdmin);
  await fileFlag(qDel.id, "wrong_explanation", "explanation is wrong", cookieA);
  await fileFlag(qDel.id, "other", null, cookieB);
  await setDifficulty(qDel.id, "hard", cookieA);
  await setDifficulty(qDel.id, "easy", cookieB);
  check("pre-delete: 2 flags and 2 tags exist",
    (await sql`SELECT count(*)::int c FROM flagged_questions WHERE question_id = ${qDel.id}`)[0].c === 2 &&
    (await sql`SELECT count(*)::int c FROM question_difficulty_tags WHERE question_id = ${qDel.id}`)[0].c === 2);

  const del = await ok(questionByIdH, "DELETE", { id: qDel.id }, {}, cookieAdmin);
  check("DELETE returns deleted:true", del.deleted === true);
  const orphanFlags = await sql`SELECT count(*)::int c FROM flagged_questions WHERE question_id = ${qDel.id}`;
  const orphanTags = await sql`SELECT count(*)::int c FROM question_difficulty_tags WHERE question_id = ${qDel.id}`;
  const orphanOpts = await sql`SELECT count(*)::int c FROM options WHERE question_id = ${qDel.id}`;
  check("NO ORPHAN flag rows", orphanFlags[0].c === 0);
  check("NO ORPHAN difficulty rows", orphanTags[0].c === 0);
  check("options removed too", orphanOpts[0].c === 0);

  const flagsAfterDel = await ok(adminQuestionFlagsH, "GET", { id: qDel.id }, {}, cookieAdmin);
  check("flag list for the deleted question is empty, not an error", Array.isArray(flagsAfterDel) && flagsAfterDel.length === 0);
  const listAfterDel = await adminList({ categoryId: catB1.id });
  check("admin list no longer contains the deleted question", !listAfterDel.some((q) => q.id === qDel.id));

  // ============================================================ (g)
  section("(g) existing modes + edit/delete still work with correct counts");
  const qG1 = await mkQuestion(catG, "G1", cookieAdmin);
  const qG2 = await mkQuestion(catG, "G2", cookieAdmin);
  const qG3 = await mkQuestion(catG, "G3", cookieAdmin);
  const qG4 = await mkQuestion(catG, "G4", cookieAdmin);

  const attemptG = await ok(attemptsH, "POST", {}, { category_id: catG.id, mode: "full" }, cookieA);
  await ok(answersH, "POST", { id: attemptG.id }, { question_id: qG1.id, selected_option_id: correctOpt(qG1) }, cookieA);
  await ok(answersH, "POST", { id: attemptG.id }, { question_id: qG2.id, selected_option_id: wrongOpt(qG2) }, cookieA);
  await ok(finishH, "POST", { id: attemptG.id }, {}, cookieA);
  await ok(starH, "POST", { id: qG3.id }, {}, cookieA);

  const fullList = await ok(questionsH, "GET", { categoryId: catG.id }, {}, cookieA);
  check("full mode data: all 4 questions WITH options", fullList.length === 4 && fullList.every((q) => q.options.length === 4));

  const wrongG = await ok(wrongQ_H, "GET", { id: catG.id }, {}, cookieA);
  check("wrong_only: exactly {G2}", same(qIds(wrongG), [qG2.id]));

  const starredG = await ok(starredQ_H, "GET", { id: catG.id }, {}, cookieA);
  check("starred_only: exactly 1 (G3)", starredG.count === 1 && starredG.starred_questions[0].question_id === qG3.id);

  const newG = await ok(newQ_H, "GET", { id: catG.id }, {}, cookieA);
  check("new_only: exactly {G4}", newG.count === 1 && newG.questions[0].id === qG4.id);

  const statsG = await ok(statsH, "GET", { id: catG.id }, {}, cookieA);
  check("question-stats: G2 wrong_count 1, G1 wrong_count 0",
    statsG.find((s) => s.question_id === qG2.id)?.wrong_count === 1 &&
    statsG.find((s) => s.question_id === qG1.id)?.wrong_count === 0);

  const patched = await ok(questionByIdH, "PATCH", { id: qG1.id }, {
    question_text: "G1 edited",
    options: [
      { option_text: "a", is_correct: false }, { option_text: "b", is_correct: false },
      { option_text: "c", is_correct: false }, { option_text: "d", is_correct: true },
    ],
  }, cookieAdmin);
  check("admin edit still works", patched.question_text === "G1 edited");

  await ok(questionByIdH, "DELETE", { id: qG4.id }, {}, cookieAdmin);
  const afterDelete = await ok(questionsH, "GET", { categoryId: catG.id }, {}, cookieA);
  check("admin delete still works (3 left)", afterDelete.length === 3);

  const cats = await ok(categoriesH, "GET", { subjectId: subA.id }, {}, cookieAdmin);
  const catGRow = cats.find((c) => c.id === catG.id);
  check("category question_count reflects the delete (3)", catGRow?.question_count === 3);
} catch (err) {
  fail++;
  failures.push(`EXCEPTION: ${err.message}`);
  console.error("\nERROR DURING TEST:", err.message);
  console.error(err.stack);
} finally {
  try {
    if (subA) await subjectByIdH({ method: "DELETE", query: { id: String(subA.id) }, body: {}, headers: { cookie: cookieAdmin } }, makeRes());
    if (subB) await subjectByIdH({ method: "DELETE", query: { id: String(subB.id) }, body: {}, headers: { cookie: cookieAdmin } }, makeRes());
    console.log("\n(cleanup: deleted scratch subjects A and B)");
  } catch (e) { console.error("subject cleanup failed:", e.message); }
  try {
    for (const acct of [adminAcct, userA, userB]) if (acct) await acct.cleanup();
    console.log("(cleanup: deleted scratch users)");
  } catch (e) { console.error("user cleanup failed:", e.message); }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
  process.exit(fail ? 1 : 0);
}
