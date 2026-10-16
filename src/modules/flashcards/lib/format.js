// Presentation helpers shared by the flash-card screens: folder colour/icon
// choices, and turning a card's JSON sides and scheduler fields into the short
// strings the list rows show.
//
// Pure and dependency-light: it only pulls the interval formatter and the state
// vocabulary from the scheduler, so importing it never drags in ts-fsrs.
import { formatInterval } from "./scheduler/formatInterval.js";
import { STATES } from "./scheduler/constants.js";

// Struggling threshold - mirrors STRUGGLE_THRESHOLD in api/_lib/flashCards.js.
export const STRUGGLE_THRESHOLD = 0.5;

// ---------- folder colour + icon ----------

// Maps a stored folder.colour key to the accent classes already defined in
// src/index.css (.accent-sage / .accent-butter / .accent-pink / .accent-lavender).
// Colours stay in the stylesheet - nothing is hardcoded here.
export const FOLDER_COLORS = [
  { key: "sage", label: "Sage", swatch: "var(--color-sage)" },
  { key: "butter", label: "Butter", swatch: "var(--color-butter)" },
  { key: "pink", label: "Pink", swatch: "var(--color-pink)" },
  { key: "lavender", label: "Lavender", swatch: "var(--color-lavender-deep)" },
];

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[0].key;

// Single-glyph icon set, matching the app's text-icon style (no icon library).
export const FOLDER_ICONS = [
  "🗂️", "📚", "⚡", "🧪", "🧬", "📐", "🌍", "🎨", "🎵", "🧠", "⭐", "🔤", "🩺", "⚖️", "💻", "🏛️",
];

export const DEFAULT_FOLDER_ICON = FOLDER_ICONS[0];

export function colorFor(key) {
  return FOLDER_COLORS.find((c) => c.key === key) ?? FOLDER_COLORS[0];
}

// The accent class for a folder. A folder with no (or an unknown) colour falls
// back to a rotating pastel so a grid never comes out monochrome.
export function accentClass(key, index = 0) {
  const found = FOLDER_COLORS.find((c) => c.key === key);
  const chosen = found ?? FOLDER_COLORS[index % FOLDER_COLORS.length];
  return `accent-${chosen.key}`;
}

export function folderIcon(icon) {
  return typeof icon === "string" && icon.trim() ? icon : DEFAULT_FOLDER_ICON;
}

// ---------- card sides ----------

// Flatten a card side ({ blocks: [...] }) to readable text. Non-text blocks
// become a short label so a media-only card is never blank.
export function sideText(side) {
  const blocks = side?.blocks;
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") {
      if (typeof block.text === "string" && block.text.trim()) parts.push(block.text.trim());
    } else if (block.type === "image") {
      parts.push("🖼️ Image");
    } else if (block.type === "audio") {
      parts.push("🔊 Audio");
    } else if (block.type === "ink") {
      parts.push("✍️ Ink");
    }
  }
  return parts.join("\n");
}

// ---------- scheduler fields ----------

const STATE_LABELS = {
  [STATES.New]: "New",
  [STATES.Learning]: "Learning",
  [STATES.Review]: "Review",
  [STATES.Relearning]: "Relearning",
};

export function stateLabel(state) {
  return STATE_LABELS[state] ?? "New";
}

// "Ready" when due now, otherwise "in 3d" / "in 10m". A missing schedule (or a
// brand-new card) reads as "New".
export function dueLabel(due, now = new Date()) {
  if (!due) return "New";
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return "New";
  const diff = at.getTime() - now.getTime();
  if (diff <= 0) return "Ready";
  return `in ${formatInterval(diff)}`;
}

// True when a card is reviewable today: due before the end of today. Mirrors
// the SQL window used by the folders / categories endpoints.
export function isDueToday(due, now = new Date()) {
  if (!due) return false;
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return false;
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return at.getTime() <= endOfDay.getTime();
}

export function isStruggling(score) {
  return typeof score === "number" && score >= STRUGGLE_THRESHOLD;
}

// Milliseconds -> a compact "4m 12s" / "42s". Used by the session summary to
// show how long a sitting took. Non-positive / unknown input reads as "0s".
export function formatDuration(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total <= 0) return "0s";
  const seconds = Math.round(total / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  if (rest === 0) return `${minutes}m`;
  return `${minutes}m ${rest}s`;
}
