// Catch-all serverless function: every /api/* request on the deployment lands
// here and is forwarded to the handler that api/_lib/router.js picks.
//
// This indirection exists purely to stay inside Vercel's Hobby limit of 12
// serverless functions per deployment. The app has 21 endpoints, and a plain
// file per endpoint would be 21 functions and a failed build. Handlers live in
// underscore-prefixed directories, which Vercel ignores as routes, so this
// file is the only function the platform sees.
import { resolveRoute } from "./_lib/router.js";

// Vercel hands a catch-all segment to the function as req.query.path. It is
// normally an array of segments, but a plain string shows up in some runtimes,
// so accept every shape rather than 404ing a valid request.
function segmentsFrom(req) {
  const raw = req.query?.path;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list
    .flatMap((part) => String(part).split("/"))
    .map(decodeURIComponent)
    .filter(Boolean);
}

export default async function handler(req, res) {
  const match = resolveRoute(segmentsFrom(req));
  if (!match) {
    return res.status(404).json({ error: "Not found" });
  }

  // Captured segments become query parameters, so handlers keep reading
  // req.query.id / req.query.token exactly as they did when each endpoint had
  // its own [id] route. Anything already in the query string wins, matching
  // how Vercel layered params over the parsed query.
  req.query = { ...req.query, ...match.params };

  return match.handler(req, res);
}
