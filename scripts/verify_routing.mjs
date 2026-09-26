// Tests the router that both the dev server and the deployed catch-all use.
//
// Every /api/* request is dispatched by api/_lib/router.js. If it cannot
// resolve a path such as /api/auth/reset-password/<token>, that endpoint
// returns 404 in the running app even though the handler itself is fine.
// Direct handler tests cannot catch that, so this suite exists separately.
//
// It also guards the two ways this layout can silently rot:
//
//   1. A handler file exists but no row in the table points at it, so the
//      endpoint 404s.
//   2. The count of real Vercel functions climbs past the Hobby plan's
//      limit of 12 and the deployment fails to build.
//
// Importing the router pulls in api/_lib/db.js, which reads DATABASE_URL at
// import time, so the env file has to be loaded first. That rules out a
// static import of the router: ES module imports are hoisted above every
// statement in the file.
process.loadEnvFile(".env");

const { resolveRoute, ROUTES } = await import("../api/_lib/router.js");

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API_DIR = path.join(ROOT, "api");

// Vercel builds one serverless function per .js file reachable under /api
// without passing through an underscore-prefixed file or directory.
const HOBBY_FUNCTION_LIMIT = 12;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra = "") {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; failures.push(label); console.log(`  \u2717 ${label}${extra ? ` -> ${extra}` : ""}`); }
}

async function resolve(url) {
  const segments = url.split("/").filter(Boolean).slice(1);
  return resolveRoute(segments);
}

const h = (p) => import(p).then((m) => m.default);
const [subjectsH, subjectByIdH, categoriesH, categoryByIdH,
  questionsH, questionByIdH, starH,
  attemptsH, answersH, finishH, resultsH,
  newQ_H, wrongQ_H, starredQ_H, statsH,
  loginH, registerH, logoutH, meH, forgotH, resetH] = await Promise.all([
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
  h("../api/_auth/login.js"),
  h("../api/_auth/register.js"),
  h("../api/_auth/logout.js"),
  h("../api/_auth/me.js"),
  h("../api/_auth/forgot-password.js"),
  h("../api/_auth/reset-password/[token].js"),
]);

console.log("ROUTES");
// [url, expected handler module, expected params]
const ROUTE_CASES = [
  ["/api/subjects", subjectsH, {}],
  ["/api/subjects/3", subjectByIdH, { id: "3" }],
  ["/api/categories", categoriesH, {}],
  ["/api/categories/5", categoryByIdH, { id: "5" }],
  ["/api/categories/5/wrong-questions", wrongQ_H, { id: "5" }],
  ["/api/categories/5/new-questions", newQ_H, { id: "5" }],
  ["/api/categories/5/starred-questions", starredQ_H, { id: "5" }],
  ["/api/categories/5/question-stats", statsH, { id: "5" }],
  ["/api/questions", questionsH, {}],
  ["/api/questions/9", questionByIdH, { id: "9" }],
  ["/api/questions/9/star", starH, { id: "9" }],
  ["/api/attempts", attemptsH, {}],
  ["/api/attempts/12/answers", answersH, { id: "12" }],
  ["/api/attempts/12/finish", finishH, { id: "12" }],
  ["/api/attempts/12/results", resultsH, { id: "12" }],
  ["/api/auth/me", meH, {}],
  ["/api/auth/login", loginH, {}],
  ["/api/auth/register", registerH, {}],
  ["/api/auth/logout", logoutH, {}],
  ["/api/auth/forgot-password", forgotH, {}],
  // The one that regressed once: a capture that is not called id.
  ["/api/auth/reset-password/abc123def", resetH, { token: "abc123def" }],
];

for (const [url, expectedHandler, expectedParams] of ROUTE_CASES) {
  const m = await resolve(url);
  const okHandler = m?.handler === expectedHandler;
  const okParams = JSON.stringify(m?.params ?? {}) === JSON.stringify(expectedParams);
  check(`${url} -> ${expectedParams ? JSON.stringify(expectedParams) : "no params"}`,
    okHandler && okParams,
    okHandler ? `resolved to the wrong handler, params were ${JSON.stringify(m?.params)}, expected ${JSON.stringify(expectedParams)}`
              : "resolved to a different handler");
}

console.log("\nUNRESOLVABLE (must 404, not fall through to a wrong handler)");
const NOT_FOUND = [
  ["/api/_lib/auth", "shared library files must not be routable"],
  ["/api/_auth/login", "handlers are reached through their public path only"],
  ["/api/attempts/12", "there is no GET /api/attempts/:id"],
  ["/api/nope", "unknown collection"],
  ["/api/auth/reset-password", "reset needs a token segment"],
  ["/api/categories/5/nope", "unknown handler in a dynamic path"],
  ["/api/subjects/3/extra", "no deeper path under a leaf route"],
];
for (const [url, why] of NOT_FOUND) {
  const m = await resolve(url);
  check(`${url} -> 404 (${why})`, m === null);
}

// Walks api/ and reports every file Vercel would compile into a function,
// as repo-root-relative paths.
async function listJs(dir, rel) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listJs(child, childRel)));
    else if (entry.name.endsWith(".js")) out.push(childRel);
  }
  return out;
}

const allFiles = await listJs(API_DIR, "api");

console.log("\nDEPLOYMENT SHAPE");
const functions = allFiles.filter((f) => !f.split("/").some((seg) => seg.startsWith("_")));
check(`at most ${HOBBY_FUNCTION_LIMIT} serverless functions (found ${functions.length}: ${functions.join(", ") || "none"})`,
  functions.length <= HOBBY_FUNCTION_LIMIT);

// api/_auth/reset-password/[token].js must be reachable at
// /auth/reset-password/:token, and nothing may be listed in the table without
// a matching file. Together these two directions mean the table and the
// filesystem can never drift apart.
const routePathFor = (file) => {
  const parts = file
    .replace(/^api\/_/, "")
    .replace(/\.js$/, "")
    .replace(/(^|\/)index$/, "")
    .split("/")
    .map((seg) => seg.replace(/^\[(.+)\]$/, ":$1"));
  return "/" + parts.filter(Boolean).join("/");
};

const tablePaths = new Set(ROUTES.map((r) => r.path));
// api/_lib holds shared helpers, not endpoints, so it is not expected in the
// table.
for (const file of allFiles.filter((f) => f.startsWith("api/_") && !f.startsWith("api/_lib/"))) {
  const p = routePathFor(file);
  check(`handler wired up: ${file} -> ${p}`, tablePaths.has(p), "no row in the router table");
}
for (const route of ROUTES) {
  // A handler is either <route>.js or, when the path ends at a collection or
  // a captured id, <route>/index.js.
  const base = `api/_${route.path.replace(/^\//, "").replace(/:([A-Za-z0-9_]+)/g, "[$1]")}`;
  const candidates = [`${base}.js`, `${base}/index.js`];
  const found = candidates.find((c) => allFiles.includes(c));
  check(`table row has a file: ${route.path}`, Boolean(found),
    `expected one of ${candidates.join(" or ")}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
process.exit(fail ? 1 : 0);
