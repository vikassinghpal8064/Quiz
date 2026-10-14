// Turns one /api/* request into a call to the right handler.
//
// Both entry points use this: the deployed function api/index.js, and the
// dev middleware in vite.config.js. Keeping the dispatch in one place is what
// makes a route that works locally also work on Vercel.
//
// Why there is a function at all: Vercel builds one serverless function per
// .js file directly under api/, and the Hobby plan allows at most 12 per
// deployment. The app has 21 endpoints, so the handlers live in
// underscore-prefixed directories (api/_auth, api/_categories, ...), which
// Vercel does not treat as routes, and this file serves all of them.
//
// Why it is api/index.js and not api/[...path].js: a catch-all file in api/
// only matches single-segment paths. /api/foo reaches the function, but
// /api/auth/me and /api/attempts/12/results are answered by the platform with
// a 404 before the function ever runs, which breaks every real endpoint in
// this app. vercel.json rewrites /api/(.*) to /api/index?path=/api/$1
// instead, which routes nested paths correctly. The original path arrives in
// req.query.path; req.url is used as a fallback.
import { resolveRoute } from "./router.js";

// Pulls the route out of whichever field carries it, and drops the leading
// "api" segment. Handles req.query.path as a string or an array, a bare
// req.url, and a query string tacked onto either.
function segmentsFrom(req) {
  const raw = req.query?.path ?? req.url ?? "";
  const list = Array.isArray(raw) ? raw : [raw];

  const parts = list
    .flatMap((part) => String(part).split("?")[0].split("/"))
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .filter(Boolean);

  if (parts[0] === "api") parts.shift();
  return parts;
}

export default async function dispatch(req, res) {
  const segments = segmentsFrom(req);
  const match = resolveRoute(segments);
  if (!match) {
    return res.status(404).json({ error: "Not found" });
  }

  // HTTP cache policy, applied in one place so every endpoint behaves the
  // same. Read endpoints are per-user (session cookie) and change on writes,
  // so they are marked private and reused by the browser for a short window;
  // Vary: Cookie keeps one user's cached body from being served to another.
  // Everything else - writes and all auth endpoints - must never be cached.
  if (req.method === "GET" && segments[0] !== "auth") {
    res.setHeader("Cache-Control", "private, max-age=15");
    res.setHeader("Vary", "Cookie");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }

  // Captured segments become query parameters, so handlers keep reading
  // req.query.id / req.query.token exactly as they did when each endpoint had
  // its own [id] route. Anything already in the query string wins, so a real
  // ?subjectId=2 is never clobbered by a captured segment.
  req.query = { ...match.params, ...req.query };

  return match.handler(req, res);
}
