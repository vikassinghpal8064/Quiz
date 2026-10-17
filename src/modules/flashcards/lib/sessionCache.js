// A tiny durable cache for the study session payload, so a session opened at
// home still works if the network drops (or the page is reloaded) before the
// queue is finished.
//
// Only the session currently being studied needs to survive, so entries are
// small and keyed by session id. Like the review queue this module has no HTTP
// knowledge: it just stores and returns plain objects. When there is no
// localStorage (SSR, tests) it degrades to an in-memory map.

export const SESSION_CACHE_PREFIX = "fc.session.v1.";

const memory = new Map();

function hasStorage() {
  return typeof localStorage !== "undefined";
}

export function cacheSession(id, payload) {
  if (id === null || id === undefined) return;
  const key = `${SESSION_CACHE_PREFIX}${id}`;
  if (!hasStorage()) {
    memory.set(key, payload);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), payload }));
  } catch {
    memory.set(key, payload);
  }
}

export function readCachedSession(id) {
  if (id === null || id === undefined) return null;
  const key = `${SESSION_CACHE_PREFIX}${id}`;
  if (hasStorage()) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw)?.payload ?? null;
    } catch {
      /* fall through to the in-memory copy */
    }
  }
  return memory.get(key) ?? null;
}

export function clearCachedSession(id) {
  const key = `${SESSION_CACHE_PREFIX}${id}`;
  memory.delete(key);
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* disabled storage */
  }
}
