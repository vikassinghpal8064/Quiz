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
import categorySummary from "../_categories/[id]/summary.js";
import newQuestions from "../_categories/[id]/new-questions.js";
import questionStats from "../_categories/[id]/question-stats.js";
import starredQuestions from "../_categories/[id]/starred-questions.js";
import wrongQuestions from "../_categories/[id]/wrong-questions.js";
import questions from "../_questions/index.js";
import questionById from "../_questions/[id]/index.js";
import questionMeta from "../_questions/meta.js";
import questionsBulk from "../_questions/bulk.js";
import starQuestion from "../_questions/[id]/star.js";
import flagQuestion from "../_questions/[id]/flag.js";
import difficultyQuestion from "../_questions/[id]/difficulty.js";
import adminQuestions from "../_admin/questions.js";
import adminQuestionFlags from "../_admin/questions/[id]/flags.js";
import moveQuestions from "../_admin/questions/move.js";
import adminFlagById from "../_admin/flags/[id].js";
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

// Flash cards. Handlers live in api/_flash/ and are exposed at /api/flash/*.
import flashFolders from "../_flash/folders/index.js";
import flashFolderById from "../_flash/folders/[id].js";
import flashCategories from "../_flash/categories/index.js";
import flashCategoryById from "../_flash/categories/[id].js";
import flashCategoryStruggle from "../_flash/categories/[id]/struggle.js";
import flashCards from "../_flash/cards/index.js";
import flashCardsBulk from "../_flash/cards/bulk.js";
import flashCardsMove from "../_flash/cards/move.js";
import flashCardsSuspend from "../_flash/cards/suspend.js";
import flashCardById from "../_flash/cards/[id].js";
import flashImportJobs from "../_flash/import/jobs.js";
import flashImportJobById from "../_flash/import/jobs/[id].js";
import flashImportDuplicates from "../_flash/import/duplicates.js";
import flashMediaSign from "../_flash/media/sign.js";
import flashMediaRemove from "../_flash/media/remove.js";
import flashSessions from "../_flash/sessions/index.js";
import flashSessionById from "../_flash/sessions/[id].js";
import flashSessionReview from "../_flash/sessions/[id]/review.js";
import flashSessionFinish from "../_flash/sessions/[id]/finish.js";
import flashReviews from "../_flash/reviews/index.js";
import flashStats from "../_flash/stats/index.js";
import flashStatsOverview from "../_flash/stats/overview.js";
import flashSettings from "../_flash/settings/index.js";
import flashBackup from "../_flash/backup/index.js";

// Order matters only in that a more specific path must precede a shorter one
// sharing its prefix. Nothing here is a prefix of another row, so the order is
// just grouped by resource.
const ROUTES = [
  { path: "/subjects", handler: subjects },
  { path: "/subjects/:id", handler: subjectById },

  { path: "/categories", handler: categories },
  { path: "/categories/:id", handler: categoryById },
  { path: "/categories/:id/summary", handler: categorySummary },
  { path: "/categories/:id/new-questions", handler: newQuestions },
  { path: "/categories/:id/question-stats", handler: questionStats },
  { path: "/categories/:id/starred-questions", handler: starredQuestions },
  { path: "/categories/:id/wrong-questions", handler: wrongQuestions },

  { path: "/questions", handler: questions },
  // /questions/meta and /questions/bulk must precede /questions/:id - all
  // match two segments and the router takes the first hit, so "meta"/"bulk"
  // would otherwise be read as an id.
  { path: "/questions/meta", handler: questionMeta },
  { path: "/questions/bulk", handler: questionsBulk },
  { path: "/questions/:id", handler: questionById },
  { path: "/questions/:id/star", handler: starQuestion },
  { path: "/questions/:id/flag", handler: flagQuestion },
  { path: "/questions/:id/difficulty", handler: difficultyQuestion },

  { path: "/admin/questions", handler: adminQuestions },
  { path: "/admin/questions/move", handler: moveQuestions },
  { path: "/admin/questions/:id/flags", handler: adminQuestionFlags },
  { path: "/admin/flags/:id", handler: adminFlagById },

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

  { path: "/flash/folders", handler: flashFolders },
  { path: "/flash/folders/:id", handler: flashFolderById },
  { path: "/flash/categories", handler: flashCategories },
  // struggle must precede /flash/categories/:id - both match the same prefix
  { path: "/flash/categories/:id/struggle", handler: flashCategoryStruggle },
  { path: "/flash/categories/:id", handler: flashCategoryById },
  { path: "/flash/cards", handler: flashCards },
  // bulk / move / suspend must precede /flash/cards/:id - all match three
  // segments and the router takes the first hit, so "move" would otherwise be
  // read as an id.
  { path: "/flash/cards/bulk", handler: flashCardsBulk },
  { path: "/flash/cards/move", handler: flashCardsMove },
  { path: "/flash/cards/suspend", handler: flashCardsSuspend },
  { path: "/flash/cards/:id", handler: flashCardById },
  { path: "/flash/import/jobs", handler: flashImportJobs },
  // jobs/:id must precede nothing else sharing the prefix, but it is listed
  // before duplicates purely for readability - the router matches on segment
  // count first, so /flash/import/jobs (three) can never shadow it (four).
  { path: "/flash/import/jobs/:id", handler: flashImportJobById },
  { path: "/flash/import/duplicates", handler: flashImportDuplicates },
  { path: "/flash/media/sign", handler: flashMediaSign },
  { path: "/flash/media/remove", handler: flashMediaRemove },
  { path: "/flash/sessions", handler: flashSessions },
  // review / finish must precede /flash/sessions/:id - all match four segments
  // and the router takes the first hit, so "review" would otherwise be read as
  // an id.
  { path: "/flash/sessions/:id/review", handler: flashSessionReview },
  { path: "/flash/sessions/:id/finish", handler: flashSessionFinish },
  { path: "/flash/sessions/:id", handler: flashSessionById },
  // The flat review endpoint (session id in the body).
  { path: "/flash/reviews", handler: flashReviews },
  // /flash/stats/overview must precede /flash/stats - both share the prefix and
  // the more specific path has to win.
  { path: "/flash/stats/overview", handler: flashStatsOverview },
  { path: "/flash/stats", handler: flashStats },
  { path: "/flash/settings", handler: flashSettings },
  { path: "/flash/backup", handler: flashBackup },
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
