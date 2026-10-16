// Verifies the flash-card API surface without needing the fc_* tables to be
// applied yet:
//
//   1. the shared validation helpers accept good input and reject bad input
//   2. every /api/flash/* path resolves to its handler through the real router
//   3. the deployed entry point (api/index.js, reached via the /api/(.*)
//      rewrite) reaches each handler and hits the auth guard (401)
//   4. the missing-table guard turns SQLSTATE 42P01 into a clear 503
//
// Authenticated CRUD is exercised separately (it needs the schema applied):
//   apply db/flash_001.sql, then run the same flow with a session cookie.
//
// Importing the router pulls in api/_lib/db.js, which reads DATABASE_URL at
// import time, so the env file has to be loaded before the dynamic imports.
process.loadEnvFile(".env");

import {
  MAX_BULK_CARDS,
  MAX_ID_LIST,
  isMissingFlashTable,
  sendMissingFlashTable,
  validateSide,
  validateTags,
  validateCardType,
  parsePositiveInt,
  parseIdList,
  requiredString,
  optionalString,
  optionalInt,
  optionalBool,
  escapeLike,
  createCardArgs,
  CREATE_CARD_SQL,
} from "../api/_lib/flashCards.js";

const { resolveRoute } = await import("../api/_lib/router.js");
const { default: dispatch } = await import("../api/index.js");

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

const bad = (result) => Boolean(result && result.error);
const ok = (result) => Boolean(result && !result.error);

console.log("VALIDATION");
check("validateSide accepts a text block", ok(validateSide({ blocks: [{ type: "text", text: "hi" }] }, "front")));
check("validateSide accepts an image block", ok(validateSide({ blocks: [{ type: "image", url: "https://x/y.png" }] }, "front")));
check("validateSide accepts an audio block", ok(validateSide({ blocks: [{ type: "audio", url: "https://x/y.mp3" }] }, "front")));
check("validateSide accepts ink with data", ok(validateSide({ blocks: [{ type: "ink", data: "abc" }] }, "front")));
check("validateSide accepts ink with strokes", ok(validateSide({ blocks: [{ type: "ink", strokes: [] }] }, "front")));
check("validateSide accepts an empty blocks array", ok(validateSide({ blocks: [] }, "front")));
check("validateSide rejects a missing blocks array", bad(validateSide({}, "front")));
check("validateSide rejects a non-object", bad(validateSide([1, 2], "front")));
check("validateSide rejects an unknown block type", bad(validateSide({ blocks: [{ type: "video" }] }, "front")));
check("validateSide rejects text without text", bad(validateSide({ blocks: [{ type: "text" }] }, "front")));
check("validateSide rejects image without url", bad(validateSide({ blocks: [{ type: "image" }] }, "front")));
check("validateSide rejects ink without data/strokes", bad(validateSide({ blocks: [{ type: "ink" }] }, "front")));
check("validateSide rejects too many blocks", bad(validateSide({ blocks: Array.from({ length: 101 }, () => ({ type: "text", text: "x" })) }, "front")));
check("validateSide preserves extra keys", validateSide({ blocks: [{ type: "text", text: "x", lang: "en" }] }, "front").value.blocks[0].lang === "en");

check("validateTags defaults to []", JSON.stringify(validateTags(undefined).value) === "[]");
check("validateTags trims and dedupes", JSON.stringify(validateTags([" a ", "a", "b"]).value) === '["a","b"]');
check("validateTags rejects a non-array", bad(validateTags("x")));
check("validateTags rejects an empty tag", bad(validateTags([""])));

check("validateCardType defaults to basic", validateCardType(undefined).value === "basic");
check("validateCardType rejects an empty string", bad(validateCardType("")));
check("validateCardType rejects an overlong type", bad(validateCardType("x".repeat(33))));

check("parsePositiveInt accepts a numeric string", parsePositiveInt("5", "id").value === 5);
check("parsePositiveInt rejects 0", bad(parsePositiveInt(0, "id")));
check("parsePositiveInt rejects a float", bad(parsePositiveInt(1.5, "id")));
check("parseIdList dedupes", JSON.stringify(parseIdList([1, 2, 2], "ids").value) === "[1,2]");
check("parseIdList rejects an empty array", bad(parseIdList([], "ids")));
check("parseIdList rejects non-integers", bad(parseIdList([1, "x"], "ids")));
check("parseIdList enforces the cap", bad(parseIdList(Array.from({ length: MAX_ID_LIST + 1 }, (_, i) => i + 1), "ids")));

check("requiredString trims", requiredString("  hi  ", "name").value === "hi");
check("requiredString rejects empty", bad(requiredString("", "name")));
check("optionalString maps empty to null", optionalString("", "d").value === null);
check("optionalString rejects a number", bad(optionalString(5, "d")));
check("optionalInt parses and bounds", optionalInt("3", "n").value === 3 && bad(optionalInt(-1, "n")));
check("optionalBool only accepts booleans", optionalBool(true, "s").value === true && bad(optionalBool("true", "s")));

check("escapeLike escapes % and _", escapeLike("50%_a") === "50\\%\\_a");

check("isMissingFlashTable matches fc_ 42P01", isMissingFlashTable({ code: "42P01", message: 'relation "fc_cards" does not exist' }) === true);
check("isMissingFlashTable ignores other 42P01", isMissingFlashTable({ code: "42P01", message: 'relation "quiz" does not exist' }) === false);
check("isMissingFlashTable ignores other codes", isMissingFlashTable({ code: "23505", message: "fc_cards dup" }) === false);

{
  let captured = null;
  const res = { status: (c) => ({ json: (p) => { captured = { c, p }; } }) };
  const handled = sendMissingFlashTable(res, { code: "42P01", message: 'relation "fc_folders" does not exist' });
  check("sendMissingFlashTable sends 503 with a hint", handled === true && captured?.c === 503 && /db\/flash_001\.sql/.test(captured?.p?.error ?? ""));
  const ignored = sendMissingFlashTable(res, { code: "23505" });
  check("sendMissingFlashTable ignores other errors", ignored === false);
}

check("bulk cap is 500", MAX_BULK_CARDS === 500);
check("createCardArgs stringifies jsonb args", (() => {
  const args = createCardArgs("u1", { categoryId: 3, cardType: "basic", front: { blocks: [] }, back: { blocks: [] }, tags: ["a"] });
  return args[0] === "u1" && args[1] === 3 && args[3] === '{"blocks":[]}' && args[4] === '{"blocks":[]}' && JSON.stringify(args[5]) === '["a"]';
})());
check("CREATE_CARD_SQL writes a state row", /fc_card_state/.test(CREATE_CARD_SQL) && /0,\s*now\(\)/.test(CREATE_CARD_SQL));

console.log("\nROUTING");
const h = (p) => import(p).then((m) => m.default);
const [foldersH, folderByIdH, categoriesH, categoryByIdH, cardsH, bulkH, moveH, suspendH, cardByIdH] =
  await Promise.all([
    h("../api/_flash/folders/index.js"),
    h("../api/_flash/folders/[id].js"),
    h("../api/_flash/categories/index.js"),
    h("../api/_flash/categories/[id].js"),
    h("../api/_flash/cards/index.js"),
    h("../api/_flash/cards/bulk.js"),
    h("../api/_flash/cards/move.js"),
    h("../api/_flash/cards/suspend.js"),
    h("../api/_flash/cards/[id].js"),
  ]);

const ROUTE_CASES = [
  ["/api/flash/folders", foldersH, {}],
  ["/api/flash/folders/7", folderByIdH, { id: "7" }],
  ["/api/flash/categories", categoriesH, {}],
  ["/api/flash/categories/3", categoryByIdH, { id: "3" }],
  ["/api/flash/cards", cardsH, {}],
  ["/api/flash/cards/bulk", bulkH, {}],
  ["/api/flash/cards/move", moveH, {}],
  ["/api/flash/cards/suspend", suspendH, {}],
  ["/api/flash/cards/9", cardByIdH, { id: "9" }],
];
for (const [url, expected, params] of ROUTE_CASES) {
  const segments = url.split("/").filter(Boolean).slice(1);
  const match = resolveRoute(segments);
  check(
    `${url} -> ${JSON.stringify(params)}`,
    match?.handler === expected && JSON.stringify(match.params) === JSON.stringify(params),
    match ? `params were ${JSON.stringify(match.params)}` : "no match"
  );
}

console.log("\nAUTH GUARD (deployed entry api/index.js)");
function makeRes() {
  const r = { statusCode: 0, body: null };
  r.setHeader = () => {};
  r.status = (code) => ({ json: (p) => { r.statusCode = code; r.body = p; }, end: () => { r.statusCode = code; } });
  r.json = (p) => { r.statusCode = 200; r.body = p; };
  r.end = () => {};
  return r;
}
async function callEntry(path, method = "GET") {
  const res = makeRes();
  const req = {
    method,
    url: "/api/index?path=/api/" + path,
    query: { path: "/api/" + path },
    body: null,
    headers: {},
  };
  await dispatch(req, res);
  return `${res.statusCode} ${JSON.stringify(res.body)}`;
}
const UNAUTH = [
  "flash/folders",
  "flash/folders/1",
  "flash/categories",
  "flash/categories/1",
  "flash/cards",
  "flash/cards/bulk",
  "flash/cards/move",
  "flash/cards/suspend",
  "flash/cards/1",
];
for (const path of UNAUTH) {
  check(`GET  /api/${path} -> 401`, (await callEntry(path)) === '401 {"error":"Authentication required"}');
}
check(`POST /api/flash/folders -> 401`, (await callEntry("flash/folders", "POST")) === '401 {"error":"Authentication required"}');
check(`PATCH /api/flash/cards/1 -> 401`, (await callEntry("flash/cards/1", "PATCH")) === '401 {"error":"Authentication required"}');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
process.exit(fail ? 1 : 0);
