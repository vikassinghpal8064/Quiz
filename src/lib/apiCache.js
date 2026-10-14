// A tiny, dependency-free HTTP cache for GET requests.
//
// Why this exists: every screen fetches its data in a useEffect on mount, so
// moving around the app (Dashboard -> Subject -> Category -> Manage) repeatedly
// re-requests rows that were just loaded, and each request is a serverless
// invocation plus one or more database round trips. Wrapping fetch() here:
//
//   * de-duplicates identical GET requests while they are in flight (React's
//     StrictMode double-invokes effects in dev, and two components can ask for
//     the same URL at the same time),
//   * reuses a successful GET for a short TTL, so going back/forward is instant
//     instead of another round trip,
//   * clears the cache whenever a write (POST/PUT/PATCH/DELETE) succeeds, so a
//     read never serves data that an edit has already invalidated.
//
// It is a drop-in replacement for fetch(): callers still receive a Response and
// call .json()/.text() themselves. Response bodies can only be read once, so
// each caller gets its own clone and the cache keeps a private snapshot.

const DEFAULT_TTL = 30_000;

// url -> { promise } while in flight, or { response, time } once settled.
const store = new Map();

// The API sets Cache-Control: private, max-age=15, so the browser keeps its
// own copy of reads too. That copy cannot be cleared from JS, and it would
// otherwise outlive a write (e.g. moving questions, then refetching the list).
// Once any write has succeeded we ask fetch() to revalidate instead of
// trusting the browser cache. The marker lives in sessionStorage so a reload
// after a write behaves the same; reads still hit the in-memory cache above,
// so navigation stays instant.
const FRESH_MARKER = "quiz.apiCache.preferFresh";
let preferFresh = (() => {
  try {
    return sessionStorage.getItem(FRESH_MARKER) === "1";
  } catch {
    return false;
  }
})();

function markPreferFresh() {
  preferFresh = true;
  try {
    sessionStorage.setItem(FRESH_MARKER, "1");
  } catch {
    /* no sessionStorage (tests/SSR) - the in-memory flag still applies */
  }
}

function keyOf(input) {
  return typeof input === "string" ? input : input.url;
}

// Drops cached reads. No argument clears everything; pass a string prefix, a
// RegExp, or a predicate to drop only matching URLs.
export function invalidateCache(match) {
  if (match === undefined) {
    store.clear();
    return;
  }
  const test =
    typeof match === "string"
      ? (key) => key.startsWith(match)
      : match instanceof RegExp
        ? (key) => match.test(key)
        : match;
  for (const key of [...store.keys()]) {
    if (test(key)) store.delete(key);
  }
}

// Readable alias for call sites that intentionally clear everything.
export const clearCache = () => invalidateCache();

export function cachedFetch(input, init = {}) {
  const method = (init.method ?? "GET").toUpperCase();

  // Writes are never cached. A successful write can change any read, so drop
  // the cache; a failed write changed nothing, so leave it alone.
  if (method !== "GET") {
    return fetch(input, init).then((res) => {
      if (res.ok) {
        invalidateCache();
        markPreferFresh();
      }
      return res;
    });
  }

  const { cacheTtl = DEFAULT_TTL, ...requestInit } = init;
  if (preferFresh && requestInit.cache === undefined) {
    requestInit.cache = "no-cache";
  }
  const key = keyOf(input);
  const entry = store.get(key);

  if (entry) {
    if (entry.promise) return entry.promise.then((res) => res.clone());
    if (Date.now() - entry.time < cacheTtl) {
      return Promise.resolve(entry.response.clone());
    }
  }

  const promise = fetch(input, requestInit)
    .then((res) => {
      if (res.ok) {
        // Keep a private body snapshot for later reads and hand the live
        // response (plus clones for anyone who joined) back to the caller.
        store.set(key, { response: res.clone(), time: Date.now() });
      } else {
        store.delete(key);
      }
      return res;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });

  // While in flight, hand every caller the same promise; each clones its own
  // body so nobody reads a stream another caller already consumed.
  store.set(key, { promise });
  return promise.then((res) => res.clone());
}
