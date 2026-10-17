// Backup / restore helpers for the flash cards.
//
// Split deliberately in two:
//   * pure helpers (normaliseBackup, cardsToCsv, csvEscape, categoryOptions,
//     restoreBackup with injected deps) - unit-testable without a browser, and
//   * tiny DOM helpers (downloadText / downloadJson) that only run on a click.
//
// restoreBackup is additive by design: it never deletes or modifies existing
// folders, categories or cards. A folder / category whose name already exists at
// the same position is reused; cards are always appended (a restore is a merge,
// not a mirror).

import { sideText } from "./format.js";

export const BACKUP_VERSION = 1;

// Matches MAX_BULK_CARDS in api/_lib/flashCards.js and MAX_ID_LIST (suspend).
export const RESTORE_BATCH = 500;

const norm = (value) => String(value ?? "").trim().toLowerCase();
const categoryKey = (folderId, parentId, name) => `${folderId}|${parentId ?? ""}|${norm(name)}`;

// ---------- validation ----------

// Check that a parsed JSON blob looks like a flash backup and return the four
// arrays (missing ones default to empty). Returns { error } for anything that is
// not a plausible backup so the UI can explain rather than crash.
export function normaliseBackup(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "That file is not a flash-cards backup (expected a JSON object)." };
  }
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  const media = Array.isArray(raw.media) ? raw.media : [];
  if (folders.length === 0 && categories.length === 0 && cards.length === 0) {
    return { error: "This backup has no folders, categories or cards." };
  }
  return { value: { version: raw.version ?? 1, exported_at: raw.exported_at ?? null, folders, categories, cards, media } };
}

// ---------- CSV ----------

export function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADERS = ["Front", "Back", "Tags", "Type", "Suspended", "Source", "Source ref"];

// One row per card. Front/back are flattened with the same sideText the list
// rows use, so a media-only card still reads as something.
export function cardsToCsv(cards = []) {
  const lines = [CSV_HEADERS.join(",")];
  for (const card of cards) {
    lines.push(
      [
        sideText(card?.front),
        sideText(card?.back),
        Array.isArray(card?.tags) ? card.tags.join(" ") : "",
        card?.card_type ?? "basic",
        card?.suspended ? "yes" : "no",
        card?.source ?? "",
        card?.source_ref ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

// filenames are safe (no path separators) and sortable (YYYYMMDD-HHmm).
export function backupFilename(kind, ext, date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `flash-${kind}-${stamp}.${ext}`;
}

// ---------- category tree ----------

// Flatten categories into a depth-ordered list of { id, label, depth } so a
// <select> can show nesting with indentation. Children follow their parent.
export function categoryOptions(categories = []) {
  const byParent = new Map();
  for (const c of categories) {
    const key = c?.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  }
  const out = [];
  const walk = (parentId, depth) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      out.push({ id: child.id, label: `${"  ".repeat(depth)}${child.name}`, depth, name: child.name });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---------- restore ----------

function toCardPayload(card) {
  return {
    card_type: card?.card_type || "basic",
    front: card?.front ?? {},
    back: card?.back ?? {},
    tags: Array.isArray(card?.tags) ? card.tags : [],
    source: card?.source ?? null,
    source_ref: card?.source_ref ?? null,
  };
}

// Rebuild a backup into the caller's account. `deps` is injected so the flow can
// be tested with fakes:
//   { listFolders, listCategories, createFolder, createCategory,
//     bulkCreateCards, suspendCards }
// Resolving categories runs in passes so a child can wait for its parent.
export async function restoreBackup(raw, deps, { onProgress } = {}) {
  const parsed = normaliseBackup(raw);
  if (parsed.error) throw new Error(parsed.error);
  const data = parsed.value;

  const stats = {
    folders: 0,
    foldersReused: 0,
    categories: 0,
    categoriesReused: 0,
    cards: 0,
    suspended: 0,
    skipped: 0,
  };
  const report = (phase, done, total) => onProgress?.({ phase, done, total });

  // --- folders ---
  const existingFolders = await deps.listFolders();
  const folderByName = new Map();
  for (const folder of existingFolders) folderByName.set(norm(folder.name), folder.id);

  const folderIdByBackupId = new Map();
  let folderDone = 0;
  for (const folder of data.folders) {
    const name = String(folder?.name ?? "").trim();
    if (!name) continue;
    let id = folderByName.get(norm(name));
    if (id != null) {
      stats.foldersReused += 1;
    } else {
      const created = await deps.createFolder({
        name,
        description: folder.description ?? null,
        color: folder.color ?? null,
        icon: folder.icon ?? null,
        sort_order: Number.isFinite(folder.sort_order) ? folder.sort_order : 0,
      });
      id = created.id;
      folderByName.set(norm(name), id);
      stats.folders += 1;
    }
    folderIdByBackupId.set(folder.id, id);
    report("folders", ++folderDone, data.folders.length);
  }

  // --- categories (parent-aware, multi-pass) ---
  const existingCatKeys = new Map();
  const loadedFolders = new Set();
  async function ensureLoaded(folderId) {
    if (loadedFolders.has(folderId)) return;
    const list = await deps.listCategories(folderId);
    for (const c of list) existingCatKeys.set(categoryKey(folderId, c.parent_id, c.name), c.id);
    loadedFolders.add(folderId);
  }

  const parentIds = new Set(data.categories.map((c) => c?.id).filter((id) => id != null));
  const categoryIdByBackupId = new Map();
  const pending = data.categories.filter((c) => c && String(c.name ?? "").trim());
  let catDone = 0;
  let passes = 0;
  while (pending.length && passes < 16) {
    passes += 1;
    let progressed = false;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const cat = pending[i];
      const name = String(cat.name).trim();
      const folderId = folderIdByBackupId.get(cat.folder_id);
      if (folderId == null) {
        pending.splice(i, 1);
        stats.skipped += 1;
        continue;
      }
      // Wait for a parent that is itself in the backup and not yet resolved.
      const needsParent = cat.parent_id != null && parentIds.has(cat.parent_id);
      const parentId = cat.parent_id != null ? categoryIdByBackupId.get(cat.parent_id) ?? null : null;
      if (needsParent && parentId == null) continue;

      await ensureLoaded(folderId);
      const key = categoryKey(folderId, parentId, name);
      let id = existingCatKeys.get(key);
      if (id != null) {
        stats.categoriesReused += 1;
      } else {
        const created = await deps.createCategory({
          folder_id: folderId,
          parent_id: parentId,
          name,
          description: cat.description ?? null,
          sort_order: Number.isFinite(cat.sort_order) ? cat.sort_order : 0,
        });
        id = created.id;
        existingCatKeys.set(key, id);
        stats.categories += 1;
      }
      categoryIdByBackupId.set(cat.id, id);
      pending.splice(i, 1);
      progressed = true;
      report("categories", ++catDone, data.categories.length);
    }
    if (!progressed) break; // unresolved parents (e.g. a cycle): stop
  }
  stats.skipped += pending.length;

  // --- cards ---
  const byCategory = new Map();
  for (const card of data.cards) {
    const categoryId = categoryIdByBackupId.get(card?.category_id);
    if (categoryId == null) {
      stats.skipped += 1;
      continue;
    }
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, []);
    byCategory.get(categoryId).push(card);
  }

  const totalCards = data.cards.length;
  let cardDone = 0;
  const toSuspend = [];
  for (const [categoryId, cards] of byCategory) {
    for (let i = 0; i < cards.length; i += RESTORE_BATCH) {
      const slice = cards.slice(i, i + RESTORE_BATCH);
      const result = await deps.bulkCreateCards(slice.map(toCardPayload), categoryId);
      const created = Array.isArray(result?.cards) ? result.cards : [];
      for (let k = 0; k < slice.length; k += 1) {
        cardDone += 1;
        if (slice[k]?.suspended && created[k]?.id != null) toSuspend.push(created[k].id);
      }
      report("cards", cardDone, totalCards);
    }
  }
  stats.cards = cardDone;

  for (let i = 0; i < toSuspend.length; i += RESTORE_BATCH) {
    await deps.suspendCards(toSuspend.slice(i, i + RESTORE_BATCH), true);
  }
  stats.suspended = toSuspend.length;

  return stats;
}

// ---------- browser download helpers ----------

export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename, value) {
  downloadText(filename, JSON.stringify(value, null, 2), "application/json");
}

// Excel needs a BOM to read UTF-8 CSV correctly.
export function downloadCsv(filename, csv) {
  downloadText(filename, `\uFEFF${csv}`, "text/csv;charset=utf-8");
}
