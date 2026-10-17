// End-to-end verification for the flash-card backup endpoint and the client
// restore flow it feeds.
//
//   node scripts/verify_flash_backup.mjs
//
// Drives the real dispatch entry (api/index.js) with a real session cookie, so
// routing, auth and the database are exercised exactly as in production. The
// restore half imports the actual client library (src/.../lib/backup.js) and
// wires it to the live endpoints, so the whole export -> import round trip is
// covered, not just the HTTP surface.
process.loadEnvFile(".env");

const { createTestAccount } = await import("./_auth_fixture.mjs");
const { default: dispatch } = await import("../api/index.js");
const { default: sql } = await import("../api/_lib/db.js");
const { restoreBackup, cardsToCsv } = await import("../src/modules/flashcards/lib/backup.js");

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
  const a = await createTestAccount({ label: "backup_a" });
  const b = await createTestAccount({ label: "backup_b" });
  const uid = String(a.id);

  try {
    // ---------- fixtures ----------
    let res = await call("POST", "/api/flash/folders", {
      cookie: a.cookie,
      body: { name: "Backup deck", color: "sage", icon: "🧬" },
    });
    check("fixtures: folder created", res.statusCode === 201 && Boolean(res.body.id));
    const folderId = res.body.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, name: "Cell" },
    });
    const cellId = res.body.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, parent_id: cellId, name: "Nucleus" },
    });
    const nucleusId = res.body.id;
    check("fixtures: nested categories created", Boolean(cellId && nucleusId));

    const mkCard = async (categoryId, label) => {
      const r = await call("POST", "/api/flash/cards", {
        cookie: a.cookie,
        body: {
          category_id: categoryId,
          front: { blocks: [{ type: "text", text: label }] },
          back: { blocks: [{ type: "text", text: `${label} answer` }] },
          tags: ["bio"],
        },
      });
      return r.body.id;
    };
    const cardCell1 = await mkCard(cellId, "Cell Q1");
    const cardCell2 = await mkCard(cellId, "Cell Q2");
    const cardNucleus = await mkCard(nucleusId, "Nucleus Q1");
    check("fixtures: three cards created", [cardCell1, cardCell2, cardNucleus].every(Boolean));

    res = await call("POST", "/api/flash/cards/suspend", {
      cookie: a.cookie,
      body: { card_ids: [cardNucleus], suspended: true },
    });
    check("fixtures: one card suspended", res.statusCode === 200 && res.body.updated === 1);

    // ---------- export ----------
    res = await call("GET", "/api/flash/backup", { cookie: a.cookie });
    const backup = res.body;
    check("GET backup -> 200 with version 1", res.statusCode === 200 && backup.version === 1);
    check(
      "backup carries the four arrays",
      Array.isArray(backup.folders) && Array.isArray(backup.categories) && Array.isArray(backup.cards) && Array.isArray(backup.media)
    );
    check("backup has the folder", backup.folders.length === 1 && backup.folders[0].name === "Backup deck");
    check("backup has both categories", backup.categories.length === 2);
    check("backup has all three cards", backup.cards.length === 3);

    const nucleus = backup.categories.find((c) => c.name === "Nucleus");
    check("backup keeps category nesting", nucleus?.parent_id === cellId);
    const suspended = backup.cards.find((c) => c.id === cardNucleus);
    check("backup records the suspended flag", suspended?.suspended === true);
    check(
      "backup keeps the card body",
      backup.cards.find((c) => c.id === cardCell1)?.front?.blocks?.[0]?.text === "Cell Q1"
    );
    check("backup carries tags", backup.cards.every((c) => Array.isArray(c.tags)));

    // ---------- isolation + auth ----------
    res = await call("GET", "/api/flash/backup", { cookie: b.cookie });
    check(
      "another account's backup is empty",
      res.statusCode === 200 && res.body.folders.length === 0 && res.body.categories.length === 0 && res.body.cards.length === 0
    );
    check("GET backup unauthenticated -> 401", (await call("GET", "/api/flash/backup")).statusCode === 401);

    // ---------- CSV projection ----------
    const csv = cardsToCsv(backup.cards);
    check("CSV has a header and one row per card", csv.split("\r\n").length === backup.cards.length + 1);
    check("CSV rows project the card body", csv.includes("Cell Q1") && csv.includes("Nucleus Q1"));
    check(
      "CSV marks the suspended card",
      csv.split("\r\n").some((line) => line.includes("Nucleus Q1") && line.includes("yes"))
    );

    // ---------- restore round trip (real client lib against live endpoints) ----------
    const deps = {
      listFolders: async () => (await call("GET", "/api/flash/folders", { cookie: a.cookie })).body,
      listCategories: async (fid) =>
        (await call("GET", "/api/flash/categories", { cookie: a.cookie, query: { folderId: String(fid) } })).body,
      createFolder: async (payload) =>
        (await call("POST", "/api/flash/folders", { cookie: a.cookie, body: payload })).body,
      createCategory: async (payload) =>
        (await call("POST", "/api/flash/categories", { cookie: a.cookie, body: payload })).body,
      bulkCreateCards: async (cards, categoryId) =>
        (await call("POST", "/api/flash/cards/bulk", { cookie: a.cookie, body: { cards, category_id: categoryId } })).body,
      suspendCards: async (ids, suspended) =>
        (await call("POST", "/api/flash/cards/suspend", { cookie: a.cookie, body: { card_ids: ids, suspended } })).body,
    };

    const stats = await restoreBackup(backup, deps);
    check("restore reuses the existing folder", stats.folders === 0 && stats.foldersReused === 1, JSON.stringify(stats));
    check("restore reuses both categories", stats.categories === 0 && stats.categoriesReused === 2, JSON.stringify(stats));
    check("restore adds every card", stats.cards === 3, JSON.stringify(stats));
    check("restore re-suspends the suspended card", stats.suspended === 1, JSON.stringify(stats));
    check("restore skips nothing", stats.skipped === 0, JSON.stringify(stats));

    res = await call("GET", "/api/flash/backup", { cookie: a.cookie });
    check("after restore the deck is doubled", res.body.cards.length === 6, `cards=${res.body.cards.length}`);
    check("after restore folders/categories are not duplicated", res.body.folders.length === 1 && res.body.categories.length === 2);

    // ---------- restore into a fresh account ----------
    const deps2 = {
      ...deps,
      listFolders: async () => (await call("GET", "/api/flash/folders", { cookie: b.cookie })).body,
      listCategories: async (fid) =>
        (await call("GET", "/api/flash/categories", { cookie: b.cookie, query: { folderId: String(fid) } })).body,
      createFolder: async (payload) =>
        (await call("POST", "/api/flash/folders", { cookie: b.cookie, body: payload })).body,
      createCategory: async (payload) =>
        (await call("POST", "/api/flash/categories", { cookie: b.cookie, body: payload })).body,
      bulkCreateCards: async (cards, categoryId) =>
        (await call("POST", "/api/flash/cards/bulk", { cookie: b.cookie, body: { cards, category_id: categoryId } })).body,
      suspendCards: async (ids, suspended) =>
        (await call("POST", "/api/flash/cards/suspend", { cookie: b.cookie, body: { card_ids: ids, suspended } })).body,
    };
    const stats2 = await restoreBackup(backup, deps2);
    check(
      "restore into a fresh account recreates everything",
      stats2.folders === 1 && stats2.categories === 2 && stats2.cards === 3 && stats2.suspended === 1,
      JSON.stringify(stats2)
    );
    res = await call("GET", "/api/flash/backup", { cookie: b.cookie });
    check("the fresh account now holds the deck", res.body.cards.length === 3 && res.body.categories.length === 2);
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
