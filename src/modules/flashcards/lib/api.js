// Client helpers for the /api/flash/* endpoints.
//
// Mirrors src/lib/questionMeta.js: every call goes through cachedFetch (so
// repeats are de-duplicated and writes clear the cache), and a non-OK response
// is turned into an Error carrying the API's { error } message. Keeping the
// request/error handling here means the flash screens never repeat it.
import { cachedFetch } from "../../../lib/apiCache";
import { createReviewQueue, flushWhenOnline } from "./reviewQueue";
import { cacheSession, readCachedSession } from "./sessionCache";

async function readError(res, fallback) {
  const body = await res.json().catch(() => null);
  return body?.error ?? fallback;
}

async function request(url, init, fallback) {
  const res = await cachedFetch(url, init);
  if (!res.ok) {
    const err = new Error(await readError(res, fallback));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Worth retrying later: no response at all (offline / network error) or a server
// error. A 4xx is the caller's fault and retrying it would never succeed, so it
// is surfaced immediately.
function isRetryable(err) {
  if (!err) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err.status === undefined || err.status >= 500;
}

const jsonInit = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ---------- folders ----------

export const listFolders = () =>
  request("/api/flash/folders", undefined, "Failed to load folders");

// There is no single-folder endpoint; the list is small, so resolve from it.
export async function getFolder(id) {
  const folders = await listFolders();
  return folders.find((f) => f.id === Number(id)) ?? null;
}

export const createFolder = (payload) =>
  request("/api/flash/folders", jsonInit("POST", payload), "Failed to create folder");

export const updateFolder = (id, payload) =>
  request(`/api/flash/folders/${id}`, jsonInit("PATCH", payload), "Failed to update folder");

export const deleteFolder = (id) =>
  request(`/api/flash/folders/${id}`, { method: "DELETE" }, "Failed to delete folder");

// ---------- categories ----------

export const listCategories = (folderId) =>
  request(
    `/api/flash/categories?folderId=${encodeURIComponent(folderId)}`,
    undefined,
    "Failed to load categories"
  );

export const getCategory = (id) =>
  request(`/api/flash/categories/${id}`, undefined, "Failed to load category");

export const createCategory = (payload) =>
  request("/api/flash/categories", jsonInit("POST", payload), "Failed to create category");

export const updateCategory = (id, payload) =>
  request(`/api/flash/categories/${id}`, jsonInit("PATCH", payload), "Failed to update category");

export const deleteCategory = (id) =>
  request(`/api/flash/categories/${id}`, { method: "DELETE" }, "Failed to delete category");

// The category's hardest cards (and, for nested categories, their children's),
// each with its struggle score and average think time.
export const getStruggleList = (id, limit) =>
  request(
    `/api/flash/categories/${id}/struggle${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`,
    undefined,
    "Failed to load the struggle list"
  );

// ---------- cards ----------

export function listCards({ categoryId, q, tag, limit, cursor } = {}) {
  const params = new URLSearchParams();
  if (categoryId != null) params.set("categoryId", String(categoryId));
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  if (limit != null) params.set("limit", String(limit));
  if (cursor) params.set("cursor", String(cursor));
  return request(`/api/flash/cards?${params.toString()}`, undefined, "Failed to load cards");
}

export const createCard = (payload) =>
  request("/api/flash/cards", jsonInit("POST", payload), "Failed to create card");

// Insert many cards at once. `categoryId` is the fallback for cards that do not
// carry their own; the import screen always sets it per card too.
export const bulkCreateCards = (cards, categoryId) =>
  request(
    "/api/flash/cards/bulk",
    jsonInit("POST", { cards, category_id: categoryId }),
    "Failed to import cards"
  );

export const updateCard = (id, payload) =>
  request(`/api/flash/cards/${id}`, jsonInit("PATCH", payload), "Failed to update card");

export const deleteCard = (id) =>
  request(`/api/flash/cards/${id}`, { method: "DELETE" }, "Failed to delete card");

export const moveCards = (cardIds, categoryId) =>
  request(
    "/api/flash/cards/move",
    jsonInit("POST", { card_ids: cardIds, category_id: categoryId }),
    "Failed to move cards"
  );

export const suspendCards = (cardIds, suspended = true) =>
  request(
    "/api/flash/cards/suspend",
    jsonInit("POST", { card_ids: cardIds, suspended }),
    "Failed to update cards"
  );

// ---------- import jobs ----------

// The durable record of one import run. The wizard opens a job before it starts
// POSTing batches and PATCHes it after each one, so progress (and any errors)
// survives a reload and can be inspected afterwards.
export const listImportJobs = (limit) =>
  request(
    `/api/flash/import/jobs${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`,
    undefined,
    "Failed to load import jobs"
  );

export const createImportJob = (payload) =>
  request("/api/flash/import/jobs", jsonInit("POST", payload), "Failed to start the import job");

export const updateImportJob = (id, payload) =>
  request(
    `/api/flash/import/jobs/${id}`,
    jsonInit("PATCH", payload),
    "Failed to update the import job"
  );

// The signatures of the cards already in a category, used to flag duplicate
// rows before anything is written. See importers/signature.js for the shape.
export const getDuplicateSignatures = (categoryId) =>
  request(
    `/api/flash/import/duplicates?categoryId=${encodeURIComponent(categoryId)}`,
    undefined,
    "Failed to check for duplicates"
  );

// ---------- study sessions ----------

// Start a study sitting. `payload` is
// { scope_type, scope_id?, mode?, fraction?, limit? }; the response is the new
// session row (with its id) plus `queued`, the number of cards it holds.
export const startSession = (payload) =>
  request("/api/flash/sessions", jsonInit("POST", payload), "Failed to start a study session");

export const listSessions = () =>
  request("/api/flash/sessions", undefined, "Failed to load study sessions");

// The session, its ordered queue, and the scheduler settings needed to preview
// the four rating buttons. Every successful read is cached locally, so if the
// network drops mid-sitting a reload replays the cached session and the answers
// queue up instead of failing (see reviewQueue.js).
export async function getSession(id) {
  try {
    const data = await request(`/api/flash/sessions/${id}`, undefined, "Failed to load the study session");
    cacheSession(id, data);
    return data;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    const cached = readCachedSession(id);
    if (!cached) throw err;
    return { ...cached, offline: true };
  }
}

export const reviewCard = (sessionId, payload) =>
  request(
    `/api/flash/sessions/${sessionId}/review`,
    jsonInit("POST", payload),
    "Failed to record the review"
  );

export const finishSession = (id) =>
  request(`/api/flash/sessions/${id}/finish`, jsonInit("POST", {}), "Failed to finish the session");

export const abandonSession = (id) =>
  request(`/api/flash/sessions/${id}`, { method: "DELETE" }, "Failed to abandon the session");

// ---------- stats + settings ----------

// Everything the /flash/stats screen draws. Filters: folderId / categoryId scope
// the aggregates, days sets the retention + think-time window.
export function getStats({ folderId, categoryId, days, limit } = {}) {
  const params = new URLSearchParams();
  if (folderId != null) params.set("folderId", String(folderId));
  if (categoryId != null) params.set("categoryId", String(categoryId));
  if (days != null) params.set("days", String(days));
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  return request(`/api/flash/stats${qs ? `?${qs}` : ""}`, undefined, "Failed to load stats");
}

// The small dashboard slice shown on the flash home: today's reviews against the
// daily goal, the streak, and what is due.
export const getStatsOverview = () =>
  request("/api/flash/stats/overview", undefined, "Failed to load today's progress");

export const getSettings = () =>
  request("/api/flash/settings", undefined, "Failed to load settings");

export const updateSettings = (patch) =>
  request("/api/flash/settings", jsonInit("PATCH", patch), "Failed to save settings");

// A full JSON snapshot of the caller's folders, categories, cards and media.
export const getBackup = () =>
  request("/api/flash/backup", undefined, "Failed to load your backup");

// ---------- offline review queue ----------

// The raw POST, shared by the direct path and the queue's replay.
const sendReview = (payload) =>
  request("/api/flash/reviews", jsonInit("POST", payload), "Failed to record the review");

const reviewQueue = createReviewQueue({ send: sendReview });
flushWhenOnline(reviewQueue);

// Record one answer through the flat /api/flash/reviews endpoint. If the request
// cannot reach the server (offline, or a 5xx) the payload is queued and the call
// resolves with { queued: true } so the study screen can carry on; the queue is
// replayed automatically when the browser comes back online. A 4xx still throws.
export async function postReview(payload) {
  try {
    return await sendReview(payload);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    reviewQueue.enqueue(payload);
    return { queued: true, ...payload };
  }
}

export const pendingReviewCount = () => reviewQueue.size();
export const flushReviews = () => reviewQueue.flush();
export const subscribeReviewQueue = (fn) => reviewQueue.subscribe(fn);

// Best-effort removal of the most recent queued answer, used by "Undo" when the
// answer it is undoing never reached the server.
export function dropLastQueuedReview() {
  reviewQueue.removeAt(reviewQueue.size() - 1);
}
