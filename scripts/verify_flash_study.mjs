// End-to-end verification for the flash-card study flow (/api/flash/sessions/*).
//
// Drives the real dispatch entry (api/index.js) with a real session cookie, so
// routing, auth, validation, the shared scheduler and the database are all
// exercised exactly as in production. Requires db/flash_001.sql to be applied.
//
//   node scripts/verify_flash_study.mjs
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
  const a = await createTestAccount({ label: "study_a" });
  const b = await createTestAccount({ label: "study_b" });

  try {
    // ---------- fixtures: a folder, a category and three new cards ----------
    let res = await call("POST", "/api/flash/folders", {
      cookie: a.cookie,
      body: { name: "Study deck" },
    });
    const folderId = res.body.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, name: "Study cat" },
    });
    const categoryId = res.body.id;

    const cardIds = [];
    for (let i = 1; i <= 3; i += 1) {
      res = await call("POST", "/api/flash/cards", {
        cookie: a.cookie,
        body: {
          category_id: categoryId,
          front: { blocks: [{ type: "text", text: `Q${i}` }] },
          back: { blocks: [{ type: "text", text: `A${i}` }] },
        },
      });
      cardIds.push(res.body.id);
    }
    check("fixtures: three cards created", cardIds.length === 3 && cardIds.every(Boolean));

    // ---------- start a session ----------
    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "category", scope_id: categoryId, mode: "due" },
    });
    check(
      "POST session -> 201 with the due queue",
      res.statusCode === 201 && res.body.queued === 3 && res.body.mode === "due",
      JSON.stringify(res.body)
    );
    const sessionId = res.body.id;
    check("session scope is recorded", res.body.scope_type === "category" && Number(res.body.scope_id) === Number(categoryId));

    // ---------- read the session back ----------
    res = await call("GET", `/api/flash/sessions/${sessionId}`, { cookie: a.cookie });
    check(
      "GET session returns its queue and settings",
      res.statusCode === 200 &&
        res.body.cards.length === 3 &&
        res.body.settings?.scheduler === "fsrs" &&
        res.body.cards[0].front?.blocks?.[0]?.text === "Q1",
      JSON.stringify(res.body?.cards?.[0] ?? res.body).slice(0, 160)
    );
    check("queued cards start unreviewed", res.body.cards.every((c) => c.reviewed === false && c.position >= 0));

    res = await call("GET", "/api/flash/sessions", { cookie: a.cookie });
    check(
      "GET sessions lists the new session",
      res.statusCode === 200 && res.body.sessions.some((s) => String(s.id) === String(sessionId)),
      JSON.stringify(res.body).slice(0, 160)
    );

    // ---------- record reviews ----------
    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: a.cookie,
      body: { card_id: cardIds[0], rating: "good", think_ms: 4200, total_ms: 6000 },
    });
    check(
      "review good -> learning state + completed 1",
      res.statusCode === 200 &&
        res.body.state?.state === 1 &&
        res.body.completed_count === 1 &&
        typeof res.body.preview?.good === "string",
      JSON.stringify(res.body).slice(0, 220)
    );

    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: a.cookie,
      body: { card_id: cardIds[0], rating: "hard" },
    });
    check(
      "re-answering a card does not double count",
      res.statusCode === 200 && res.body.already_reviewed === true && res.body.completed_count === 1,
      JSON.stringify(res.body).slice(0, 200)
    );

    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: a.cookie,
      body: { card_id: cardIds[1], rating: 4 },
    });
    check("review easy by number -> completed 2", res.statusCode === 200 && res.body.completed_count === 2);

    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: a.cookie,
      body: { card_id: cardIds[2], rating: 9 },
    });
    check("invalid rating -> 400", res.statusCode === 400 && typeof res.body.error === "string");

    // A card that is not in this session cannot be answered through it.
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        front: { blocks: [{ type: "text", text: "outside" }] },
        back: { blocks: [{ type: "text", text: "outside" }] },
      },
    });
    const outsiderId = res.body.id;
    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: a.cookie,
      body: { card_id: outsiderId, rating: "good" },
    });
    check("review a card outside the session -> 400", res.statusCode === 400);

    // ---------- flat POST /api/flash/reviews ----------
    // Its own sitting: these answers must not change the summary asserted below
    // for `sessionId`.
    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "all", mode: "all" },
    });
    const flatSessionId = res.body.id;
    check("flat-review fixture session created", res.statusCode === 201 && Boolean(flatSessionId));

    res = await call("POST", "/api/flash/reviews", {
      cookie: a.cookie,
      body: {
        session_id: flatSessionId,
        card_id: cardIds[1],
        rating: "hard",
        think_ms: 900,
        total_ms: 1500,
        is_echo: false,
      },
    });
    check(
      "POST /api/flash/reviews -> 200 with the new due date",
      res.statusCode === 200 &&
        typeof res.body.due === "string" &&
        res.body.is_echo === false &&
        res.body.session_id === Number(flatSessionId),
      JSON.stringify(res.body).slice(0, 220)
    );
    const completedAfterFlat = res.body.completed_count;

    // is_echo marks a repeat answer: it is logged, but never moves the counter.
    res = await call("POST", "/api/flash/reviews", {
      cookie: a.cookie,
      body: { session_id: flatSessionId, card_id: cardIds[1], rating: "good", is_echo: true },
    });
    check(
      "is_echo is recorded and does not bump completed_count",
      res.statusCode === 200 && res.body.is_echo === true && res.body.completed_count === completedAfterFlat,
      JSON.stringify(res.body).slice(0, 220)
    );

    res = await call("POST", "/api/flash/reviews", {
      cookie: a.cookie,
      body: { card_id: cardIds[0], rating: 1 },
    });
    check("flat review without session_id -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/reviews", {
      cookie: a.cookie,
      body: { session_id: flatSessionId, card_id: cardIds[0], rating: 9 },
    });
    check("flat review with an invalid rating -> 400", res.statusCode === 400);

    // ---------- finish + summary ----------
    res = await call("POST", `/api/flash/sessions/${sessionId}/finish`, { cookie: a.cookie });
    check(
      "finish -> summary counts every logged answer",
      res.statusCode === 200 &&
        res.body.session.finished_at != null &&
        res.body.summary.total === 3 &&
        res.body.summary.good === 1 &&
        res.body.summary.hard === 1 &&
        res.body.summary.easy === 1,
      JSON.stringify(res.body.summary)
    );

    res = await call("POST", `/api/flash/sessions/${sessionId}/finish`, { cookie: a.cookie });
    check("finish is idempotent", res.statusCode === 200 && res.body.summary.total === 3);

    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: a.cookie,
      body: { card_id: cardIds[2], rating: "good" },
    });
    check("review on a finished session -> 409", res.statusCode === 409);

    // ---------- cross-user isolation ----------
    res = await call("GET", `/api/flash/sessions/${sessionId}`, { cookie: b.cookie });
    check("other user cannot read a session -> 404", res.statusCode === 404);
    res = await call("POST", `/api/flash/sessions/${sessionId}/review`, {
      cookie: b.cookie,
      body: { card_id: cardIds[0], rating: "good" },
    });
    check("other user cannot review through a session -> 404", res.statusCode === 404);
    res = await call("POST", `/api/flash/sessions/${sessionId}/finish`, { cookie: b.cookie });
    check("other user cannot finish a session -> 404", res.statusCode === 404);
    res = await call("DELETE", `/api/flash/sessions/${sessionId}`, { cookie: b.cookie });
    check("other user cannot delete a session -> 404", res.statusCode === 404);

    // ---------- modes ----------
    // Park two cards far in the future so exactly one original card stays due
    // today (the outsider card is due too, giving two).
    await sql`
      UPDATE fc_card_state SET due = now() + interval '10 days'
      WHERE card_id = ANY(${[cardIds[0], cardIds[1]]}::int[])
    `;

    // Focus is floored at focus_min, so with the default of 10 it would keep
    // everything that is due. Shrink the knobs for this account so the fraction
    // is the binding constraint and the slice is observable.
    await sql`
      INSERT INTO fc_settings (user_id, key, value) VALUES
        (${String(a.id)}, 'focus_fraction', '0.5'::jsonb),
        (${String(a.id)}, 'focus_min', '1'::jsonb)
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `;

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "folder", scope_id: folderId, mode: "focus" },
    });
    check(
      "focus queues a bounded slice of what is due",
      res.statusCode === 201 && res.body.queued === 1 && res.body.mode === "focus",
      JSON.stringify(res.body).slice(0, 160)
    );
    const focusId = res.body.id;

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "category", scope_id: categoryId, mode: "struggling" },
    });
    check("struggling is empty until a score crosses the line", res.statusCode === 201 && res.body.queued === 0);

    await sql`UPDATE fc_card_state SET struggle_score = 0.9 WHERE card_id = ${cardIds[2]}`;
    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "category", scope_id: categoryId, mode: "struggling" },
    });
    check("struggling queues the flagged card", res.statusCode === 201 && res.body.queued >= 1);

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "all", mode: "all" },
    });
    check("scope all / mode all queues every unsuspended card", res.statusCode === 201 && res.body.queued === 4);

    // ---------- validation ----------
    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "category", mode: "due" },
    });
    check("scoped session without scope_id -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "category", scope_id: 999999, mode: "due" },
    });
    check("unknown category -> 404", res.statusCode === 404);

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "nope" },
    });
    check("unknown scope_type -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "all", mode: "nope" },
    });
    check("unknown mode -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "all", fraction: 2 },
    });
    check("fraction above 1 -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/sessions", {
      cookie: a.cookie,
      body: { scope_type: "all", limit: 99999 },
    });
    check("limit above the cap -> 400", res.statusCode === 400);

    // ---------- abandon ----------
    res = await call("DELETE", `/api/flash/sessions/${focusId}`, { cookie: a.cookie });
    check("DELETE session abandons it", res.statusCode === 200 && res.body.deleted === true);
    res = await call("GET", `/api/flash/sessions/${focusId}`, { cookie: a.cookie });
    check("abandoned session is gone", res.statusCode === 404);

    res = await call("GET", `/api/flash/sessions/${sessionId}`, { cookie: a.cookie });
    check("the finished session survives abandonment of another", res.statusCode === 200);
  } finally {
    // fc_ rows are not FK'd to users, so delete them explicitly, then accounts.
    // Sessions have no FK to folders, so they need their own cleanup.
    await sql`DELETE FROM fc_sessions WHERE user_id = ${String(a.id)} OR user_id = ${String(b.id)}`;
    await sql`DELETE FROM fc_settings WHERE user_id = ${String(a.id)} OR user_id = ${String(b.id)}`;
    await sql`DELETE FROM fc_folders WHERE user_id = ${String(a.id)} OR user_id = ${String(b.id)}`;
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
