// Human-readable interval formatting: 10m, 3d, 2.5mo, 1.2y.
// Pure, dependency-free, shared by every scheduler's previewIntervals().

import { DAY_MS } from "./cardState.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const MONTH_MS = DAY_MS * 30.44;
const YEAR_MS = DAY_MS * 365.25;

function round1(value) {
  return String(Math.round(value * 10) / 10);
}

// ms -> "10m" | "3d" | "2.5mo" | "1.2y". Sub-minute values show seconds.
export function formatInterval(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  if (ms < MINUTE_MS) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)}m`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}h`;
  if (ms < MONTH_MS) return `${Math.round(ms / DAY_MS)}d`;
  if (ms < YEAR_MS) return `${round1(ms / MONTH_MS)}mo`;
  return `${round1(ms / YEAR_MS)}y`;
}

const UNIT_MS = {
  s: 1_000,
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
  mo: MONTH_MS,
  y: YEAR_MS,
};

// Inverse of formatInterval (used to compare orderings in tests and to sort
// intervals in the UI). "mo" is matched before "m" on purpose.
export function parseIntervalText(text) {
  const match = /^(\d+(?:\.\d+)?)(mo|s|m|h|d|y)$/.exec(String(text).trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * UNIT_MS[match[2]];
}
