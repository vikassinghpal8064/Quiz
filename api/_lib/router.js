// The one place that maps a request path to a handler.
//
// Every handler lives under an underscore-prefixed directory (api/_auth,
// api/_categories, ...) because Vercel turns each .js file directly inside
// /api into its own serverless function, and the Hobby plan caps a
// deployment at 12. Files and folders starting with "_" are not routes, so
// all 21 handlers hide there and the single catch-all api/[...path].js
// dispatches through this table. One function, no limit to hit.
//
// This module is the single source of truth for routing: api/[...path].js
// uses it in production and the dev middleware in vite.config.js uses it for
// `npm run dev`, so the two can never disagree about which handler serves
// /api/attempts/12/results.
//
// Paths are written as segment lists. A segment starting with ":" captures
// that position and is handed to the handler as a query parameter, exactly
// as Vercel would for a [id] route: { path: ["/categories/:id/star"], ... }
// matches /api/categories/7/star and calls the handler with query.id === "7".
//
// Adding an endpoint means adding a row here and a handler file under one of
// the underscore directories. scripts/verify_routing.mjs fails if a handler
// file is not reachable from this table, so nothing can be wired up halfway.

import subjects from "../_subjects/index.js";
import subjectById from "../_subjects/[id].js";
import categories from "../_categories/index.js";
import categoryById from "../_categories/[id]/index.js";
import newQuestions from "../_categories/[id]/new-questions.js";
import questionStats from "../_categories/[id]/question-stats.js";
import starredQuestions from "../_categories/[id]/starred-questions.js";
import wrongQuestions from "../_categories/[id]/wrong-questions.js";
import questions from "../_questions/index.js";
import questionById from "../_questions/[id]/index.js";
import starQuestion from "../_questions/[id]/star.js";
import attempts from "../_attempts/index.js";
import attemptAnswers from "../_attempts/[id]/answers.js";
import attemptFinish from "../_attempts/[id]/finish.js";
import attemptResults from "../_attempts/[id]/results.js";
import login from "../_auth/login.js";
import register from "../_auth/register.js";
import logout from "../_auth/logout.js";
import me from "../_auth/me.js";
import forgotPassword from "../_auth/forgot-password.js";
import resetPassword from "../_auth/reset-password/[token].js";

// Order matters only in that a more specific path must precede a shorter one
// sharing its prefix. Nothing here is a prefix of another row, so the order is
// just grouped by resource.
const ROUTES = [
  { path: "/subjects", handler: subjects },
  { path: "/subjects/:id", handler: subjectById },

  { path: "/categories", handler: categories },
  { path: "/categories/:id", handler: categoryById },
  { path: "/categories/:id/new-questions", handler: newQuestions },
  { path: "/categories/:id/question-stats", handler: questionStats },
  { path: "/categories/:id/starred-questions", handler: starredQuestions },
  { path: "/categories/:id/wrong-questions", handler: wrongQuestions },

  { path: "/questions", handler: questions },
  { path: "/questions/:id", handler: questionById },
  { path: "/questions/:id/star", handler: starQuestion },

  { path: "/attempts", handler: attempts },
  { path: "/attempts/:id/answers", handler: attemptAnswers },
  { path: "/attempts/:id/finish", handler: attemptFinish },
  { path: "/attempts/:id/results", handler: attemptResults },

  { path: "/auth/login", handler: login },
  { path: "/auth/register", handler: register },
  { path: "/auth/logout", handler: logout },
  { path: "/auth/me", handler: me },
  { path: "/auth/forgot-password", handler: forgotPassword },
  { path: "/auth/reset-password/:token", handler: resetPassword },
];

const COMPILED = ROUTES.map((route) => ({
  handler: route.handler,
  segments: route.path.split("/").filter(Boolean),
}));

const PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * Matches a request path against the table.
 *
 * @param {string[]} segments path segments with the leading "api" removed,
 *   e.g. ["auth", "login"] for /api/auth/login
 * @returns {{ handler: Function, params: Record<string, string> } | null}
 *   null when nothing matches, so the caller can answer 404
 */
export function resolveRoute(segments) {
  for (const route of COMPILED) {
    if (route.segments.length !== segments.length) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < route.segments.length; i++) {
      const pattern = route.segments[i];
      const param = PARAM.exec(pattern);
      if (param) {
        params[param[1]] = segments[i];
      } else if (pattern !== segments[i]) {
        matched = false;
        break;
      }
    }

    if (matched) return { handler: route.handler, params };
  }
  return null;
}

export { ROUTES };
