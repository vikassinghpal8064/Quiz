// A small durable queue for review writes, so an answer given while the network
// is down is not lost.
//
// The queue is deliberately dumb: it holds the exact request bodies that would
// have gone to POST /api/flash/reviews and replays them in order as soon as it
// can. `send` is injected (see lib/api.js) so this module has no HTTP knowledge
// of its own and can be tested with a fake sender and an in-memory store.

export const REVIEW_QUEUE_KEY = "fc.reviewQueue.v1";

// Fallback store used when there is no localStorage (SSR, tests, private mode).
function memoryStore() {
  let items = [];
  return {
    read: () => items,
    write: (next) => {
      items = next;
    },
  };
}

function browserStore() {
  if (typeof localStorage === "undefined") return memoryStore();
  return {
    read() {
      try {
        const raw = localStorage.getItem(REVIEW_QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    write(items) {
      try {
        localStorage.setItem(REVIEW_QUEUE_KEY, JSON.stringify(items));
      } catch {
        /* quota / disabled storage: the in-memory copy still works this session */
      }
    },
  };
}

// createReviewQueue -> { size, items, enqueue, removeAt, clear, subscribe, flush }
//
// flush() replays from the front and stops at the first failure (still offline),
// so ordering and the "once" guarantee are preserved. send() must reject/throw
// when the item should be retried later.
export function createReviewQueue({ send, store } = {}) {
  const backend = store ?? browserStore();
  let items = backend.read();
  const listeners = new Set();
  let flushing = false;

  function persist() {
    backend.write(items);
    for (const fn of listeners) fn(items.length);
  }

  return {
    size: () => items.length,
    items: () => items.slice(),
    enqueue(payload) {
      items.push(payload);
      persist();
      return items.length;
    },
    removeAt(index) {
      if (index >= 0 && index < items.length) {
        items.splice(index, 1);
        persist();
      }
    },
    clear() {
      items = [];
      persist();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async flush() {
      if (flushing || typeof send !== "function") return 0;
      flushing = true;
      let sent = 0;
      try {
        while (items.length) {
          try {
            await send(items[0]);
          } catch {
            break; // still unreachable - keep the rest for the next attempt
          }
          items.shift();
          sent += 1;
          persist();
        }
      } finally {
        flushing = false;
      }
      return sent;
    },
  };
}

// Replay the queue when the browser reports it is back online. No-op outside a
// browser, so importing this from an SSR/test context is safe.
export function flushWhenOnline(queue) {
  if (typeof window === "undefined" || typeof queue?.flush !== "function") return () => {};
  const run = () => {
    queue.flush().catch(() => {});
  };
  window.addEventListener("online", run);
  return () => window.removeEventListener("online", run);
}
