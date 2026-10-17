// Shared SQL for the flash-card stats endpoints (api/_flash/stats/*).
//
// Lives in api/_lib/ (a shared library, not a route) so it is excluded from the
// "every handler must be wired into the router" check.
//
// Every builder returns { text, params } for sql.query(), exactly like
// candidateQuery in flashStudy.js. Keeping the SQL here - rather than inline in
// the handler - means the shape can be asserted in a unit test without a
// database, and the range/scope rules live in one place.
//
// All of it reads only fc_review_logs and fc_card_state, joined to fc_cards
// only to resolve the per-folder / per-category scope. The indexes those needs
// are added by db/flash_004.sql.

import { MAX_RANGE_DAYS } from "../../src/modules/flashcards/lib/statsModel.js";

export const HEATMAP_DAYS = 371; // 53 weeks, matching HEATMAP_WEEKS
export const RETENTION_DEFAULT_DAYS = 30;
export const TREND_DEFAULT_DAYS = 30;
export const FORECAST_DAYS = 30; // today .. +29, matching the 30-bar series
export const DEFAULT_HARDEST = 20;
export const MAX_HARDEST = 50;

// Parse the ?folderId= / ?categoryId= filter. A category is the narrower scope,
// so when both are given the category wins. Returns { folderId, categoryId }
// (both null when unscoped) or { error }.
export function parseScope(query = {}) {
  const read = (raw, label) => {
    if (raw === undefined || raw === null || raw === "") return { value: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return { error: `${label} must be a positive integer` };
    return { value: n };
  };
  const folder = read(query.folderId, "folderId");
  if (folder.error) return { error: folder.error };
  const category = read(query.categoryId, "categoryId");
  if (category.error) return { error: category.error };
  return { folderId: folder.value, categoryId: category.value };
}

// Append the scope predicate to `where`, pushing its id onto `params`. $1 is
// always the user id. A category includes every category nested beneath it,
// matching the scope a category study session uses.
function withScope(where, params, scope = {}) {
  if (scope.categoryId != null) {
    params.push(scope.categoryId);
    where.push(`c.category_id IN (
      WITH RECURSIVE sub AS (
        SELECT id FROM fc_categories WHERE id = $${params.length} AND user_id = $1
        UNION ALL
        SELECT child.id FROM fc_categories child JOIN sub ON child.parent_id = sub.id
      )
      SELECT id FROM sub
    )`);
  } else if (scope.folderId != null) {
    params.push(scope.folderId);
    where.push(
      `c.category_id IN (SELECT id FROM fc_categories WHERE folder_id = $${params.length} AND user_id = $1)`
    );
  }
  return where;
}

// A push-then-return helper so a builder can reference a parameter's placeholder
// at the point it is used, which keeps the numbering readable.
function param(params, value) {
  params.push(value);
  return `$${params.length}`;
}

// clamp a caller-supplied range to something the page can render.
export function clampRangeDays(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return RETENTION_DEFAULT_DAYS;
  return Math.min(n, MAX_RANGE_DAYS);
}

// Reviews per day over the heatmap window (the calendar, the streak).
export function dailyReviewsQuery({ uid, scope, days = HEATMAP_DAYS }) {
  const params = [uid];
  const window = param(params, days);
  const where = [
    "r.user_id = $1",
    `r.reviewed_at >= now() - (${window}::int * interval '1 day')`,
  ];
  withScope(where, params, scope);
  return {
    text: `
      SELECT to_char(date_trunc('day', r.reviewed_at), 'YYYY-MM-DD') AS day,
             count(*)::int AS n
      FROM fc_review_logs r
      JOIN fc_cards c ON c.id = r.card_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

// Distinct active days only - a lighter variant of the above for the home
// dashboard's streak, which does not need the per-day counts.
export function activityDaysQuery({ uid, days = HEATMAP_DAYS }) {
  const params = [uid];
  const window = param(params, days);
  return {
    text: `
      SELECT DISTINCT to_char(date_trunc('day', reviewed_at), 'YYYY-MM-DD') AS day
      FROM fc_review_logs
      WHERE user_id = $1
        AND reviewed_at >= now() - (${window}::int * interval '1 day')
    `,
    params,
  };
}

// True retention, grouped by the state the card was in before the answer and by
// whether it was already mature. rating >= 3 (Good / Easy) counts as recalled.
export function retentionQuery({ uid, scope, days = RETENTION_DEFAULT_DAYS }) {
  const params = [uid];
  const window = param(params, days);
  const where = [
    "r.user_id = $1",
    "r.rating IS NOT NULL",
    `r.reviewed_at >= now() - (${window}::int * interval '1 day')`,
  ];
  withScope(where, params, scope);
  return {
    text: `
      SELECT r.state_before,
             (r.stability_before >= 21) AS mature,
             count(*)::int AS total,
             count(*) FILTER (WHERE r.rating >= 3)::int AS correct
      FROM fc_review_logs r
      JOIN fc_cards c ON c.id = r.card_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1, 2
    `,
    params,
  };
}

// Unsuspended cards due on each of the next `days` days.
export function dueForecastQuery({ uid, scope, days = FORECAST_DAYS }) {
  const params = [uid];
  const horizon = param(params, days);
  const where = [
    "s.user_id = $1",
    "c.user_id = $1",
    "c.suspended = false",
    "s.due IS NOT NULL",
    `s.due < date_trunc('day', now()) + (${horizon}::int * interval '1 day')`,
  ];
  withScope(where, params, scope);
  return {
    text: `
      SELECT to_char(date_trunc('day', s.due), 'YYYY-MM-DD') AS day,
             count(*)::int AS n
      FROM fc_card_state s
      JOIN fc_cards c ON c.id = s.card_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

// Cards by scheduler state, split by maturity so "mastered" can be counted
// apart from ordinary review cards.
export function stateBreakdownQuery({ uid, scope }) {
  const params = [uid];
  const where = ["s.user_id = $1", "c.user_id = $1", "c.suspended = false"];
  withScope(where, params, scope);
  return {
    text: `
      SELECT s.state,
             (s.stability >= 21) AS mature,
             count(*)::int AS n
      FROM fc_card_state s
      JOIN fc_cards c ON c.id = s.card_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1, 2
    `,
    params,
  };
}

// Average think time per day (only answered cards with a positive timing).
export function thinkTimeTrendQuery({ uid, scope, days = TREND_DEFAULT_DAYS }) {
  const params = [uid];
  const window = param(params, days);
  const where = [
    "r.user_id = $1",
    "r.think_ms IS NOT NULL",
    "r.think_ms > 0",
    `r.reviewed_at >= now() - (${window}::int * interval '1 day')`,
  ];
  withScope(where, params, scope);
  return {
    text: `
      SELECT to_char(date_trunc('day', r.reviewed_at), 'YYYY-MM-DD') AS day,
             round(avg(r.think_ms))::int AS avg_ms,
             count(*)::int AS n
      FROM fc_review_logs r
      JOIN fc_cards c ON c.id = r.card_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

// The hardest cards in scope: highest struggle score first, then the most
// lapses, so ties break toward the card that keeps failing.
export function hardestCardsQuery({ uid, scope, limit = DEFAULT_HARDEST }) {
  const params = [uid];
  const cap = param(params, Math.min(Math.max(1, limit), MAX_HARDEST));
  const where = ["s.user_id = $1", "c.user_id = $1", "c.suspended = false"];
  withScope(where, params, scope);
  return {
    text: `
      SELECT c.id, c.front, c.back, c.tags, c.category_id, c.card_type,
             cat.name AS category_name,
             s.state, s.due, s.stability, s.difficulty, s.reps, s.lapses,
             s.avg_think_ms, s.struggle_score, s.last_review
      FROM fc_card_state s
      JOIN fc_cards c ON c.id = s.card_id
      LEFT JOIN fc_categories cat ON cat.id = c.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.struggle_score DESC NULLS LAST, s.lapses DESC, c.id ASC
      LIMIT ${cap}
    `,
    params,
  };
}

// Reviews answered since the start of today (server time), for the dashboard.
export function reviewsTodayQuery({ uid }) {
  return {
    text: `
      SELECT count(*)::int AS n
      FROM fc_review_logs
      WHERE user_id = $1 AND reviewed_at >= date_trunc('day', now())
    `,
    params: [uid],
  };
}

// Brand-new cards introduced today (first-ever answer), the same rule the
// scheduler uses for the daily new-card budget.
export function newTodayQuery({ uid }) {
  return {
    text: `
      SELECT count(DISTINCT card_id)::int AS n
      FROM fc_review_logs
      WHERE user_id = $1 AND state_before = 0
        AND reviewed_at >= date_trunc('day', now())
    `,
    params: [uid],
  };
}

// Unsuspended cards reviewable today (due before the end of today, overdue
// included) - the same definition as the folder / category due_count.
export function dueTodayQuery({ uid }) {
  return {
    text: `
      SELECT count(*)::int AS n
      FROM fc_card_state s
      JOIN fc_cards c ON c.id = s.card_id
      WHERE s.user_id = $1 AND c.user_id = $1 AND c.suspended = false
        AND s.due IS NOT NULL
        AND s.due < date_trunc('day', now()) + interval '1 day'
    `,
    params: [uid],
  };
}
