// A small pool of encoder workers.
//
// Importing a 150-page PDF should not open 150 workers, nor should it serialise
// every page behind one. A fixed pool (default 3) keeps at most three encodes in
// flight, matching the "process 3 pages in parallel" requirement while leaving
// the UI thread free.
//
// The pool is lazy: the workers (and the ~30 KB of worker code) are only created
// the first time a real encode runs, and every path degrades to the main-thread
// encoder in encode.js when OffscreenCanvas or Worker is missing or a worker
// dies.

import { encodeWithFallback } from "./encode.js";

export const DEFAULT_ENCODE_POOL_SIZE = 3;

let sequence = 0;

// Is off-thread encoding possible at all? Both halves are needed: a Worker to
// run it and an OffscreenCanvas to draw into.
export function workersSupported() {
  return (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof createImageBitmap === "function"
  );
}

function spawnWorker() {
  // `new URL(..., import.meta.url)` is what lets the bundler emit the worker as
  // its own chunk and keep it a real, resolvable URL in the built output.
  return new Worker(new URL("./encode.worker.js", import.meta.url), { type: "module" });
}

// One pool, shared by every import in the tab. Created on first use.
let pool = null;

function getPool() {
  if (pool) return pool;
  pool = createEncodePool();
  return pool;
}

export function createEncodePool(size = DEFAULT_ENCODE_POOL_SIZE) {
  const count = Math.max(1, Math.min(8, Number(size) || DEFAULT_ENCODE_POOL_SIZE));
  const workers = [];
  const idle = [];
  const queue = [];
  const jobs = new Map();
  let terminated = false;

  function dispatch(worker) {
    const job = queue.shift();
    if (!job) {
      idle.push(worker);
      return;
    }
    jobs.set(job.id, job);
    // Transfer the bitmap so the pixels are not copied between threads.
    worker.postMessage(job.payload, [job.payload.bitmap]);
  }

  function onMessage(worker, event) {
    const { id, ok, blob, type, fellBack, error } = event.data ?? {};
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (ok) job.resolve({ blob, type, fellBack });
    else job.reject(new Error(error || "Encoding failed"));
    if (!terminated) dispatch(worker);
  }

  function onError(worker, event) {
    // A worker that failed to load or threw outside the handler: fail every job
    // it held so the pipeline can fall back, then drop the worker.
    const held = [...jobs.values()];
    jobs.clear();
    for (const job of held) job.reject(new Error(event?.message || "The encoder worker crashed"));
    const index = workers.indexOf(worker);
    if (index >= 0) workers.splice(index, 1);
    const idleIndex = idle.indexOf(worker);
    if (idleIndex >= 0) idle.splice(idleIndex, 1);
    try {
      worker.terminate();
    } catch {
      /* already gone */
    }
    // If that was the last worker, drain the queue through the next one created.
    while (queue.length && workers.length) dispatch(workers.pop());
  }

  function ensureWorkers() {
    if (terminated) return;
    while (workers.length < count) {
      let worker;
      try {
        worker = spawnWorker();
      } catch {
        break;
      }
      worker.onmessage = (event) => onMessage(worker, event);
      worker.onerror = (event) => onError(worker, event);
      worker.onmessageerror = (event) => onError(worker, event);
      workers.push(worker);
      idle.push(worker);
    }
  }

  return {
    get size() {
      return workers.length;
    },
    encode(bitmap, opts) {
      ensureWorkers();
      if (!workers.length) {
        // No worker could be created - let the caller use the main thread.
        return Promise.reject(Object.assign(new Error("No encoder workers"), { noWorker: true }));
      }
      return new Promise((resolve, reject) => {
        sequence += 1;
        const id = sequence;
        const job = { id, payload: { id, bitmap, ...opts }, resolve, reject };
        queue.push(job);
        const worker = idle.pop();
        if (worker) dispatch(worker);
      });
    },
    terminate() {
      terminated = true;
      for (const worker of workers) {
        try {
          worker.terminate();
        } catch {
          /* already gone */
        }
      }
      workers.length = 0;
      idle.length = 0;
      queue.length = 0;
      for (const job of jobs.values()) job.reject(new Error("Encoder pool terminated"));
      jobs.clear();
      if (pool === this) pool = null;
    },
  };
}

// Encode one bitmap. Uses the shared worker pool when available and falls back
// to the main thread otherwise (or after a worker failure).
//
// `rasterize` is an optional () => Promise<ImageBitmap> used to rebuild the
// source after a transfer detaches it. Without it a worker failure cannot retry.
export async function encodeBitmap(bitmap, opts, { rasterize } = {}) {
  if (workersSupported()) {
    try {
      return await getPool().encode(bitmap, opts);
    } catch {
      // fall through to the main thread
    }
  }
  const source = rasterize ? await rasterize() : bitmap;
  return encodeWithFallback(source, opts);
}

// Tear the shared pool down. Called by tests and whenever the tab is hidden for
// a long time; harmless to call more than once.
export function terminateEncodePool() {
  pool?.terminate();
  pool = null;
}
