// React binding for a page source. Loads a PDF or a set of page images, tracks
// progress, and exposes per-page pixel measurements on demand.
//
// Measuring a page (for blank detection and pair-similarity warnings) means
// rasterising it once at a small width; results are cached, so each page is only
// measured once no matter how many features ask for it.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadPageSource } from "./pageSource.js";
import { isBlankStats } from "./arrays.js";

export function usePageSource(files) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [source, setSource] = useState(null);

  const statsRef = useRef(new Map());
  const sourceRef = useRef(null);

  useEffect(() => {
    const list = [...(files ?? [])];
    if (!list.length) {
      setStatus("idle");
      setSource(null);
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);
    setProgress({ loaded: 0, total: list.length });

    loadPageSource(list, {
      onProgress: (p) => {
        if (!cancelled) setProgress(p);
      },
    })
      .then((next) => {
        if (cancelled) {
          next.destroy?.();
          return;
        }
        sourceRef.current?.destroy?.();
        sourceRef.current = next;
        statsRef.current = new Map();
        setSource(next);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Could not open that file");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [files]);

  useEffect(() => () => sourceRef.current?.destroy?.(), []);

  // Measure one page, memoised. Returns the { mean, stddev, min, max } stats plus
  // the blank verdict so callers do not each re-derive it.
  const measure = useCallback(async (index) => {
    const src = sourceRef.current;
    if (!src) return null;
    if (statsRef.current.has(index)) return statsRef.current.get(index);
    const stats = await src.stats(index);
    const value = { ...stats, blank: isBlankStats(stats) };
    statsRef.current.set(index, value);
    return value;
  }, []);

  const measureMany = useCallback(
    async (indexes, { onProgress, concurrency = 3 } = {}) => {
      const list = [...new Set(indexes ?? [])];
      const out = new Map();
      let done = 0;
      let next = 0;

      async function run() {
        while (next < list.length) {
          const index = list[next];
          next += 1;
          // eslint-disable-next-line no-await-in-loop
          const value = await measure(index);
          if (value) out.set(index, value);
          done += 1;
          onProgress?.(done, list.length);
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, run));
      return out;
    },
    [measure]
  );

  return { status, source, error, progress, measure, measureMany };
}
