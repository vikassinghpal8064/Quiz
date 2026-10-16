// Waveform helpers for the audio block.
//
// Recording shows a live level meter (an AnalyserNode feeding one bar per
// animation frame); a finished recording shows a static waveform built from its
// decoded samples. Both are boiled down to a small array of 0..1 peaks so the
// view is a plain list of styled bars and downsamplingPeaks stays unit-testable.

// Collapse raw samples (-1..1) into `buckets` peak values, each the loudest
// absolute sample in its slice. Pure; safe on empty input.
export function downsamplePeaks(samples, buckets = 48) {
  const data = samples ?? [];
  // Always return the requested number of bars, even for empty input, so a
  // caller can render a stable-width (flat) waveform.
  const n = Math.max(1, Math.round(Number(buckets) || 48));
  const out = new Array(n).fill(0);
  if (!data.length) return out;

  const size = data.length / n;
  for (let bucket = 0; bucket < n; bucket += 1) {
    const start = Math.min(data.length - 1, Math.floor(bucket * size));
    const end = Math.max(start + 1, Math.min(data.length, Math.floor((bucket + 1) * size)));
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
    out[bucket] = Math.min(1, peak);
  }
  return out;
}

// Average of the last `levels` meter readings, used for the live level bar.
export function rollingLevel(levels) {
  if (!levels?.length) return 0;
  let sum = 0;
  for (const level of levels) sum += level;
  return Math.min(1, sum / levels.length);
}

// Decode a recorded/selected audio Blob and reduce it to peaks. Browser-only;
// the caller catches failures (a browser without Web Audio still keeps the
// plain <audio controls> playback).
export async function peaksFromBlob(blob, buckets = 48) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx || !blob) return null;

  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return downsamplePeaks(buffer.getChannelData(0), buckets);
  } finally {
    ctx.close?.();
  }
}
