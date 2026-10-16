// Shared helpers for the flash-card study flow (api/_flash/sessions/*).
//
// Lives in api/_lib/ because it is a shared library, not a route, so it is
// excluded from the "every handler must be wired into the router" check in
// scripts/verify_routing.mjs.
//
// The interesting part is that the scheduling maths is NOT reimplemented here.
// src/modules/flashcards/lib/scheduler/ is pure (no database, no React, no
// globals), so the server imports the exact same module the client uses to
// preview the four rating buttons. That keeps "what the button promised" and
// "what the review actually scheduled" from ever drifting apart.

import {
  DEFAULT_SETTINGS,
  RATINGS,
  STATES,
  schedule,
  previewIntervals,
  getRetrievability,
  computeStruggleScore,
  normalizeRating,
} from "../../src/modules/flashcards/lib/scheduler/index.js";
import { STRUGGLE_THRESHOLD } from "./flashCards.js";

export { RATINGS, STATES };

// A study sitting studies one scope. "all" ignores the scope filter; "folder"
// and "category" resolve to a set of categories (a folder's categories, or a
// category and every category nested beneath it); "tag" matches any card whose
// tags array contains the given tag. scope_id is a numeric id for folder /
// category and unused for all / tag (a tag carries its own string).
export const SESSION_SCOPES = new Set(["folder", "category", "tag", "all"]);

// "due"  - reviewable today (new + due), the default.
// "focus" - a short, bounded slice of the due queue (settings.focus_*).
// "struggling" - only cards whose struggle_score has crossed the threshold.
// "all"  - every unsuspended card, ignoring due dates.
export const SESSION_MODES = new Set(["due", "focus", "struggling", "all"]);

// The queue is built server-side, so bound it. A due queue longer than this is
// truncated (a fresh session refills it); 500 is far more than anyone reviews
// in one sitting.
export const MAX_SESSION_CARDS = 500;
export const DEFAULT_SESSION_CARDS = 100;

// ---------- settings ----------

// Turn fc_settings rows ({ key, value }) into the settings object the scheduler
// reads. Every missing key keeps its documented default, so a user who has
// never touched settings still schedules normally.
export function settingsFromRows(rows) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows ?? []) {
    if (row && typeof row.key === "string") settings[row.key] = row.value;
  }
  return settings;
}

export async function loadSettings(sql, uid) {
  const rows = await sql`SELECT key, value FROM fc_settings WHERE user_id = ${uid}`;
  return settingsFromRows(rows);
}

// A short focus session: a fraction of what is due, floored at focus_min and
// capped at focus_max. Never invents cards - an empty queue stays empty.
export function focusLimit(dueCount, settings = {}) {
  const count = Math.max(0, Number(dueCount) || 0);
  if (count === 0) return 0;
  const fraction = numberOr(settings.focus_fraction, DEFAULT_SETTINGS.focus_fraction);
  const min = numberOr(settings.focus_min, DEFAULT_SETTINGS.focus_min);
  const max = numberOr(settings.focus_max, DEFAULT_SETTINGS.focus_max);
  const target = Math.round(count * fraction);
  return Math.min(count, Math.max(min, Math.min(max, target)));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------- queue ----------

// Parameterised query for the candidate cards a session could queue. Returns
// { text, params } for sql.query(). scopeType "all" adds no scope clause, so it
// simply means "every unsuspended card of this user".
//
// The rows carry the scheduler state as well as the id, because the standard
// ("due") ordering - due cards by lowest retrievability first, then new cards -
// is computed in JS with the pure scheduler (see orderQueue). SQL only narrows
// the scope and applies the due-date cut-off; the SQL ORDER BY below is just a
// stable pre-sort so the JS sort has deterministic tie-breaks.
export function candidateQuery({ uid, scopeType, scopeId, tag, mode }) {
  const params = [uid];
  const where = ["c.user_id = $1", "c.suspended = false"];

  if (scopeType === "folder" || scopeType === "category") {
    params.push(scopeId);
    const p = params.length;
    if (scopeType === "folder") {
      where.push(
        `c.category_id IN (SELECT id FROM fc_categories WHERE folder_id = $${p} AND user_id = $1)`
      );
    } else {
      // A category includes every category nested beneath it.
      where.push(`c.category_id IN (
        WITH RECURSIVE sub AS (
          SELECT id FROM fc_categories WHERE id = $${p} AND user_id = $1
          UNION ALL
          SELECT child.id FROM fc_categories child JOIN sub ON child.parent_id = sub.id
        )
        SELECT id FROM sub
      )`);
    }
  } else if (scopeType === "tag") {
    // Tags are free text (fc_cards.tags is a TEXT[]); "@>" is index-backed by
    // the GIN index on tags.
    params.push(tag);
    where.push(`c.tags @> ARRAY[$${params.length}]::text[]`);
  }

  let order;
  if (mode === "struggling") {
    params.push(STRUGGLE_THRESHOLD);
    where.push(`s.struggle_score >= $${params.length}`);
    order = "s.struggle_score DESC NULLS LAST, c.id ASC";
  } else if (mode === "all") {
    order = "c.id ASC";
  } else {
    // due + focus: reviewable today. New cards are created with due = now(), so
    // they are included here.
    where.push(`(s.due IS NULL OR s.due < date_trunc('day', now()) + interval '1 day')`);
    order = "s.due ASC NULLS FIRST, c.id ASC";
  }

  return {
    text: `SELECT c.id, c.tags,
             s.state, s.due, s.stability, s.difficulty, s.reps, s.lapses, s.last_review
      FROM fc_cards c
      LEFT JOIN fc_card_state s ON s.card_id = c.id
      WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT ${MAX_SESSION_CARDS}`,
    params,
  };
}

// ---------- queue ordering ----------

// Stable "soonest due first, then lowest id" comparison for the new-card tail.
function compareDue(a, b) {
  const da = a?.due ? new Date(a.due).getTime() : Number.NEGATIVE_INFINITY;
  const db = b?.due ? new Date(b.due).getTime() : Number.NEGATIVE_INFINITY;
  if (da !== db) return da - db;
  return (Number(a?.id) || 0) - (Number(b?.id) || 0);
}

// The standard due order: cards already in the scheduler (Learning / Review /
// Relearning) first, most at risk first, then brand-new cards up to the daily
// new-card cap. Retrievability is "how likely the card is still recalled"; the
// lowest value is the closest to being forgotten, so it is reviewed first.
//
// New cards are capped, not sorted away: a queue that is all new cards is
// limited to what is left of settings.new_cards_per_day today. Modes other than
// due / focus keep the SQL order (mapped to plain ids).
export function orderQueue(candidates, { mode, now = new Date(), settings = {}, newCap = Infinity } = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (mode !== "due" && mode !== "focus") return rows.map((row) => row.id);

  const dueRows = [];
  const newRows = [];
  for (const row of rows) {
    if ((row?.state ?? 0) === STATES.New) newRows.push(row);
    else dueRows.push({ row, retrievability: getRetrievability(cardStateFromRow(row), now, settings) });
  }

  dueRows.sort((a, b) => a.retrievability - b.retrievability || compareDue(a.row, b.row));
  newRows.sort(compareDue);

  const cap = Number.isFinite(newCap) ? Math.max(0, Math.floor(newCap)) : Infinity;
  const fresh = cap === Infinity ? newRows : newRows.slice(0, cap);

  return [...dueRows.map((entry) => entry.row.id), ...fresh.map((row) => row.id)];
}

// How many brand-new cards this user has already met today. One row per first
// answer (state_before = 0), distinct by card so a card seen twice today counts
// once. Parameters: $1 user_id.
export const NEW_INTRODUCED_SQL = `
  SELECT count(DISTINCT card_id)::int AS n
  FROM fc_review_logs
  WHERE user_id = $1 AND state_before = 0
    AND reviewed_at >= date_trunc('day', now())
`;

// What is left of the daily new-card budget: settings.new_cards_per_day minus
// the cards already introduced today. Never negative.
export function newCapRemaining(settings = {}, introducedToday = 0) {
  const raw = Number(settings.new_cards_per_day);
  const cap = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_SETTINGS.new_cards_per_day;
  return Math.max(0, cap - (Number(introducedToday) || 0));
}

// Create the session row and its ordered queue in one statement. Parameters:
//   $1 user_id  $2 scope_type  $3 scope_id  $4 mode  $5 fraction
//   $6 planned_count  $7 reason  $8 card_ids::int[]
export const CREATE_SESSION_SQL = `
  WITH created AS (
    INSERT INTO fc_sessions (user_id, scope_type, scope_id, mode, fraction, planned_count)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  ), queue AS (
    INSERT INTO fc_session_cards (user_id, session_id, card_id, position, reason)
    SELECT $1, created.id, item.card_id, (item.ord - 1)::int, $7
    FROM created, unnest($8::int[]) WITH ORDINALITY AS item(card_id, ord)
    RETURNING session_id
  )
  SELECT created.*, (SELECT count(*) FROM queue)::int AS queued
  FROM created
`;

export function createSessionArgs({ uid, scopeType, scopeId, mode, fraction, plannedCount, reason, cardIds }) {
  return [
    uid,
    scopeType,
    scopeId ?? null,
    mode,
    fraction ?? null,
    plannedCount,
    reason ?? null,
    cardIds,
  ];
}

// One row per queued card, joined to its content and its scheduler state, in the
// order the session will work through it. `reviewed` lets a resumed session skip
// (or highlight) cards already answered.
export const SESSION_CARDS_SQL = `
  SELECT c.id, c.card_type, c.front, c.back, c.tags, c.suspended, c.source, c.source_ref,
         s.state, s.due, s.stability, s.difficulty, s.reps, s.lapses, s.last_review, s.struggle_score,
         sc.position, sc.reason,
         EXISTS (
           SELECT 1 FROM fc_review_logs r
           WHERE r.session_id = sc.session_id AND r.card_id = sc.card_id
         ) AS reviewed,
         (
           SELECT r2.rating FROM fc_review_logs r2
           WHERE r2.session_id = sc.session_id AND r2.card_id = sc.card_id
           ORDER BY r2.reviewed_at DESC, r2.id DESC
           LIMIT 1
         ) AS last_rating
  FROM fc_session_cards sc
  JOIN fc_cards c ON c.id = sc.card_id
  LEFT JOIN fc_card_state s ON s.card_id = c.id
  WHERE sc.session_id = $1 AND sc.user_id = $2
  ORDER BY sc.position ASC
`;

// ---------- review ----------

// A card's state, its type and its recent history, in one round trip. The
// `recent` sub-select feeds the struggle score.
export const REVIEW_CONTEXT_SQL = `
  SELECT c.card_type, s.state, s.due, s.stability, s.difficulty, s.reps, s.lapses,
         s.last_review, s.avg_think_ms,
         EXISTS (
           SELECT 1 FROM fc_session_cards sc
           WHERE sc.session_id = $3 AND sc.card_id = c.id AND sc.user_id = $2
         ) AS in_session,
         EXISTS (
           SELECT 1 FROM fc_review_logs r
           WHERE r.session_id = $3 AND r.card_id = c.id
         ) AS already_reviewed,
         COALESCE((
           SELECT json_agg(recent)
           FROM (
             SELECT rating, think_ms
             FROM fc_review_logs
             WHERE card_id = c.id AND user_id = $2
             ORDER BY reviewed_at DESC, id DESC
             LIMIT 5
           ) recent
         ), '[]'::json) AS recent
  FROM fc_cards c
  LEFT JOIN fc_card_state s ON s.card_id = c.id
  WHERE c.id = $1 AND c.user_id = $2
`;

// The state a card-state row represents, in the shape the scheduler expects.
export function cardStateFromRow(row) {
  return {
    state: row?.state ?? 0,
    due: row?.due ?? null,
    stability: row?.stability ?? 0,
    difficulty: row?.difficulty ?? 0,
    reps: row?.reps ?? 0,
    lapses: row?.lapses ?? 0,
    last_review: row?.last_review ?? null,
    scheduled_days: 0,
    learning_steps: 0,
    elapsed_days: 0,
  };
}

// Deterministic preview of the four rating buttons for a card, used by the
// review response and (indirectly) by the client.
export function previewFor(stateRow, now, settings = {}) {
  return previewIntervals(cardStateFromRow(stateRow), now, settings);
}

// Compute everything a review writes: the next state, the refreshed struggle
// score and the rolling average think-time. Pure except for reading the values
// it is handed, so it can be unit-tested.
export function planReview({ context, rating, thinkMs, now = new Date(), settings = {} }) {
  const before = cardStateFromRow(context);
  const grade = normalizeRating(rating);
  const after = schedule(before, grade, now, settings);

  const list = Array.isArray(context?.recent) ? context.recent : [];
  const struggleScore = computeStruggleScore({
    reviews: list,
    thinkMs: typeof thinkMs === "number" ? thinkMs : undefined,
    lapses: after.lapses,
    cardType: context?.card_type,
    settings,
  });

  return {
    before,
    after,
    rating: grade,
    struggleScore,
    avgThinkMs: rollingAverage(context?.avg_think_ms, context?.reps, thinkMs),
  };
}

// Weighted by the number of prior reps so an early outlier does not dominate.
// A missing/failed reading leaves the previous average in place (null when there
// was none).
export function rollingAverage(previousAvg, reps, thinkMs) {
  if (typeof thinkMs !== "number" || !Number.isFinite(thinkMs) || thinkMs < 0) {
    return previousAvg ?? null;
  }
  const prior = Number.isFinite(previousAvg) && previousAvg > 0 ? previousAvg : null;
  const count = Number.isFinite(reps) && reps > 0 ? reps : 0;
  if (prior === null || count === 0) return Math.round(thinkMs);
  return Math.round((prior * count + thinkMs) / (count + 1));
}

export const UPDATE_STATE_SQL = `
  UPDATE fc_card_state SET
    state = $2,
    due = $3,
    stability = $4,
    difficulty = $5,
    reps = $6,
    lapses = $7,
    last_review = $8,
    avg_think_ms = $9,
    struggle_score = $10,
    last_seen_session = $11
  WHERE card_id = $1 AND user_id = $12
  RETURNING state, due, stability, difficulty, reps, lapses, struggle_score
`;

export function updateStateArgs(cardId, plan, sessionId, uid) {
  const { after } = plan;
  return [
    cardId,
    after.state,
    after.due,
    after.stability,
    after.difficulty,
    after.reps,
    after.lapses,
    after.last_review,
    plan.avgThinkMs,
    plan.struggleScore,
    sessionId,
    uid,
  ];
}

export const INSERT_REVIEW_SQL = `
  INSERT INTO fc_review_logs (
    user_id, card_id, session_id, rating, think_ms, total_ms,
    state_before, stability_before, stability_after, is_echo
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING id
`;

export function insertReviewArgs(
  uid,
  cardId,
  sessionId,
  plan,
  { thinkMs = null, totalMs = null, isEcho = false } = {}
) {
  return [
    uid,
    cardId,
    sessionId,
    plan.rating,
    thinkMs,
    totalMs,
    plan.before.state,
    plan.before.stability ?? null,
    plan.after.stability ?? null,
    Boolean(isEcho),
  ];
}

// ---------- summary ----------

// Counts by rating for a session, plus the total. Keys line up with RATINGS.
export function summarizeRatings(rows) {
  const summary = { again: 0, hard: 0, good: 0, easy: 0, total: 0 };
  for (const row of rows ?? []) {
    const n = Number(row?.n) || 0;
    if (row?.rating === RATINGS.Again) summary.again += n;
    else if (row?.rating === RATINGS.Hard) summary.hard += n;
    else if (row?.rating === RATINGS.Good) summary.good += n;
    else if (row?.rating === RATINGS.Easy) summary.easy += n;
    summary.total += n;
  }
  return summary;
}
