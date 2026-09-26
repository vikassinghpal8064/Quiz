// Tests the real dev-server API router exported from vite.config.js.
//
// The router decides which handler file serves each /api/* request during
// `npm run dev`. If it cannot resolve a dynamic segment such as
// /api/auth/reset-password/<token>, that endpoint returns 404 in the running
// app even though the handler itself is fine. Direct handler tests cannot
// catch that, so this suite exists separately.
import path from "node:path";
import { resolveRoute, API_DIR } from "../vite.config.js";

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

const ROUTES = [
  // [url, expected handler path relative to api/, expected params]
  ["/api/subjects", "subjects.js", {}],
  ["/api/subjects/3", "subjects/[id].js", { id: "3" }],
  ["/api/categories", "categories.js", {}],
  ["/api/categories/5", "categories/[id]/index.js", { id: "5" }],
  ["/api/categories/5/wrong-questions", "categories/[id]/wrong-questions.js", { id: "5" }],
  ["/api/categories/5/new-questions", "categories/[id]/new-questions.js", { id: "5" }],
  ["/api/categories/5/starred-questions", "categories/[id]/starred-questions.js", { id: "5" }],
  ["/api/categories/5/question-stats", "categories/[id]/question-stats.js", { id: "5" }],
  ["/api/questions", "questions.js", {}],
  ["/api/questions/9", "questions/[id]/index.js", { id: "9" }],
  ["/api/questions/9/star", "questions/[id]/star.js", { id: "9" }],
  ["/api/attempts", "attempts.js", {}],
  ["/api/attempts/12/answers", "attempts/[id]/answers.js", { id: "12" }],
  ["/api/attempts/12/finish", "attempts/[id]/finish.js", { id: "12" }],
  ["/api/attempts/12/results", "attempts/[id]/results.js", { id: "12" }],
  ["/api/auth/me", "auth/me.js", {}],
  ["/api/auth/login", "auth/login.js", {}],
  ["/api/auth/register", "auth/register.js", {}],
  ["/api/auth/logout", "auth/logout.js", {}],
  ["/api/auth/forgot-password", "auth/forgot-password.js", {}],
  // This is the one that regressed: a dynamic file whose name is not [id].
  ["/api/auth/reset-password/abc123def", "auth/reset-password/[token].js", { token: "abc123def" }],
];

console.log("ROUTES");
for (const [url, expectedFile, expectedParams] of ROUTES) {
  const m = await resolve(url);
  const rel = m ? path.relative(API_DIR, m.file).split(path.sep).join("/") : null;
  const okFile = rel === expectedFile;
  const okParams = JSON.stringify(m?.params ?? {}) === JSON.stringify(expectedParams);
  check(`${url} -> ${expectedFile}${okParams ? "" : " (params)"}`,
    okFile && okParams,
    okFile ? `params were ${JSON.stringify(m.params)}, expected ${JSON.stringify(expectedParams)}`
           : `resolved to ${rel}`);
}

console.log("\nUNRESOLVABLE (must 404, not fall through to a wrong handler)");
const NOT_FOUND = [
  ["/api/_lib/auth.js", "shared library files must not be routable"],
  ["/api/_lib/db.js", "shared library files must not be routable"],
  ["/api/attempts/12", "there is no GET /api/attempts/:id"],
  ["/api/nope", "unknown collection"],
  ["/api/auth/reset-password", "reset needs a token segment"],
  ["/api/categories/5/nope", "unknown handler in a dynamic directory"],
];
for (const [url, why] of NOT_FOUND) {
  const m = await resolve(url);
  check(`${url} -> 404 (${why})`, m === null, m ? `resolved to ${path.relative(API_DIR, m.file)}` : "");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
process.exit(fail ? 1 : 0);
