// End-to-end verification for the flash-card API (/api/flash/*).
//
// Drives the real dispatch entry (api/index.js) with a real session cookie, so
// routing, auth and the database are all exercised exactly as in production.
// Requires db/flash_001.sql to be applied. Creates a throwaway account and its
// throwaway flash rows, then removes both in cleanup - no real user data is
// touched (fc_ rows are not FK'd to users, so they are deleted explicitly).
//
//   node scripts/verify_flash_crud.mjs
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

async function main() {
  const a = await createTestAccount({ label: "flash_a" });
  const b = await createTestAccount({ label: "flash_b" });
  let folderId = null;
  let categoryId = null;
  let category2Id = null;
  let cardId = null;

  try {
    // ---------- folders ----------
    let res = await call("GET", "/api/flash/folders", { cookie: a.cookie });
    check("GET folders starts empty", res.statusCode === 200 && Array.isArray(res.body) && res.body.length === 0);

    res = await call("POST", "/api/flash/folders", {
      cookie: a.cookie,
      body: { name: "Deck A", description: "first", color: "#3366ff", icon: "book", sort_order: 2 },
    });
    check("POST folder -> 201 with counts", res.statusCode === 201 && res.body.name === "Deck A" && res.body.category_count === 0 && res.body.card_count === 0, JSON.stringify(res.body));
    folderId = res.body.id;

    res = await call("POST", "/api/flash/folders", { cookie: a.cookie, body: {} });
    check("POST folder without name -> 400", res.statusCode === 400 && typeof res.body.error === "string");

    res = await call("GET", "/api/flash/folders", { cookie: a.cookie });
    check("GET folders lists the deck", res.statusCode === 200 && res.body.length === 1 && res.body[0].id === folderId);

    res = await call("PATCH", `/api/flash/folders/${folderId}`, { cookie: a.cookie, body: { name: "Deck A+" } });
    check("PATCH folder renames", res.statusCode === 200 && res.body.name === "Deck A+" && res.body.category_count === 0);

    res = await call("PATCH", `/api/flash/folders/${folderId}`, { cookie: a.cookie, body: {} });
    check("PATCH folder with no fields -> 400", res.statusCode === 400);

    // ---------- categories ----------
    res = await call("POST", "/api/flash/categories", { cookie: a.cookie, body: { folder_id: folderId, name: "Cat 1" } });
    check("POST category -> 201", res.statusCode === 201 && res.body.name === "Cat 1" && res.body.card_count === 0, JSON.stringify(res.body));
    categoryId = res.body.id;

    res = await call("POST", "/api/flash/categories", { cookie: a.cookie, body: { folder_id: folderId, name: "Cat 2" } });
    check("POST second category -> 201", res.statusCode === 201);
    category2Id = res.body.id;

    res = await call("POST", "/api/flash/categories", { cookie: a.cookie, body: { folder_id: 999999, name: "Orphan" } });
    check("POST category with unknown folder -> 404", res.statusCode === 404);

    res = await call("POST", "/api/flash/categories", { cookie: a.cookie, body: { folder_id: folderId, name: "Bad parent", parent_id: 999999 } });
    check("POST category with unknown parent -> 400", res.statusCode === 400);

    res = await call("GET", "/api/flash/categories", { cookie: a.cookie, query: { folderId: String(folderId) } });
    check("GET categories -> 2", res.statusCode === 200 && res.body.length === 2);

    res = await call("GET", "/api/flash/categories", { cookie: a.cookie });
    check("GET categories without folderId -> 400", res.statusCode === 400);

    // nested child, then cycle guard
    res = await call("POST", "/api/flash/categories", { cookie: a.cookie, body: { folder_id: folderId, name: "Child", parent_id: categoryId } });
    check("POST nested category -> 201", res.statusCode === 201);
    const childId = res.body.id;

    res = await call("PATCH", `/api/flash/categories/${categoryId}`, { cookie: a.cookie, body: { parent_id: categoryId } });
    check("PATCH category to its own id -> 400", res.statusCode === 400);

    res = await call("PATCH", `/api/flash/categories/${categoryId}`, { cookie: a.cookie, body: { parent_id: childId } });
    check("PATCH category under its descendant -> 400", res.statusCode === 400);

    // ---------- card creation ----------
    const goodFront = { blocks: [{ type: "text", text: "alpha" }] };
    const goodBack = { blocks: [{ type: "text", text: "beta" }] };
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: { category_id: categoryId, card_type: "basic", front: goodFront, back: goodBack, tags: ["x", "y"] },
    });
    check("POST card -> 201 with New state and due", res.statusCode === 201 && text(res.body) === "alpha" && res.body.state === 0 && res.body.due != null, JSON.stringify(res.body));
    cardId = res.body.id;

    res = await call("POST", "/api/flash/cards", { cookie: a.cookie, body: { category_id: categoryId, front: { blocks: [{ type: "text" }] }, back: goodBack } });
    check("POST card with invalid front block -> 400", res.statusCode === 400 && /front\.blocks\[0\]\.text/.test(res.body.error), JSON.stringify(res.body));

    res = await call("POST", "/api/flash/cards", { cookie: a.cookie, body: { category_id: categoryId, front: goodFront } });
    check("POST card without back -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/cards", { cookie: a.cookie, body: { category_id: categoryId, front: { blocks: [{ type: "video" }] }, back: goodBack } });
    check("POST card with unknown block type -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/cards", { cookie: a.cookie, body: { category_id: 999999, front: goodFront, back: goodBack } });
    check("POST card into unknown category -> 404", res.statusCode === 404);

    // ---------- bulk create ----------
    const bulk = [1, 2, 3].map((n) => ({
      category_id: categoryId,
      front: { blocks: [{ type: "text", text: `bulk ${n}` }] },
      back: { blocks: [{ type: "text", text: "b" }] },
      tags: ["bulk"],
    }));
    res = await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards: bulk } });
    check("POST bulk -> 201 inserted 3", res.statusCode === 201 && res.body.inserted === 3 && res.body.cards.length === 3, JSON.stringify(res.body).slice(0, 200));

    res = await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards: [] } });
    check("POST bulk empty -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards: Array.from({ length: 501 }, () => ({ category_id: categoryId, front: goodFront, back: goodBack })) } });
    check("POST bulk over 500 -> 400", res.statusCode === 400 && /500/.test(res.body.error));

    res = await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards: [{ category_id: categoryId, front: goodFront, back: goodBack }, { category_id: categoryId, front: { blocks: [{ type: "text" }] }, back: goodBack }] } });
    check("POST bulk with one bad card -> 400 and nothing else", res.statusCode === 400);

    // ---------- list / search / paginate ----------
    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { categoryId: String(categoryId) } });
    check("GET cards by category -> 4 total", res.statusCode === 200 && res.body.cards.length === 4 && res.body.nextCursor === null, `len=${res.body.cards?.length}`);

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { q: "alpha" } });
    check("GET cards search finds content", res.statusCode === 200 && res.body.cards.length === 1 && text(res.body.cards[0]) === "alpha");

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { q: "text" } });
    check("GET cards search ignores block-type words", res.statusCode === 200 && res.body.cards.length === 0, `len=${res.body.cards?.length}`);

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { tag: "bulk" } });
    check("GET cards by tag -> 3", res.statusCode === 200 && res.body.cards.length === 3);

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { limit: "2" } });
    const page1 = res.body.cards.map((c) => c.id);
    check("GET cards limit=2 returns nextCursor", res.statusCode === 200 && res.body.cards.length === 2 && res.body.nextCursor != null, JSON.stringify(res.body.nextCursor));
    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { limit: "2", cursor: String(res.body.nextCursor) } });
    const page2 = res.body.cards.map((c) => c.id);
    check("GET cards second page is disjoint", page2.length === 2 && page1.every((id) => !page2.includes(id)));

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { limit: "9999" } });
    check("GET cards limit over max -> 400", res.statusCode === 400);

    res = await call("GET", "/api/flash/cards", { cookie: a.cookie, query: { cursor: "abc" } });
    check("GET cards bad cursor -> 400", res.statusCode === 400);

    // ---------- update / move / suspend ----------
    res = await call("PATCH", `/api/flash/cards/${cardId}`, {
      cookie: a.cookie,
      body: { front: { blocks: [{ type: "text", text: "alpha2" }] }, tags: ["z"] },
    });
    check("PATCH card updates content", res.statusCode === 200 && text(res.body) === "alpha2" && JSON.stringify(res.body.tags) === '["z"]');

    res = await call("PATCH", `/api/flash/cards/${cardId}`, { cookie: a.cookie, body: { suspended: true } });
    check("PATCH card suspends", res.statusCode === 200 && res.body.suspended === true);

    // A suspended card must drop out of the "due today" count.
    res = await call("GET", "/api/flash/categories", { cookie: a.cookie, query: { folderId: String(folderId) } });
    const catSuspended = res.body.find((c) => c.id === categoryId);
    check(
      "suspended cards are excluded from due_count",
      catSuspended?.due_count === 3,
      `due=${catSuspended?.due_count}`
    );

    res = await call("PATCH", `/api/flash/cards/${cardId}`, { cookie: a.cookie, body: {} });
    check("PATCH card with no fields -> 400", res.statusCode === 400);

    res = await call("POST", "/api/flash/cards/move", { cookie: a.cookie, body: { card_ids: [cardId], category_id: category2Id } });
    check("POST cards/move moves a card", res.statusCode === 200 && res.body.moved === 1 && res.body.category_id === category2Id);

    res = await call("POST", "/api/flash/cards/move", { cookie: a.cookie, body: { card_ids: [cardId], category_id: 999999 } });
    check("POST cards/move to unknown category -> 404", res.statusCode === 404);

    res = await call("POST", "/api/flash/cards/suspend", { cookie: a.cookie, body: { card_ids: [cardId], suspended: false } });
    check("POST cards/suspend unsuspends", res.statusCode === 200 && res.body.updated === 1 && res.body.suspended === false);

    res = await call("POST", "/api/flash/cards/suspend", { cookie: a.cookie, body: {} });
    check("POST cards/suspend without ids -> 400", res.statusCode === 400);

    // category counts now reflect the moves
    res = await call("GET", "/api/flash/categories", { cookie: a.cookie, query: { folderId: String(folderId) } });
    const cat1 = res.body.find((c) => c.id === categoryId);
    const cat2 = res.body.find((c) => c.id === category2Id);
    check("category card_count tracks moves", cat1?.card_count === 3 && cat2?.card_count === 1, `cat1=${cat1?.card_count} cat2=${cat2?.card_count}`);

    // ---------- due / struggling aggregates (added for the UI) ----------
    check(
      "category rows carry due_count and struggling_count",
      cat1?.due_count === 3 && cat1?.struggling_count === 0 && cat2?.due_count === 1,
      `cat1.due=${cat1?.due_count} cat1.struggling=${cat1?.struggling_count} cat2.due=${cat2?.due_count}`
    );

    res = await call("GET", "/api/flash/folders", { cookie: a.cookie });
    const folderRow = res.body.find((f) => f.id === folderId);
    check(
      "folder rows carry due_count across the whole deck",
      folderRow?.due_count === 4 && folderRow?.card_count === 4,
      `due=${folderRow?.due_count} cards=${folderRow?.card_count}`
    );

    // struggle_score above the threshold flips struggling_count.
    await sql`UPDATE fc_card_state SET struggle_score = 0.8 WHERE card_id = ${cardId}`;
    res = await call("GET", "/api/flash/categories", { cookie: a.cookie, query: { folderId: String(folderId) } });
    const catStruggling = res.body.find((c) => c.id === category2Id);
    check(
      "struggling_count reflects struggle_score",
      catStruggling?.struggling_count === 1,
      `struggling=${catStruggling?.struggling_count}`
    );

    // ---------- single-category GET ----------
    res = await call("GET", `/api/flash/categories/${categoryId}`, { cookie: a.cookie });
    check(
      "GET category returns folder name and counts",
      res.statusCode === 200 &&
        res.body.folder_name === "Deck A+" &&
        res.body.due_count === 3 &&
        typeof res.body.struggling_count === "number",
      JSON.stringify(res.body)
    );

    res = await call("GET", `/api/flash/categories/999999`, { cookie: a.cookie });
    check("GET category unknown -> 404", res.statusCode === 404);

    // ---------- cross-user isolation ----------
    res = await call("GET", "/api/flash/folders", { cookie: b.cookie });
    check("other user sees no folders", res.statusCode === 200 && res.body.length === 0);
    res = await call("PATCH", `/api/flash/folders/${folderId}`, { cookie: b.cookie, body: { name: "hijack" } });
    check("other user cannot patch a folder -> 404", res.statusCode === 404);
    res = await call("PATCH", `/api/flash/categories/${categoryId}`, { cookie: b.cookie, body: { name: "hijack" } });
    check("other user cannot patch a category -> 404", res.statusCode === 404);
    res = await call("GET", `/api/flash/categories/${categoryId}`, { cookie: b.cookie });
    check("other user cannot read a category -> 404", res.statusCode === 404);
    res = await call("PATCH", `/api/flash/cards/${cardId}`, { cookie: b.cookie, body: { suspended: true } });
    check("other user cannot patch a card -> 404", res.statusCode === 404);
    res = await call("DELETE", `/api/flash/cards/${cardId}`, { cookie: b.cookie });
    check("other user cannot delete a card -> 404", res.statusCode === 404);

    // ---------- delete ----------
    res = await call("DELETE", `/api/flash/cards/${cardId}`, { cookie: a.cookie });
    check("DELETE card -> deleted", res.statusCode === 200 && res.body.deleted === true);

    res = await call("DELETE", `/api/flash/categories/${category2Id}`, { cookie: a.cookie });
    check("DELETE category reports counts", res.statusCode === 200 && res.body.deleted && typeof res.body.deleted.cards === "number", JSON.stringify(res.body));

    res = await call("DELETE", `/api/flash/folders/${folderId}`, { cookie: a.cookie });
    check("DELETE folder reports counts", res.statusCode === 200 && res.body.deleted && res.body.deleted.categories >= 1, JSON.stringify(res.body));

    res = await call("GET", "/api/flash/folders", { cookie: a.cookie });
    check("folder tree is empty after deletes", res.statusCode === 200 && res.body.length === 0);

    const leftovers = await sql`SELECT count(*)::int AS n FROM fc_cards WHERE user_id = ${String(a.id)} OR user_id = ${String(b.id)}`;
    check("cascade removed every card", leftovers[0].n === 0, `n=${leftovers[0].n}`);
  } finally {
    // fc_ rows are not FK'd to users, so delete them explicitly, then accounts.
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
