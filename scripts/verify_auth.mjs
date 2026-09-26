process.loadEnvFile(".env");

const h = (p) => import(p).then((m) => m.default);
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const [registerH, loginH, logoutH, meH, forgotH, resetH,
  subjectsH, subjectByIdH, categoriesH, categoryByIdH,
  questionsH, questionByIdH, starH,
  attemptsH, answersH, finishH, resultsH,
  newQ_H, wrongQ_H, starredQ_H, statsH] = await Promise.all([
  h("../api/_auth/register.js"),
  h("../api/_auth/login.js"),
  h("../api/_auth/logout.js"),
  h("../api/_auth/me.js"),
  h("../api/_auth/forgot-password.js"),
  h("../api/_auth/reset-password/[token].js"),
  h("../api/_subjects/index.js"),
  h("../api/_subjects/[id].js"),
  h("../api/_categories/index.js"),
  h("../api/_categories/[id]/index.js"),
  h("../api/_questions/index.js"),
  h("../api/_questions/[id]/index.js"),
  h("../api/_questions/[id]/star.js"),
  h("../api/_attempts/index.js"),
  h("../api/_attempts/[id]/answers.js"),
  h("../api/_attempts/[id]/finish.js"),
  h("../api/_attempts/[id]/results.js"),
  h("../api/_categories/[id]/new-questions.js"),
  h("../api/_categories/[id]/wrong-questions.js"),
  h("../api/_categories/[id]/starred-questions.js"),
  h("../api/_categories/[id]/question-stats.js"),
]);

// ---------------- res shim that captures Set-Cookie ----------------
function makeRes() {
  const r = {
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
  return r;
}

function cookieFrom(res) {
  const sc = res.headers["set-cookie"];
  if (!sc) return null;
  return sc.split(";")[0];
}

async function call(handler, method, query = {}, body = {}, cookie = null) {
  const res = makeRes();
  const headers = cookie ? { cookie } : {};
  await handler({ method, query, body, url: "", headers }, res);
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
function check(label, cond) {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; failures.push(label); console.log(`  \u2717 ${label}`); }
}
const section = (t) => console.log(`\n${t}`);

const stamp = Date.now().toString(36);
const U = (n) => `${n}_${stamp}`;
// Valid, distinct phone numbers. Must be digits-only after the +,
// otherwise validation rejects them before the uniqueness check runs.
// Randomised per run so a re-run (or an interrupted run) can never
// collide with phone numbers a previous run already registered.
let phoneSeq = 0;
const phoneBase = 10000000 + Math.floor(Math.random() * 89000000);
const phone = () => `+1555${String(phoneBase + phoneSeq++).padStart(8, "0")}`;
const PASSWORD = "Sup3rSecret!pw";
const NEW_PASSWORD = "An0therSecret!pw";

let userA, userB, adminUser;
let cookieA, cookieB, cookieAdmin;
let scratchSubjectId, catId, q1, q2, q3;
let legacySnapshot;

function mkQuestion(cat, text) {
  return ok(questionsH, "POST", {}, {
    category_id: cat, question_text: text, explanation: `exp ${text}`,
    options: [
      { option_text: `${text} A`, is_correct: true },
      { option_text: `${text} B`, is_correct: false },
      { option_text: `${text} C`, is_correct: false },
      { option_text: `${text} D`, is_correct: false },
    ],
  }, cookieAdmin);
}
const correctOpt = (q) => q.options.find((o) => o.is_correct).id;
const wrongOpt = (q) => q.options.find((o) => !o.is_correct).id;

async function createUser(name, { role } = {}) {
  const created = await ok(registerH, "POST", {}, {
    username: name,
    password: PASSWORD,
    phone_number: phone(),
    email: `${name}@example.test`,
  });
  if (role) {
    await sql`UPDATE users SET role = ${role} WHERE id = ${created.id}`;
  }
  return created;
}

try {
  // ============================================================ 10a
  section("CHECK 10a: registration + duplicate rejection");
  const phoneA = phone();

  const createdA = await ok(registerH, "POST", {}, {
    username: U("alice"), password: PASSWORD, phone_number: phoneA, email: U("alice") + "@example.test",
  });
  userA = createdA;
  check("register returns 201 with the new user", createdA.id > 0 && createdA.username === U("alice"));
  check("public registration always assigns role='user'", createdA.role === "user");
  check("register never returns password_hash", !("password_hash" in createdA));

  const stored = await sql`SELECT * FROM users WHERE id = ${userA.id}`;
  check("password is stored as a bcrypt hash, not plaintext",
    stored[0].password_hash !== PASSWORD && /^\$2[aby]\$\d{2}\$/.test(stored[0].password_hash));
  const cost = Number(stored[0].password_hash.split("$")[2]);
  check(`bcrypt cost factor is >= 10 (got ${cost})`, cost >= 10);
  check("phone_number is stored normalized", stored[0].phone_number === phoneA);

  const dupUser = await call(registerH, "POST", {}, {
    username: U("alice"), password: PASSWORD, phone_number: phone(), email: `x${stamp}@example.test`,
  });
  check("duplicate username rejected with 409", dupUser.statusCode === 409);
  check("duplicate username error names the username field",
    dupUser.body?.fields?.username && /taken/i.test(dupUser.body.fields.username));

  const dupPhone = await call(registerH, "POST", {}, {
    username: U("bob"), password: PASSWORD, phone_number: phoneA, email: `y${stamp}@example.test`,
  });
  check("duplicate phone number rejected with 409", dupPhone.statusCode === 409);
  check("duplicate phone error names the phone field",
    dupPhone.body?.fields?.phone_number && /taken|registered/i.test(dupPhone.body.fields.phone_number));

  const caseDup = await call(registerH, "POST", {}, {
    username: U("alice").toUpperCase(), password: PASSWORD, phone_number: phone(), email: `z${stamp}@example.test`,
  });
  check("username uniqueness is case-insensitive", caseDup.statusCode === 409);

  const noEmail = await call(registerH, "POST", {}, {
    username: U("noemail"), password: PASSWORD, phone_number: phone(), email: "",
  });
  check("missing email rejected (email is mandatory)", noEmail.statusCode === 400 && noEmail.body?.fields?.email);
  const shortPw = await call(registerH, "POST", {}, {
    username: U("shortpw"), password: "abc", phone_number: phone(), email: `s${stamp}@example.test`,
  });
  check("too-short password rejected", shortPw.statusCode === 400 && shortPw.body?.fields?.password);

  // ============================================================ 10b
  section("CHECK 10b: regular user is blocked from admin pages/endpoints");
  const loginA = await call(loginH, "POST", {}, { username: U("alice"), password: PASSWORD });
  check("login with correct credentials returns 200", loginA.statusCode === 200);
  cookieA = cookieFrom(loginA);
  check("login sets an httpOnly session cookie", Boolean(cookieA) && loginA.headers["set-cookie"].includes("HttpOnly"));
  check("session cookie is SameSite=Lax", loginA.headers["set-cookie"].includes("SameSite=Lax"));
  check("login response identifies id/username/role", loginA.body.role === "user" && loginA.body.id === userA.id);

  const badPw = await call(loginH, "POST", {}, { username: U("alice"), password: "wrong-password" });
  check("wrong password rejected with 401", badPw.statusCode === 401);
  const noSuchUser = await call(loginH, "POST", {}, { username: U("ghost"), password: PASSWORD });
  check("unknown user rejected with 401", noSuchUser.statusCode === 401);
  check("unknown-user and wrong-password messages are identical (no enumeration)",
    noSuchUser.body.error === badPw.body.error);

  const me = await ok(meH, "GET", {}, {}, cookieA);
  check("GET /api/auth/me returns id, username, role",
    me.id === userA.id && me.username === U("alice") && me.role === "user");
  const meAnon = await call(meH, "GET", {}, {});
  check("GET /api/auth/me without a cookie returns 401", meAnon.statusCode === 401);

  // Admin-only writes, as a regular user.
  const adminWrites = [
    ["POST /api/subjects", subjectsH, "POST", {}, { name: "Nope" }],
    ["PATCH /api/subjects/:id", subjectByIdH, "PATCH", { id: "1" }, { name: "Nope" }],
    ["DELETE /api/subjects/:id", subjectByIdH, "DELETE", { id: "1" }, {}],
    ["POST /api/categories", categoriesH, "POST", {}, { subject_id: 1, name: "Nope" }],
    ["PATCH /api/categories/:id", categoryByIdH, "PATCH", { id: "1" }, { name: "Nope" }],
    ["DELETE /api/categories/:id", categoryByIdH, "DELETE", { id: "1" }, {}],
    ["POST /api/questions", questionsH, "POST", {}, { category_id: 1, question_text: "Nope", options: [] }],
    ["PATCH /api/questions/:id", questionByIdH, "PATCH", { id: "1" }, { question_text: "Nope" }],
    ["DELETE /api/questions/:id", questionByIdH, "DELETE", { id: "1" }, {}],
  ];
  for (const [label, handler, method, query, body] of adminWrites) {
    const res = await call(handler, method, query, body, cookieA);
    check(`regular user gets 403 on ${label}`, res.statusCode === 403);
  }
  for (const [label, handler, method, query] of [
    ["GET /api/subjects", subjectsH, "GET", {}],
    ["GET /api/categories", categoriesH, "GET", { subjectId: 1 }],
    ["GET /api/questions", questionsH, "GET", { categoryId: 1 }],
  ]) {
    const asUser = await call(handler, method, query, {}, cookieA);
    const asAnon = await call(handler, method, query, {});
    check(`regular user may read ${label}`, asUser.statusCode === 200);
    check(`anonymous caller is refused ${label}`, asAnon.statusCode === 401);
  }

  // ============================================================ 10c
  section("CHECK 10c: promoted admin can reach upload/edit/delete");
  const createdAdmin = await createUser(U("root"), { role: "admin" });
  adminUser = createdAdmin;
  const dbRole = await sql`SELECT role FROM users WHERE id = ${createdAdmin.id}`;
  check("role was set to 'admin' directly in the DB", dbRole[0].role === "admin");

  const loginAdmin = await call(loginH, "POST", {}, { username: U("root"), password: PASSWORD });
  cookieAdmin = cookieFrom(loginAdmin);
  check("admin can log in", loginAdmin.statusCode === 200 && loginAdmin.body.role === "admin");
  const meAdmin = await ok(meH, "GET", {}, {}, cookieAdmin);
  check("GET /api/auth/me reports role=admin", meAdmin.role === "admin");

  // Admin creates the scratch subject/category/questions the rest of the
  // suite depends on, which also proves POST works for an admin.
  const sub = await ok(subjectsH, "POST", {}, { name: `ZZ_Auth_${stamp}`, description: "temp" }, cookieAdmin);
  scratchSubjectId = sub.id;
  check("admin POST /api/subjects succeeds", sub.id > 0);
  const cat = await ok(categoriesH, "POST", {}, { subject_id: sub.id, name: "ZZ_Auth_Cat", description: "temp" }, cookieAdmin);
  catId = cat.id;
  check("admin POST /api/categories succeeds", cat.id > 0);

  q1 = await mkQuestion(catId, "Q1");
  q2 = await mkQuestion(catId, "Q2");
  q3 = await mkQuestion(catId, "Q3");
  check("admin POST /api/questions succeeds", q1.id > 0 && q2.id > 0 && q3.id > 0);

  const patched = await ok(subjectByIdH, "PATCH", { id: sub.id }, { name: `ZZ_Auth_${stamp}_renamed` }, cookieAdmin);
  check("admin PATCH /api/subjects succeeds", patched.name === `ZZ_Auth_${stamp}_renamed`);
  const patchedQ = await ok(questionByIdH, "PATCH", { id: q1.id }, {
    question_text: "Q1 edited",
    options: [
      { option_text: "eA", is_correct: false }, { option_text: "eB", is_correct: false },
      { option_text: "eC", is_correct: false }, { option_text: "eD", is_correct: true },
    ],
  }, cookieAdmin);
  check("admin PATCH /api/questions succeeds", patchedQ.question_text === "Q1 edited");
  // PATCH rewrites the options in place and flips which one is correct, so
  // re-bind q1 to the updated question; otherwise the cached option ids
  // below would point at a now-incorrect choice.
  q1 = patchedQ;
  check("q1's options reflect the PATCH (correct answer moved)", correctOpt(q1) !== q1.options[0].id);

  // A non-admin must not be able to reach the admin pages' data at all.
  const manageAsUser = await call(questionsH, "GET", { categoryId: catId }, {}, cookieA);
  check("regular user can still browse questions for quizzes", manageAsUser.statusCode === 200);

  // ============================================================ 10d
  section("CHECK 10d: per-user isolation of attempts, stars and history");
  const createdB = await createUser(U("bob"));
  userB = createdB;
  const loginB = await call(loginH, "POST", {}, { username: U("bob"), password: PASSWORD });
  cookieB = cookieFrom(loginB);
  check("second account can log in", loginB.statusCode === 200);

  // Baseline: each user sees their own empty history.
  const aStar0 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieA);
  const bStar0 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieB);
  check("user A starts with 0 starred", aStar0.count === 0);
  check("user B starts with 0 starred", bStar0.count === 0);
  const aNew0 = await ok(newQ_H, "GET", { id: catId }, {}, cookieA);
  check("user A sees all 3 questions as new", aNew0.count === 3);

  // User A: star q3, attempt a quiz, get q2 wrong.
  await ok(starH, "POST", { id: q3.id }, {}, cookieA);
  const aStar1 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieA);
  check("user A now has exactly 1 starred question (q3)", aStar1.count === 1 && aStar1.starred_questions[0].question_id === q3.id);

  const bStarAfterA = await ok(starredQ_H, "GET", { id: catId }, {}, cookieB);
  check("USER B CANNOT SEE USER A'S STAR (count stays 0)", bStarAfterA.count === 0);
  check("user B's starred payload contains no questions", (bStarAfterA.questions ?? []).length === 0);

  const aAttempt = await ok(attemptsH, "POST", {}, { category_id: catId, mode: "full" }, cookieA);
  check("attempt row is tagged with user A", aAttempt.user_id === userA.id);
  await ok(answersH, "POST", { id: aAttempt.id }, { question_id: q2.id, selected_option_id: wrongOpt(q2) }, cookieA);
  await ok(answersH, "POST", { id: aAttempt.id }, { question_id: q1.id, selected_option_id: correctOpt(q1) }, cookieA);
  await ok(finishH, "POST", { id: aAttempt.id }, {}, cookieA);

  const aWrong = await ok(wrongQ_H, "GET", { id: catId }, {}, cookieA);
  check("user A's wrong list contains q2", aWrong.length === 1 && aWrong[0].question_id === q2.id);
  const bWrong = await ok(wrongQ_H, "GET", { id: catId }, {}, cookieB);
  check("USER B CANNOT SEE USER A'S WRONG QUESTIONS", bWrong.length === 0);

  const aNew1 = await ok(newQ_H, "GET", { id: catId }, {}, cookieA);
  check("user A's new list drops attempted q1/q2 and starred q3", aNew1.count === 0);
  const bNew1 = await ok(newQ_H, "GET", { id: catId }, {}, cookieB);
  check("user B still sees all 3 questions as new (own history is empty)", bNew1.count === 3);

  const aStats = await ok(statsH, "GET", { id: catId }, {}, cookieA);
  const bStats = await ok(statsH, "GET", { id: catId }, {}, cookieB);
  check("user A's stats show 1 attempt on q1", aStats.find((s) => s.question_id === q1.id)?.total_attempts === 1);
  check("q1 was answered correctly (wrong_count 0)", aStats.find((s) => s.question_id === q1.id)?.wrong_count === 0);
  check("USER B'S STATS SHOW ZERO ATTEMPTS EVERYWHERE", bStats.every((s) => s.total_attempts === 0 && s.wrong_count === 0));

  // Cross-user access to an attempt must be refused.
  const bReadsA = await call(resultsH, "GET", { id: aAttempt.id }, {}, cookieB);
  check("user B gets 403 reading user A's results", bReadsA.statusCode === 403);
  const bAnswersA = await call(answersH, "POST", { id: aAttempt.id }, { question_id: q1.id, selected_option_id: 1 }, cookieB);
  check("user B gets 403 answering into user A's attempt", bAnswersA.statusCode === 403);
  const aReadsOwn = await call(resultsH, "GET", { id: aAttempt.id }, {}, cookieA);
  check("user A can still read their own results", aReadsOwn.statusCode === 200);

  // The same question can be starred independently by two users.
  await ok(starH, "POST", { id: q3.id }, {}, cookieB);
  const aStar2 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieA);
  const bStar2 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieB);
  check("both users can star the same question independently",
    aStar2.count === 1 && bStar2.count === 1 && aStar2.starred_questions[0].question_id === bStar2.starred_questions[0].question_id);
  const starRows = await sql`SELECT user_id FROM starred_questions WHERE question_id = ${q3.id} ORDER BY user_id`;
  check("two separate starred_questions rows exist for that question", starRows.length === 2);

  // Unstarring by B must not unstar it for A.
  await ok(starH, "DELETE", { id: q3.id }, {}, cookieB);
  const aStar3 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieA);
  const bStar3 = await ok(starredQ_H, "GET", { id: catId }, {}, cookieB);
  check("B unstarring leaves A's star intact", aStar3.count === 1);
  check("B's star is gone", bStar3.count === 0);

  // Logout clears the cookie.
  const logout = await call(logoutH, "POST", {}, {}, cookieA);
  check("logout returns 200", logout.statusCode === 200);
  check("logout expires the cookie (Max-Age=0)", logout.headers["set-cookie"].includes("Max-Age=0"));
  const meAfterLogout = await call(meH, "GET", {}, {}, cookieFrom(logout));
  check("session no longer resolves after logout", meAfterLogout.statusCode === 401);

  // ============================================================ 10e
  section("CHECK 10e: forgot-password / reset-password token flow");
  const emailA = `${U("alice")}@example.test`;
  const forgot = await call(forgotH, "POST", {}, { email: emailA });
  check("forgot-password returns 200", forgot.statusCode === 200);
  const generic = "If an account exists for that email address, a password reset link has been sent.";

  const forgotUnknown = await call(forgotH, "POST", {}, { email: `nobody-${stamp}@example.test` });
  check("unknown email returns the identical generic response",
    forgotUnknown.statusCode === 200 && forgotUnknown.body.message === generic);
  check("response body is byte-identical for known vs unknown email",
    JSON.stringify(forgotUnknown.body) === JSON.stringify(forgot.body));
  const badEmail = await call(forgotH, "POST", {}, { email: "not-an-email" });
  check("malformed email rejected with 400", badEmail.statusCode === 400);

  const tokenRow = await sql`
    SELECT t.token, t.expires_at, t.used
    FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
    WHERE lower(u.email) = lower(${emailA})
    ORDER BY t.id DESC LIMIT 1
  `;
  check("a reset token row was created", tokenRow.length === 1);
  const token = tokenRow[0].token;
  check("token is long and unguessable (>= 43 chars)", typeof token === "string" && token.length >= 43);
  check("token is not the user's password or any predictable value", token !== PASSWORD && !token.includes(userA.username));
  check("token starts unused", tokenRow[0].used === false);
  const ttlMin = (new Date(tokenRow[0].expires_at) - Date.now()) / 60000;
  check(`token expires in 30-60 minutes (got ${ttlMin.toFixed(1)} min)`, ttlMin > 30 && ttlMin <= 60);

  const wrongTok = await call(resetH, "POST", { token: "deadbeefdeadbeefdeadbeefdeadbeef" }, { new_password: NEW_PASSWORD });
  check("invalid token rejected with 400", wrongTok.statusCode === 400);
  const shortTok = await call(resetH, "POST", { token }, { new_password: "abc" });
  check("too-short new password rejected with 400", shortTok.statusCode === 400);

  const reset = await call(resetH, "POST", { token }, { new_password: NEW_PASSWORD });
  check("reset with a valid token returns 200", reset.statusCode === 200);
  const afterReset = await sql`SELECT used FROM password_reset_tokens WHERE token = ${token}`;
  check("token is marked used after redemption", afterReset[0].used === true);

  const reuse = await call(resetH, "POST", { token }, { new_password: "YetAnother!pw9" });
  check("token cannot be reused", reuse.statusCode === 400);
  const oldPw = await call(loginH, "POST", {}, { username: U("alice"), password: PASSWORD });
  check("OLD PASSWORD NO LONGER WORKS", oldPw.statusCode === 401);
  const newPw = await call(loginH, "POST", {}, { username: U("alice"), password: NEW_PASSWORD });
  check("NEW PASSWORD LOGS IN SUCCESSFULLY", newPw.statusCode === 200);
  cookieA = cookieFrom(newPw);

  // Expired token.
  const expiredTok = await sql`
    INSERT INTO password_reset_tokens (user_id, token, expires_at)
    VALUES (${userB.id}, ${`expired_${stamp}`}, now() - interval '1 hour')
    RETURNING token
  `;
  const expired = await call(resetH, "POST", { token: expiredTok[0].token }, { new_password: NEW_PASSWORD });
  check("expired token rejected with 400", expired.statusCode === 400);
  const bStillOld = await call(loginH, "POST", {}, { username: U("bob"), password: PASSWORD });
  check("expired token did not change that user's password", bStillOld.statusCode === 200);
  cookieB = cookieFrom(bStillOld);

  // ============================================================ 10f
  section("CHECK 10f: pre-accounts rows untouched with user_id = NULL");
  legacySnapshot = await sql`
    SELECT
      (SELECT count(*)::int FROM quiz_attempts WHERE user_id IS NULL)                  AS attempts_null,
      (SELECT count(*)::int FROM starred_questions WHERE user_id IS NULL)              AS stars_null,
      (SELECT count(*)::int FROM quiz_attempts)                                        AS attempts_total,
      (SELECT count(*)::int FROM starred_questions)                                    AS stars_total
  `;
  const ls = legacySnapshot[0];
  console.log(`    (attempts: ${ls.attempts_total}, of which ownerless ${ls.attempts_null}; stars: ${ls.stars_total}, of which ownerless ${ls.stars_null})`);

  // Snapshot the pre-existing (non-scratch) rows and confirm they are
  // byte-for-byte unchanged, still ownerless, and still readable only
  // by an admin.
  const legacyAttempts = await sql`
    SELECT id, category_id, mode, score, total_questions, finished_at
    FROM quiz_attempts WHERE user_id IS NULL ORDER BY id
  `;
  const legacyStars = await sql`
    SELECT id, question_id, category_id, starred_at
    FROM starred_questions WHERE user_id IS NULL ORDER BY id
  `;
  check(`all 48 pre-accounts attempts are still present and ownerless (${legacyAttempts.length})`, legacyAttempts.length === 48);
  check(`all 114 pre-accounts stars are still present and ownerless (${legacyStars.length})`, legacyStars.length === 114);
  check("pre-accounts attempts still carry their original modes",
    legacyAttempts.every((a) => ["full", "wrong_only", "starred_only"].includes(a.mode)));
  check("pre-accounts attempts kept their scores",
    legacyAttempts.some((a) => a.score !== null && a.total_questions !== null));

  // Orphaned legacy data must not leak into any regular user's history.
  const legacyCatId = legacyAttempts[0].category_id;
  const aLegacyWrong = await ok(wrongQ_H, "GET", { id: legacyCatId }, {}, cookieA);
  check("legacy wrong-question data is not attributed to a regular user", aLegacyWrong.length === 0);
  const aLegacyStar = await ok(starredQ_H, "GET", { id: legacyCatId }, {}, cookieA);
  check("legacy starred data is not attributed to a regular user", aLegacyStar.count === 0);
  const legacyAttemptForbidden = await call(resultsH, "GET", { id: legacyAttempts[0].id }, {}, cookieA);
  check("regular user cannot read a legacy (ownerless) attempt", legacyAttemptForbidden.statusCode === 403);

  section("CHECK 10d (cont): category stats and recent_attempts stay private");
  const catA = await ok(categoryByIdH, "GET", { id: catId }, {}, cookieA);
  const catB = await ok(categoryByIdH, "GET", { id: catId }, {}, cookieB);
  check("user A's attempt_count reflects only their own attempt", catA.attempt_count === 1);
  check("user B's attempt_count is 0 (cannot see user A's)", catB.attempt_count === 0);
  check("user A's recent_attempts contains only their own attempt",
    catA.recent_attempts.length === 1 && catA.recent_attempts[0].id === aAttempt.id);
  check("user B's recent_attempts is empty", catB.recent_attempts.length === 0);
  check("user B's best_score is null (no access to user A's score)", catB.best_score === null);

  section("CHECK 10g: deleting an account keeps their quiz history");
  const tempUser = await createUser(U("temp"));
  const tempLogin = await call(loginH, "POST", {}, { username: U("temp"), password: PASSWORD });
  const tempCookie = cookieFrom(tempLogin);
  const tempAttempt = await ok(attemptsH, "POST", {}, { category_id: catId, mode: "full" }, tempCookie);
  await ok(answersH, "POST", { id: tempAttempt.id }, { question_id: q1.id, selected_option_id: correctOpt(q1) }, tempCookie);
  await ok(finishH, "POST", { id: tempAttempt.id }, {}, tempCookie);
  await ok(starH, "POST", { id: q2.id }, {}, tempCookie);

  const preStar = await sql`
    SELECT count(*)::int c FROM starred_questions
    WHERE question_id = ${q2.id} AND user_id = ${tempUser.id}
  `;
  check("temp user has 1 attempt and 1 star before deletion", preStar[0].c === 1);

  await sql`DELETE FROM users WHERE id = ${tempUser.id}`;

  const afterAttempt = await sql`SELECT id, user_id FROM quiz_attempts WHERE id = ${tempAttempt.id}`;
  check("their attempt row SURVIVES the account deletion", afterAttempt.length === 1);
  check("the surviving attempt is orphaned (user_id = NULL), not deleted", afterAttempt[0].user_id === null);
  const afterStar = await sql`
    SELECT id, user_id FROM starred_questions
    WHERE question_id = ${q2.id} AND user_id IS NULL
  `;
  check("their starred row survives and is orphaned too (user_id = NULL)", afterStar.length === 1);
  const afterAnswers = await sql`SELECT count(*)::int c FROM attempt_answers WHERE attempt_id = ${tempAttempt.id}`;
  check("their individual answers survive as well", afterAnswers[0].c === 1);

  // Tidy the orphaned rows this section created (scratch rows, which the
  // scratch-subject delete would cascade anyway).
  await sql`DELETE FROM attempt_answers WHERE attempt_id = ${tempAttempt.id}`;
  await sql`DELETE FROM quiz_attempts WHERE id = ${tempAttempt.id}`;
  await sql`DELETE FROM starred_questions WHERE question_id = ${q2.id} AND user_id IS NULL`;

  // Content tables must be exactly as they were.
  const counts = await sql`
    SELECT
      (SELECT count(*)::int FROM subjects)   AS subjects,
      (SELECT count(*)::int FROM categories) AS categories,
      (SELECT count(*)::int FROM questions)  AS questions,
      (SELECT count(*)::int FROM options)    AS options
  `;
  check(`subjects/categories/questions/options intact (${counts[0].subjects}/${counts[0].categories}/${counts[0].questions}/${counts[0].options})`,
    counts[0].subjects === 4 && counts[0].categories === 25 && counts[0].questions === 2582 && counts[0].options === 10340);
} catch (err) {
  fail++;
  failures.push(`EXCEPTION: ${err.message}`);
  console.error("\nERROR DURING TEST:", err.message);
  console.error(err.stack);
} finally {
  // Tear down every scratch row this run created. Legacy rows and the
  // real subjects/categories/questions are never touched.
  try {
    if (scratchSubjectId) {
      await sql`DELETE FROM subjects WHERE id = ${scratchSubjectId}`;
      console.log(`\n(cleanup: deleted scratch subject ${scratchSubjectId})`);
    }
    const ids = [userA?.id, userB?.id, adminUser?.id].filter(Boolean);
    for (const id of ids) {
      await sql`DELETE FROM users WHERE id = ${id}`;
    }
    if (ids.length) console.log(`(cleanup: deleted ${ids.length} test users)`);
    await sql`DELETE FROM password_reset_tokens WHERE user_id IS NULL`;
  } catch (e) {
    console.error("cleanup failed:", e.message);
  }

  // Prove cleanup restored the pre-run state.
  try {
    const after = await sql`
      SELECT
        (SELECT count(*)::int FROM quiz_attempts WHERE user_id IS NULL) AS attempts_null,
        (SELECT count(*)::int FROM starred_questions WHERE user_id IS NULL) AS stars_null,
        (SELECT count(*)::int FROM subjects) AS subjects,
        (SELECT count(*)::int FROM categories) AS categories,
        (SELECT count(*)::int FROM questions) AS questions
    `;
    console.log(
      `\npost-cleanup: ownerless attempts=${after[0].attempts_null}, ownerless stars=${after[0].stars_null}, ` +
      `subjects=${after[0].subjects}, categories=${after[0].categories}, questions=${after[0].questions}`
    );
  } catch {}

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
  process.exit(fail ? 1 : 0);
}
