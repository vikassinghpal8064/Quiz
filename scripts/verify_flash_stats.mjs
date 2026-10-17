// End-to-end verification for the flash-card stats + settings endpoints
// (GET /api/flash/stats, GET /api/flash/stats/overview, GET/PATCH
// /api/flash/settings), plus the "struggle" session mode the stats page uses.
//
//   node scripts/verify_flash_stats.mjs
//
// Drives the real dispatch entry (api/index.js) with a real session cookie, so
// routing, auth, validation, the shared stat model and the database are all
// exercised exactly as in production. Requires db/flash_001.sql and
// db/flash_004.sql to be applied.
//
// The review history is written directly into fc_review_logs (session_id has no
// FK) so reviewed_at, state_before and stability_before are deterministic; card
// state is set directly too. That is what makes the streak, retention and
// forecast numbers assertable to the digit.
process.loadEnvFile(".env");

const { createTestAccount } = await import("./_auth_fixture.mjs");
const { default: dispatch } = await import("../api/index.js");
const { default: sql } = await import("../api/_lib/db.js");
const { HEATMAP_WEEKS } = await import("../src/modules/flashcards/lib/statsModel.js");

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
  r.setHeader = (k, v) => {
    r.headers[String(k).toLowerCase()] = v;
  };
  r.status = (code) => ({
    json: (p) => {
      r.statusCode = code;
      r.body = p;
    },
    end: () => {
      r.statusCode = code;
    },
  });
  r.json = (p) => {
    r.statusCode = 200;
    r.body = p;
  };
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

async function main() {
  const a = await createTestAccount({ label: "stats_a" });
  const b = await createTestAccount({ label: "stats_b" });
  const uid = String(a.id);

  try {
    // ---------- fixtures ----------
    let res = await call("POST", "/api/flash/folders", {
      cookie: a.cookie,
      body: { name: "Stats deck" },
    });
    const folderId = res.body.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, name: "Parent cat" },
    });
    const catId = res.body.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, parent_id: catId, name: "Nested cat" },
    });
    const subId = res.body.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, name: "Sibling cat" },
    });
    const otherId = res.body.id;

    const mkCard = async (categoryId, label) => {
      const r = await call("POST", "/api/flash/cards", {
        cookie: a.cookie,
        body: {
          category_id: categoryId,
          front: { blocks: [{ type: "text", text: label }] },
          back: { blocks: [{ type: "text", text: `${label} answer` }] },
        },
      });
      return r.body.id;
    };
    const c1 = await mkCard(catId, "C1");
    const c2 = await mkCard(catId, "C2");
    const c3 = await mkCard(subId, "C3");
    const c4 = await mkCard(otherId, "C4");
    check("fixtures: four cards created", [c1, c2, c3, c4].every(Boolean));

    // ---------- a deterministic review history ----------
    // Six logs: two today, two yesterday, one two days ago, one three days ago.
    const addLog = ({ cardId, rating, think, stateBefore, stabilityBefore, daysAgo }) =>
      sql`
        INSERT INTO fc_review_logs
          (user_id, card_id, rating, think_ms, state_before, stability_before, reviewed_at)
        VALUES (
          ${uid}, ${cardId}, ${rating}, ${think}, ${stateBefore}, ${stabilityBefore},
          now() - (${daysAgo}::int * interval '1 day')
        )
      `;
    await addLog({ cardId: c1, rating: 3, think: 4000, stateBefore: 2, stabilityBefore: 100, daysAgo: 0 });
    await addLog({ cardId: c2, rating: 1, think: 6000, stateBefore: 2, stabilityBefore: 5, daysAgo: 0 });
    await addLog({ cardId: c3, rating: 3, think: 3000, stateBefore: 1, stabilityBefore: 0, daysAgo: 1 });
    await addLog({ cardId: c4, rating: 3, think: 8000, stateBefore: 0, stabilityBefore: null, daysAgo: 2 });
    await addLog({ cardId: c1, rating: 1, think: 2000, stateBefore: 2, stabilityBefore: 100, daysAgo: 1 });
    await addLog({ cardId: c4, rating: 3, think: 5000, stateBefore: 2, stabilityBefore: 50, daysAgo: 3 });

    // ---------- a deterministic card state ----------
    const setState = (cardId, { state, stability, due, struggle, lapses }) =>
      sql`
        UPDATE fc_card_state SET
          state = ${state},
          stability = ${stability},
          due = ${due}::timestamptz,
          struggle_score = ${struggle},
          lapses = ${lapses}
        WHERE card_id = ${cardId} AND user_id = ${uid}
      `;
    const inDays = (n) => new Date(Date.now() + n * 86_400_000);
    await setState(c1, { state: 2, stability: 100, due: new Date(), struggle: 0.4, lapses: 3 });
    await setState(c2, { state: 2, stability: 5, due: inDays(10), struggle: 0.9, lapses: 5 });
    await setState(c3, { state: 1, stability: 0, due: inDays(-1), struggle: 0, lapses: 0 });
    await setState(c4, { state: 0, stability: null, due: null, struggle: 0, lapses: 0 });

    // ================= GET /api/flash/stats =================
    res = await call("GET", "/api/flash/stats", { cookie: a.cookie });
    check("GET stats -> 200", res.statusCode === 200 && res.body && typeof res.body === "object");
    const stats = res.body;

    // Heatmap / streak
    check("heatmap is a full 53 weeks", stats.heatmap?.cells?.length === HEATMAP_WEEKS * 7 && stats.heatmap?.weeks?.length === HEATMAP_WEEKS);
    check("heatmap counts every review", stats.heatmap?.total === 6, `total=${stats.heatmap?.total}`);
    check("heatmap busiest day is 2", stats.heatmap?.max === 2, `max=${stats.heatmap?.max}`);
    check("current streak spans the four active days", stats.heatmap?.current_streak === 4, `streak=${stats.heatmap?.current_streak}`);

    // Retention (true retention of mature reviews)
    check(
      "retention overall counts only Review-state answers",
      stats.retention?.overall?.total === 4 && stats.retention?.overall?.correct === 2,
      JSON.stringify(stats.retention?.overall)
    );
    check(
      "mature retention is 2/3",
      stats.retention?.mature?.total === 3 && stats.retention?.mature?.correct === 2,
      JSON.stringify(stats.retention?.mature)
    );
    check(
      "young retention is 0/1",
      stats.retention?.young?.total === 1 && stats.retention?.young?.correct === 0,
      JSON.stringify(stats.retention?.young)
    );

    // Due forecast
    check("forecast is a 30-day series", stats.due_forecast?.days?.length === 30);
    check(
      "overdue is folded into the first bar",
      stats.due_forecast?.days?.[0]?.count === 2 && stats.due_forecast?.overdue === 1,
      JSON.stringify(stats.due_forecast?.days?.[0])
    );
    check(
      "the card due in 10 days lands on the right bar",
      stats.due_forecast?.days?.[10]?.count === 1,
      JSON.stringify(stats.due_forecast?.days?.[10])
    );
    check("forecast total is today + overdue + the 10-day card", stats.due_forecast?.total === 3, `total=${stats.due_forecast?.total}`);

    // Cards by state
    check(
      "cards split into new/learning/review/mastered",
      stats.states?.new === 1 &&
        stats.states?.learning === 1 &&
        stats.states?.review === 1 &&
        stats.states?.mastered === 1 &&
        stats.states?.total === 4,
      JSON.stringify(stats.states)
    );

    // Think-time trend
    check("trend is a 30-day series", stats.think_trend?.days?.length === 30);
    check("trend reports a positive average", stats.think_trend?.average_ms > 0, `avg=${stats.think_trend?.average_ms}`);

    // Hardest cards
    check(
      "hardest card is the highest struggle score",
      Array.isArray(stats.hardest) && stats.hardest[0]?.id === c2 && stats.hardest[0]?.struggle_score >= 0.9,
      JSON.stringify(stats.hardest?.[0] ?? null).slice(0, 160)
    );
    check("hardest rows carry the joined category name", stats.hardest[0]?.category_name === "Parent cat");

    // Daily goal is present (default from fc_settings / DEFAULT_SETTINGS)
    check("stats carries the daily goal", stats.daily_goal === 30, `goal=${stats.daily_goal}`);

    // ---------- scope: folder ----------
    res = await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { folderId: folderId } });
    check(
      "folder scope sees every card in the folder",
      res.statusCode === 200 && res.body.states?.total === 4 && res.body.retention?.overall?.total === 4,
      JSON.stringify(res.body.states)
    );

    // ---------- scope: category (includes nested) ----------
    res = await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { categoryId: catId } });
    check(
      "category scope includes the nested category",
      res.statusCode === 200 && res.body.states?.total === 3,
      JSON.stringify(res.body.states)
    );
    check(
      "category scope narrows retention too",
      res.body.retention?.overall?.total === 3 && res.body.retention?.overall?.correct === 1,
      JSON.stringify(res.body.retention?.overall)
    );

    res = await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { categoryId: subId } });
    check(
      "leaf category scope sees only its own card",
      res.statusCode === 200 && res.body.states?.total === 1,
      JSON.stringify(res.body.states)
    );

    // ---------- scope: range ----------
    // A 2-day window drops the two oldest logs (2 and 3 days old), leaving the
    // three Review-state answers from today and yesterday.
    res = await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { days: 2 } });
    check(
      "the range window narrows retention and the trend",
      res.statusCode === 200 && res.body.retention?.overall?.total === 3 && res.body.think_trend?.days?.length === 2,
      JSON.stringify({ retention: res.body.retention?.overall, trend: res.body.think_trend?.days?.length })
    );

    // ---------- scope validation ----------
    check("folderId=0 -> 400", (await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { folderId: 0 } })).statusCode === 400);
    check("categoryId=-1 -> 400", (await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { categoryId: -1 } })).statusCode === 400);
    check("days=abc -> 400", (await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { days: "abc" } })).statusCode === 400);
    check("days beyond the cap -> 400", (await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { days: 9999 } })).statusCode === 400);
    check("limit beyond the cap -> 400", (await call("GET", "/api/flash/stats", { cookie: a.cookie, query: { limit: 9999 } })).statusCode === 400);

    // ---------- cross-user isolation ----------
    res = await call("GET", "/api/flash/stats", { cookie: b.cookie });
    check(
      "another account sees none of this history",
      res.statusCode === 200 && res.body.heatmap?.total === 0 && res.body.states?.total === 0 && res.body.hardest?.length === 0,
      JSON.stringify({ heatmap: res.body.heatmap?.total, states: res.body.states?.total })
    );
    check("unauthenticated stats -> 401", (await call("GET", "/api/flash/stats")).statusCode === 401);

    // ================= GET /api/flash/stats/overview =================
    res = await call("GET", "/api/flash/stats/overview", { cookie: a.cookie });
    check("GET overview -> 200", res.statusCode === 200);
    const overview = res.body;
    check("overview counts today's reviews", overview.reviews_today === 2, `reviews_today=${overview.reviews_today}`);
    check("overview reports no new cards today", overview.new_today === 0, `new_today=${overview.new_today}`);
    check("overview counts what is due today (overdue included)", overview.due_today === 2, `due_today=${overview.due_today}`);
    check("overview carries the streak", overview.current_streak === 4, `streak=${overview.current_streak}`);
    check("overview carries the goal and its progress", overview.daily_goal === 30 && overview.goal_progress > 0 && overview.goal_progress <= 1);
    check("overview flags that today was studied", overview.studied_today === true);

    // ================= settings =================
    res = await call("GET", "/api/flash/settings", { cookie: a.cookie });
    check(
      "GET settings -> defaults filled in",
      res.statusCode === 200 && res.body.settings?.daily_goal === 30 && res.body.settings?.new_cards_per_day === 20,
      JSON.stringify(res.body.settings)
    );
    check("settings lists the editable keys", Array.isArray(res.body.editable) && res.body.editable.includes("daily_goal"));

    res = await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { daily_goal: 50 } });
    check("PATCH daily_goal -> 200 and persists", res.statusCode === 200 && res.body.settings?.daily_goal === 50, JSON.stringify(res.body).slice(0, 160));

    res = await call("GET", "/api/flash/settings", { cookie: a.cookie });
    check("the new goal survives a re-read", res.body.settings?.daily_goal === 50);
    check(
      "GET settings returns a schema for the UI",
      res.statusCode === 200 && typeof res.body.schema === "object" && res.body.schema?.desired_retention?.max === 0.97,
      JSON.stringify(res.body.schema?.desired_retention)
    );

    res = await call("GET", "/api/flash/stats/overview", { cookie: a.cookie });
    check("the overview reflects the new goal", res.body.daily_goal === 50, `goal=${res.body.daily_goal}`);

    check("PATCH daily_goal=0 -> 400", (await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { daily_goal: 0 } })).statusCode === 400);
    check("PATCH an unknown key -> 400", (await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { not_a_setting: 1 } })).statusCode === 400);

    res = await call("PATCH", "/api/flash/settings", {
      cookie: a.cookie,
      body: { desired_retention: 0.9, focus_fraction: 0.3, scheduler: "sm2", auto_downgrade_shaky_correct: true, theme: "dark" },
    });
    check(
      "PATCH typed settings -> 200 and persists",
      res.statusCode === 200 &&
        res.body.settings?.desired_retention === 0.9 &&
        res.body.settings?.focus_fraction === 0.3 &&
        res.body.settings?.scheduler === "sm2" &&
        res.body.settings?.auto_downgrade_shaky_correct === true &&
        res.body.settings?.theme === "dark",
      JSON.stringify(res.body.settings)
    );

    res = await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { struggle_weights: { time: 0.5, again: 0.5 } } });
    check(
      "PATCH struggle_weights merges over the defaults",
      res.statusCode === 200 && res.body.settings?.struggle_weights?.time === 0.5 && res.body.settings?.struggle_weights?.lapse === 0.2,
      JSON.stringify(res.body.settings?.struggle_weights)
    );

    check("PATCH desired_retention out of range -> 400", (await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { desired_retention: 0.5 } })).statusCode === 400);
    check("PATCH scheduler with an unknown name -> 400", (await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { scheduler: "anki" } })).statusCode === 400);
    check("PATCH struggle_weights with a bad value -> 400", (await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: { struggle_weights: { time: 4 } } })).statusCode === 400);
    check("PATCH an empty body -> 400", (await call("PATCH", "/api/flash/settings", { cookie: a.cookie, body: {} })).statusCode === 400);
    check("GET settings unauthenticated -> 401", (await call("GET", "/api/flash/settings")).statusCode === 401);

    // ================= struggle mode =================
    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "all", mode: "struggle" },
    });
    check("POST struggle session -> 201", res.statusCode === 201 && res.body.mode === "struggle" && res.body.queued === 4, JSON.stringify(res.body).slice(0, 160));
    const struggleSessionId = res.body.id;

    res = await call("GET", `/api/flash/sessions/${struggleSessionId}`, { cookie: a.cookie });
    check(
      "struggle session leads with the hardest card",
      res.statusCode === 200 && res.body.cards?.[0]?.id === c2,
      JSON.stringify(res.body.cards?.map((c) => c.id))
    );

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "category", scope_id: catId, mode: "struggle" },
    });
    check(
      "scoped struggle session stays inside the category",
      res.statusCode === 201 && res.body.queued === 3,
      JSON.stringify(res.body).slice(0, 160)
    );
  } finally {
    await sql`DELETE FROM fc_sessions WHERE user_id = ${uid} OR user_id = ${String(b.id)}`;
    await sql`DELETE FROM fc_settings WHERE user_id = ${uid} OR user_id = ${String(b.id)}`;
    await sql`DELETE FROM fc_folders WHERE user_id = ${uid} OR user_id = ${String(b.id)}`;
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
