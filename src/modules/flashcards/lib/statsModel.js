// Pure statistics helpers for the /flash/stats screen and the flash home
// dashboard.
//
// No database, no React, no globals - the same module runs on the server (to
// shape the SQL rows into the JSON the page consumes) and on the client (to lay
// out the calendar and draw the chart paths). Keeping the maths here means the
// two can never disagree about what a "streak" is or where a bar sits.
//
// Days are compared as plain "YYYY-MM-DD" strings and bucketed in UTC, which is
// the timezone Postgres uses for the date_trunc('day', ...) grouping in
// api/_lib/flashStats.js.

export const DAY_MS = 86_400_000;

// A review-state card is "mature" (Anki's word) once its stability reaches this
// many days. Mastered cards are counted separately from ordinary review cards.
export const MASTERED_STABILITY_DAYS = 21;

// "True retention" is measured on mature reviews: cards already in the Review
// state whose stability has reached this many days.
export const MATURE_STABILITY_DAYS = 21;

// The heatmap shows the last 53 whole weeks (a little over a year), matching
// GitHub's contribution graph.
export const HEATMAP_WEEKS = 53;

// The due forecast always covers the next 30 days; the retention and think-time
// trend panels default to 30 days but the range is user-selectable.
export const FORECAST_DAYS = 30;
export const TREND_DAYS = 30;
export const DEFAULT_RANGE_DAYS = 30;
export const MIN_RANGE_DAYS = 1;
export const MAX_RANGE_DAYS = 730;

export const DEFAULT_DAILY_GOAL = 30;
export const MAX_DAILY_GOAL = 1000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- day keys ----------

// Normalise anything (a Date, an ISO timestamp or a "YYYY-MM-DD" key) to a UTC
// day key. Unparseable input is null, never a thrown error.
export function dayKey(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    if (DAY_RE.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function parseDay(key) {
  const normalised = dayKey(key);
  if (!normalised) return null;
  const [y, m, d] = normalised.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key, n) {
  const base = parseDay(key);
  if (!base) return null;
  return new Date(base.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function todayKey(now = new Date()) {
  return dayKey(now);
}

// How many whole days from `a` to `b` (b - a). Null when either key is invalid.
export function daysBetween(a, b) {
  const from = parseDay(a);
  const to = parseDay(b);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

// ---------- counts ----------

// Fold query rows ({ day, n }) into a Map(day -> count), tolerating the several
// field names the different queries use.
export function countsByDay(rows = []) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const key = dayKey(row?.day ?? row?.date);
    if (!key) continue;
    const n = Number(row?.n ?? row?.count) || 0;
    counts.set(key, (counts.get(key) ?? 0) + n);
  }
  return counts;
}

// GitHub-style intensity bucket for one day's review count.
export function heatLevel(count, max) {
  const n = Number(count) || 0;
  if (n <= 0) return 0;
  const ceiling = Number(max) || 0;
  if (ceiling <= 0) return 1;
  const ratio = n / ceiling;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

// The calendar the heatmap draws: `weeks` columns of Sunday..Saturday cells,
// ending on the week that contains today. Days after today are marked inFuture
// so the component can render them as empty placeholders.
export function buildHeatmap(rows = [], { weeks = HEATMAP_WEEKS, now = new Date() } = {}) {
  const counts = countsByDay(rows);
  const end = todayKey(now);
  const endDate = parseDay(end);
  const endDow = endDate.getUTCDay(); // 0 = Sunday
  const gridEnd = addDays(end, 6 - endDow);
  const start = addDays(gridEnd, -(weeks * 7 - 1));

  let max = 0;
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const date = addDays(start, i);
    const count = date <= end ? counts.get(date) ?? 0 : 0;
    if (count > max) max = count;
    cells.push({ date, count, level: 0, inFuture: date > end });
  }
  for (const cell of cells) {
    cell.level = cell.inFuture ? 0 : heatLevel(cell.count, max);
  }

  const columnCount = Math.ceil(cells.length / 7);
  const grid = [];
  for (let w = 0; w < columnCount; w += 1) grid.push(cells.slice(w * 7, w * 7 + 7));

  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const streak = computeStreak(counts, now);
  return {
    start,
    end,
    weeks: grid,
    cells,
    max,
    total,
    current_streak: streak.current,
    longest_streak: streak.longest,
  };
}

// Consecutive days with at least one review. The current streak is allowed to
// "rest" on today: if today has no reviews yet but yesterday does, the streak is
// still counted (the day is not over). `counts` may be a Map, an array of day
// keys or a plain object.
export function computeStreak(counts, now = new Date()) {
  const active = new Set();
  if (counts instanceof Map) {
    for (const [key, value] of counts) {
      if ((Number(value) || 0) > 0 && DAY_RE.test(key)) active.add(key);
    }
  } else if (Array.isArray(counts)) {
    for (const item of counts) {
      const key = dayKey(item);
      if (key) active.add(key);
    }
  } else if (counts && typeof counts === "object") {
    for (const [key, value] of Object.entries(counts)) {
      if ((Number(value) || 0) > 0 && DAY_RE.test(key)) active.add(key);
    }
  }

  const today = todayKey(now);
  let cursor = active.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (cursor && active.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of [...active].sort()) {
    if (prev && addDays(prev, 1) === key) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = key;
  }

  return { current, longest };
}

// ---------- cards by state ----------

export const STATE_BUCKETS = ["new", "learning", "review", "mastered"];

// The four buckets the stats page shows. New = untouched; Learning folds in
// Relearning (state 3); a Review card that has reached maturity is "mastered".
//
// Maturity may arrive either as a precomputed boolean (the aggregated SQL groups
// by `stability >= 21`) or as the raw stability; both are accepted.
export function classifyState({ state, stability, mature } = {}) {
  const value = Number(state) || 0;
  if (value === 0) return "new";
  if (value === 1 || value === 3) return "learning";
  const isMature = typeof mature === "boolean" ? mature : Number(stability) >= MASTERED_STABILITY_DAYS;
  return isMature ? "mastered" : "review";
}

// rows: [{ state, stability?|mature?, n }] -> { new, learning, review, mastered, total }.
export function summarizeStates(rows = []) {
  const out = { new: 0, learning: 0, review: 0, mastered: 0, total: 0 };
  for (const row of rows ?? []) {
    const n = Number(row?.n ?? row?.count) || 0;
    out[classifyState({ state: row?.state, stability: row?.stability, mature: row?.mature })] += n;
    out.total += n;
  }
  return out;
}

// ---------- retention ----------

function retentionBand(rows, predicate) {
  let total = 0;
  let correct = 0;
  for (const row of rows ?? []) {
    if (!predicate(row)) continue;
    total += Number(row?.total ?? row?.n) || 0;
    correct += Number(row?.correct) || 0;
  }
  return { correct, total, rate: total > 0 ? correct / total : null };
}

// True retention: of the cards that were already in the Review state when they
// came up (state_before = 2), how many were recalled (rating >= 3). The headline
// number is the mature band; the young band and the whole review population come
// along so the UI can explain the figure.
export function summarizeRetention(rows = []) {
  const inReview = (row) => (Number(row?.state_before) || 0) === 2;
  // Maturity arrives either precomputed from the aggregated SQL (a `mature`
  // boolean) or as the raw stability_before on a single review row.
  const isMature = (row) =>
    typeof row?.mature === "boolean"
      ? row.mature
      : Number(row?.stability_before) >= MATURE_STABILITY_DAYS;
  return {
    overall: retentionBand(rows, inReview),
    mature: retentionBand(rows, (row) => inReview(row) && isMature(row)),
    young: retentionBand(rows, (row) => inReview(row) && !isMature(row)),
  };
}

// ---------- due forecast ----------

// A 30-day bar series. Anything already due before today (overdue) is folded
// into the first bar, which is the Anki convention ("due today + backlog").
export function buildForecast(rows = [], { days = FORECAST_DAYS, now = new Date() } = {}) {
  const counts = countsByDay(rows);
  const today = todayKey(now);

  let overdue = 0;
  for (const [key, n] of counts) {
    if (key < today) overdue += n;
  }

  const buckets = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(today, i);
    buckets.push({ date, offset: i, count: counts.get(date) ?? 0 });
  }
  if (buckets.length) {
    buckets[0].count += overdue;
    buckets[0].overdue = overdue;
  }

  let max = 0;
  let total = 0;
  for (const bucket of buckets) {
    if (bucket.count > max) max = bucket.count;
    total += bucket.count;
  }
  return { days: buckets, overdue, max, total };
}

// ---------- think-time trend ----------

// A day-by-day average think time. Days with no reviews are null so the line
// breaks rather than dropping to zero.
export function buildTrend(rows = [], { days = TREND_DAYS, now = new Date() } = {}) {
  const byDay = new Map();
  for (const row of rows ?? []) {
    const key = dayKey(row?.day ?? row?.date);
    if (!key) continue;
    byDay.set(key, {
      avg_ms: Number(row?.avg_ms ?? row?.avg) || 0,
      n: Number(row?.n ?? row?.count) || 0,
    });
  }

  const today = todayKey(now);
  const series = [];
  let weighted = 0;
  let weight = 0;
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const entry = byDay.get(date);
    const avg = entry && entry.n > 0 ? entry.avg_ms : null;
    series.push({ date, avg_ms: avg, n: entry?.n ?? 0 });
    if (avg != null) {
      weighted += avg * entry.n;
      weight += entry.n;
    }
  }
  return { days: series, average_ms: weight > 0 ? Math.round(weighted / weight) : null };
}

// ---------- chart geometry (pure, unit-tested) ----------

// Round a maximum up to a friendly axis ceiling (1, 2, 5, 10 * 10^n).
export function niceCeil(value) {
  const n = Number(value) || 0;
  if (n <= 0) return 1;
  const exponent = Math.floor(Math.log10(n));
  const base = 10 ** exponent;
  const fraction = n / base;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * base;
}

// A linear mapping from a domain interval onto a range interval. A zero-width
// domain collapses to the range midpoint rather than dividing by zero.
export function scaleLinear(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// An SVG path through a point list, lifting the pen where a value is missing so
// gaps stay visible.
export function linePath(points = []) {
  let d = "";
  let pen = false;
  for (const point of points) {
    if (!point || point.y === null || point.y === undefined) {
      pen = false;
      continue;
    }
    const x = round2(point.x);
    const y = round2(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x},${y} `;
    pen = true;
  }
  return d.trim();
}

export function polarToCartesian(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

// A donut slice as an SVG path (outer arc out, inner arc back). Angles are in
// radians, 0 at 3 o'clock, growing clockwise on screen.
export function arcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const o1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const o2 = polarToCartesian(cx, cy, rOuter, endAngle);
  const i1 = polarToCartesian(cx, cy, rInner, endAngle);
  const i2 = polarToCartesian(cx, cy, rInner, startAngle);
  return (
    `M${round2(o1.x)},${round2(o1.y)} ` +
    `A${rOuter},${rOuter} 0 ${large} 1 ${round2(o2.x)},${round2(o2.y)} ` +
    `L${round2(i1.x)},${round2(i1.y)} ` +
    `A${rInner},${rInner} 0 ${large} 0 ${round2(i2.x)},${round2(i2.y)} Z`
  );
}

// Turn a list of values into donut slices starting at 12 o'clock. Zero values
// become null (nothing to draw) but keep their slot, so indices stay aligned
// with the caller's legend. `gap` is the angular padding between slices.
export function donutSegments(values = [], { start = -Math.PI / 2, gap = 0.03 } = {}) {
  const total = values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (total <= 0) return values.map(() => null);
  const out = [];
  let angle = start;
  for (const raw of values) {
    const value = Math.max(0, Number(raw) || 0);
    const sweep = (value / total) * Math.PI * 2;
    if (value > 0) {
      const a0 = angle + gap / 2;
      const a1 = angle + sweep - gap / 2;
      out.push({ start: a0, end: Math.max(a0, a1), value });
    } else {
      out.push(null);
    }
    angle += sweep;
  }
  return out;
}
