// Focus-session queue builder (pure).
//
// A focus session is a short, bounded sitting assembled from several pools so
// one deck never gets stuck on the same kind of card:
//
//   N = clamp(ceil(activeCount * focus_fraction), focus_min, focus_max)
//
// and N slots are filled in this order, recording why each card earned a slot
// (fc_session_cards.reason):
//
//   1. due       - up to 45% of N, lowest retrievability first (closest to
//                  being forgotten), even slots beyond the cap are reported as
//                  the session's leftover-due count.
//   2. struggle  - up to 30% of N from cards whose struggle_score has crossed
//                  the line, highest first, whether or not they are due.
//   3. new       - up to 15% of N, but never more than what is left of the daily
//                  new-card budget.
//   4. stale     - every remaining slot, oldest last_seen_session first, so a
//                  card surfaces roughly once every four sittings. Brand-new
//                  cards only fill here while the daily budget still allows.
//
// When the scope spans several categories (a folder), the result is interleaved
// so consecutive cards come from different categories, and struggle cards are
// spread apart rather than clumped.
//
// Pure: no database, no React, no globals. The scheduler's getRetrievability is
// the only import, so the "most at risk" order is the exact one the scheduler
// uses to schedule the card.

import { STATES, getRetrievability } from "./scheduler/index.js";
import { DEFAULT_SETTINGS } from "./scheduler/constants.js";

// Share of N each pool may claim before the coverage fill takes the rest.
export const FOCUS_DUE_SHARE = 0.45;
export const FOCUS_STRUGGLE_SHARE = 0.3;
export const FOCUS_NEW_SHARE = 0.15;

// A card joins the struggle pool once its score reaches this. Mirrors
// STRUGGLE_THRESHOLD in api/_lib/flashCards.js and format.js.
export const FOCUS_STRUGGLE_MIN = 0.5;

// The four labels written to fc_session_cards.reason for a focus session.
export const REASONS = Object.freeze({
  Due: "due",
  Struggle: "struggle",
  New: "new",
  Stale: "stale",
});

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// N: a fraction of the deck, floored at focus_min and capped at focus_max, and
// never larger than the deck itself (the floor can never invent cards).
export function focusTarget(activeCount, settings = {}) {
  const count = Math.max(0, num(activeCount, 0));
  if (count === 0) return 0;
  const fraction = positive(settings.focus_fraction, DEFAULT_SETTINGS.focus_fraction);
  const min = Math.max(0, num(settings.focus_min, DEFAULT_SETTINGS.focus_min));
  const max = positive(settings.focus_max, DEFAULT_SETTINGS.focus_max);
  const target = Math.ceil(count * fraction);
  return Math.min(count, Math.max(min, Math.min(max, target)));
}

function isNew(row) {
  return (num(row?.state, 0) | 0) === STATES.New;
}

function dueKey(row) {
  if (!row?.due) return Number.NEGATIVE_INFINITY;
  const t = new Date(row.due).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

// A card in the scheduler whose due date has arrived (overdue included). New
// cards are excluded here - they belong to the "new" pool.
function isDue(row, nowMs) {
  if (isNew(row)) return false;
  return dueKey(row) <= nowMs;
}

function lastSeenKey(row) {
  const n = Number(row?.last_seen_session);
  return Number.isFinite(n) ? n : -1;
}

function compareDue(a, b) {
  const da = dueKey(a);
  const db = dueKey(b);
  if (da !== db) return da - db;
  return (Number(a?.id) || 0) - (Number(b?.id) || 0);
}

function toState(row) {
  return {
    state: num(row?.state, 0),
    due: row?.due ?? null,
    stability: num(row?.stability, 0),
    difficulty: num(row?.difficulty, 0),
    reps: num(row?.reps, 0),
    lapses: num(row?.lapses, 0),
    last_review: row?.last_review ?? null,
    scheduled_days: 0,
    learning_steps: 0,
    elapsed_days: 0,
  };
}

// 0-1 recall probability; the lowest is the closest to being forgotten.
function retrievability(row, now, settings) {
  try {
    const value = getRetrievability(toState(row), now, settings);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

// Round-robin the selected cards by category so a folder session never runs a
// whole category before touching the next one. Relative order within a category
// (and therefore the pool priority) is preserved.
function interleaveByCategory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.category_id ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  if (groups.size <= 1) return entries;
  const lists = [...groups.values()];
  const longest = Math.max(...lists.map((list) => list.length));
  const out = [];
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

// Spread the struggle cards evenly through the rest, so two never sit next to
// each other while other cards remain. Relative order within each group holds.
function spaceStruggle(entries) {
  const strugglers = entries.filter((e) => e.reason === REASONS.Struggle);
  if (strugglers.length < 2) return entries;
  const others = entries.filter((e) => e.reason !== REASONS.Struggle);
  const out = [];
  let oi = 0;
  for (let i = 0; i < strugglers.length; i += 1) {
    const remainingOthers = others.length - oi;
    const remainingStrugglers = strugglers.length - i;
    const take = Math.ceil(remainingOthers / remainingStrugglers);
    for (let j = 0; j < take && oi < others.length; j += 1) out.push(others[oi++]);
    out.push(strugglers[i]);
  }
  while (oi < others.length) out.push(others[oi++]);
  return out;
}

// Build the ordered focus queue. `cards` are the active cards in scope, each
// carrying its scheduler state (state, due, last_review, struggle_score,
// last_seen_session, category_id). `newCap` is what is left of the daily
// new-card budget. Returns { entries: [{ id, reason, category_id }], meta }.
export function buildFocusQueue({
  cards = [],
  settings = {},
  now = new Date(),
  newCap = Infinity,
  interleave = false,
} = {}) {
  const rows = (Array.isArray(cards) ? cards : []).filter(Boolean);
  const at = now instanceof Date ? now : new Date(now);
  const nowMs = at.getTime();
  const target = focusTarget(rows.length, settings);

  const meta = { target, due: 0, struggle: 0, new: 0, stale: 0, leftover_due: 0, filled: 0 };
  if (target === 0 || rows.length === 0) return { entries: [], meta };

  const dueCap = Math.floor(target * FOCUS_DUE_SHARE);
  const struggleCap = Math.floor(target * FOCUS_STRUGGLE_SHARE);
  const newShareCap = Math.floor(target * FOCUS_NEW_SHARE);

  const entries = [];
  const taken = new Set();
  const push = (row, reason) => {
    taken.add(row.id);
    entries.push({ id: row.id, reason, category_id: row.category_id ?? null });
  };
  const countReason = (reason) => {
    let n = 0;
    for (const entry of entries) if (entry.reason === reason) n += 1;
    return n;
  };

  // 1. Due, most at risk first.
  const dueRows = rows.filter((row) => isDue(row, nowMs));
  dueRows.sort(
    (a, b) => retrievability(a, at, settings) - retrievability(b, at, settings) || compareDue(a, b)
  );
  for (const row of dueRows) {
    if (meta.due >= dueCap) break;
    push(row, REASONS.Due);
    meta.due += 1;
  }

  // 2. Struggle rescue, highest score first.
  const struggleRows = rows
    .filter((row) => !taken.has(row.id) && num(row.struggle_score, 0) >= FOCUS_STRUGGLE_MIN)
    .sort((a, b) => num(b.struggle_score, 0) - num(a.struggle_score, 0) || compareDue(a, b));
  for (const row of struggleRows) {
    if (meta.struggle >= struggleCap) break;
    push(row, REASONS.Struggle);
    meta.struggle += 1;
  }

  // 3. New, capped by both the share and the daily budget.
  let newAllowed = Number.isFinite(newCap) ? Math.max(0, Math.floor(newCap)) : Infinity;
  const newRows = rows
    .filter((row) => !taken.has(row.id) && isNew(row))
    .sort(compareDue);
  for (const row of newRows) {
    if (meta.new >= newShareCap || newAllowed <= 0) break;
    push(row, REASONS.New);
    meta.new += 1;
    newAllowed -= 1;
  }

  // 4. Coverage fill, oldest last_seen_session first. New cards may only fill
  //    here while the daily budget still allows, and when they do they are still
  //    reported as new (they introduce a card), not stale - only cards that have
  //    been seen before are "stale".
  const fillRows = rows
    .filter((row) => !taken.has(row.id))
    .sort((a, b) => lastSeenKey(a) - lastSeenKey(b) || compareDue(a, b));
  for (const row of fillRows) {
    if (entries.length >= target) break;
    if (isNew(row)) {
      if (newAllowed <= 0) continue;
      newAllowed -= 1;
      push(row, REASONS.New);
      meta.new += 1;
    } else {
      push(row, REASONS.Stale);
      meta.stale += 1;
    }
  }

  let ordered = entries;
  if (interleave) ordered = interleaveByCategory(ordered);
  ordered = spaceStruggle(ordered);

  // Leftover due = due cards the session could not fit anywhere (not just those
  // the due pool skipped - coverage may still have rescued some). This is the
  // backlog the summary reports.
  meta.leftover_due = dueRows.filter((row) => !taken.has(row.id)).length;
  meta.filled = ordered.length;
  return { entries: ordered, meta };
}
