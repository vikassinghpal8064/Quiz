// Unit tests for src/lib/apiCache.js - the dependency-free GET cache.
//
// This suite mocks global fetch, so it needs no database, no .env and no
// network. It exists to lock in the three properties the rest of the app now
// relies on:
//
//   * a GET is served from cache within its TTL (no repeat request),
//   * concurrent identical GETs share a single request and each caller still
//     gets its own readable body (Response bodies can only be read once),
//   * a successful write clears the cache, while a failed write does not.
//
//   node scripts/verify_cache.mjs

const { cachedFetch, invalidateCache, clearCache } = await import(
  "../src/lib/apiCache.js"
);

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  \u2717 ${label}${extra ? ` -> ${extra}` : ""}`);
  }
}

let calls = [];
function mockOk() {
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ url, seq: calls.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

console.log("TTL CACHE");
{
  clearCache();
  calls = [];
  mockOk();
  const a1 = await (await cachedFetch("/api/subjects")).json();
  const a2 = await (await cachedFetch("/api/subjects")).json();
  check("two reads within TTL make one request", calls.length === 1, JSON.stringify(calls));
  check("both reads return the data", a1.url === "/api/subjects" && a2.url === "/api/subjects");
  check("responses are cloned, not shared", a1.seq === a2.seq);
}

console.log("\nIN-FLIGHT DE-DUPLICATION");
{
  clearCache();
  calls = [];
  mockOk();
  const [b1, b2] = await Promise.all([
    cachedFetch("/api/categories/5"),
    cachedFetch("/api/categories/5"),
  ]);
  const [b1j, b2j] = await Promise.all([b1.json(), b2.json()]);
  check("concurrent reads share one request", calls.length === 1, JSON.stringify(calls));
  check("both concurrent bodies parse", b1j.url === "/api/categories/5" && b2j.url === b1j.url);
}

console.log("\nCACHE KEYS");
{
  clearCache();
  calls = [];
  mockOk();
  await (await cachedFetch("/api/subjects/1")).json();
  await (await cachedFetch("/api/subjects/2")).json();
  await (await cachedFetch("/api/subjects/1")).json();
  check("distinct URLs are cached separately", calls.length === 2, JSON.stringify(calls));
}

console.log("\nINVALIDATION");
{
  clearCache();
  calls = [];
  mockOk();
  await (await cachedFetch("/api/subjects")).json();
  await cachedFetch("/api/questions", { method: "POST", body: "{}" });
  await (await cachedFetch("/api/subjects")).json();
  check("a successful write clears cached GETs", calls.length === 3, JSON.stringify(calls));

  clearCache();
  calls = [];
  mockOk();
  const real = globalThis.fetch;
  await (await cachedFetch("/api/subjects")).json();
  globalThis.fetch = async (url, init) => {
    calls.push(`FAIL ${init?.method} ${url}`);
    return new Response("nope", { status: 500 });
  };
  await cachedFetch("/api/questions", { method: "POST", body: "{}" });
  globalThis.fetch = real;
  await (await cachedFetch("/api/subjects")).json();
  check("a failed write keeps the cache", calls.length === 2, JSON.stringify(calls));

  clearCache();
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response("bad", { status: 500 });
  };
  await cachedFetch("/api/subjects");
  await cachedFetch("/api/subjects");
  check("a failed GET is not cached", calls.length === 2, JSON.stringify(calls));

  clearCache();
  calls = [];
  mockOk();
  await (await cachedFetch("/api/subjects")).json();
  await (await cachedFetch("/api/categories?subjectId=1")).json();
  invalidateCache("/api/subjects");
  await (await cachedFetch("/api/subjects")).json();
  await (await cachedFetch("/api/categories?subjectId=1")).json();
  check("prefix invalidation drops only the match", calls.length === 3, JSON.stringify(calls));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:\n  - " + failures.join("\n  - "));
process.exit(fail ? 1 : 0);
