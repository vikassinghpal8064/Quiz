import { describe, it, expect } from "vitest";
import { createReviewQueue } from "../reviewQueue.js";

function memStore() {
  let items = [];
  return {
    read: () => items.slice(),
    write: (next) => {
      items = next.slice();
    },
  };
}

describe("createReviewQueue", () => {
  it("enqueues and persists each item", () => {
    const store = memStore();
    const queue = createReviewQueue({ store });

    queue.enqueue({ a: 1 });
    queue.enqueue({ a: 2 });

    expect(queue.size()).toBe(2);
    expect(store.read()).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("flushes in order until a failure, then stops (and can resume)", async () => {
    const sent = [];
    let calls = 0;
    let failOn = 2;
    const queue = createReviewQueue({
      store: memStore(),
      send: async (payload) => {
        calls += 1;
        if (calls === failOn) throw new Error("offline");
        sent.push(payload);
      },
    });

    queue.enqueue({ a: 1 });
    queue.enqueue({ a: 2 });
    queue.enqueue({ a: 3 });

    expect(await queue.flush()).toBe(1);
    expect(sent).toEqual([{ a: 1 }]);
    expect(queue.size()).toBe(2); // the failed one and everything after it

    failOn = -1;
    expect(await queue.flush()).toBe(2);
    expect(sent).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(queue.size()).toBe(0);
  });

  it("notifies subscribers with the current size", () => {
    const queue = createReviewQueue({ store: memStore() });
    const seen = [];
    const off = queue.subscribe((n) => seen.push(n));

    queue.enqueue({ a: 1 });
    queue.removeAt(0);
    off();
    queue.enqueue({ a: 2 });

    expect(seen).toEqual([1, 0]);
  });
});
