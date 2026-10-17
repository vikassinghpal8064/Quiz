import { describe, it, expect } from "vitest";
import {
  BACKUP_VERSION,
  backupFilename,
  cardsToCsv,
  categoryOptions,
  csvEscape,
  normaliseBackup,
  restoreBackup,
} from "../backup.js";

// backup.js is mostly pure. restoreBackup talks to api/_flash/* through injected
// deps, so it is exercised here with in-memory fakes that record what happened.

describe("normaliseBackup", () => {
  it("rejects things that are not a backup object", () => {
    expect(normaliseBackup(null).error).toBeTruthy();
    expect(normaliseBackup([]).error).toBeTruthy();
    expect(normaliseBackup("nope").error).toBeTruthy();
  });

  it("rejects an empty backup", () => {
    expect(normaliseBackup({ folders: [], categories: [], cards: [] }).error).toBeTruthy();
  });

  it("defaults the missing arrays and keeps the version", () => {
    const { value } = normaliseBackup({ version: 2, folders: [{ id: 1, name: "A" }] });
    expect(value.version).toBe(2);
    expect(value.categories).toEqual([]);
    expect(value.cards).toEqual([]);
    expect(value.media).toEqual([]);
  });
});

describe("csvEscape + cardsToCsv", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe("");
  });

  it("writes a header and one row per card", () => {
    const csv = cardsToCsv([
      {
        card_type: "basic",
        front: { blocks: [{ type: "text", text: "Q1" }] },
        back: { blocks: [{ type: "text", text: "A1" }] },
        tags: ["bio", "cell"],
        suspended: true,
        source: "anki",
        source_ref: "n1",
      },
      {
        card_type: "basic",
        front: { blocks: [{ type: "image", url: "https://x/y.webp" }] },
        back: { blocks: [{ type: "audio", url: "https://x/y.mp3" }] },
        tags: [],
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Front,Back,Tags,Type,Suspended,Source,Source ref");
    expect(lines[1]).toBe("Q1,A1,bio cell,basic,yes,anki,n1");
    expect(lines[2]).toBe("🖼️ Image,🔊 Audio,,basic,no,,");
  });
});

describe("backupFilename", () => {
  it("is timestamped, safe and prefixed", () => {
    const name = backupFilename("backup", "json", new Date(2026, 0, 2, 3, 4));
    expect(name).toBe("flash-backup-20260102-0304.json");
    expect(name).not.toMatch(/[\\/]/);
  });
});

describe("categoryOptions", () => {
  it("nests children under their parent, in depth order", () => {
    const options = categoryOptions([
      { id: 1, name: "Root", parent_id: null },
      { id: 2, name: "Child", parent_id: 1 },
      { id: 3, name: "Grandchild", parent_id: 2 },
      { id: 9, name: "Other", parent_id: null },
    ]);
    expect(options.map((o) => [o.id, o.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [9, 0],
    ]);
  });
});

// ---------- restore ----------

function makeDeps({ folders = [], categories = [] } = {}) {
  const state = {
    folders: folders.map((f) => ({ ...f })),
    categories: categories.map((c) => ({ ...c })),
    cards: [],
    suspended: [],
    nextFolderId: 100,
    nextCategoryId: 200,
    nextCardId: 300,
  };
  let catSeq = state.nextCategoryId;
  let cardSeq = state.nextCardId;
  return {
    state,
    listFolders: async () => state.folders.map((f) => ({ id: f.id, name: f.name })),
    listCategories: async (folderId) => state.categories.filter((c) => c.folder_id === folderId),
    createFolder: async (payload) => {
      const row = { id: state.nextFolderId++, ...payload };
      state.folders.push(row);
      return row;
    },
    createCategory: async (payload) => {
      const row = { id: catSeq++, ...payload };
      state.categories.push(row);
      return row;
    },
    bulkCreateCards: async (cards, categoryId) => {
      const created = cards.map((card) => {
        const row = { id: cardSeq++, category_id: categoryId, ...card };
        state.cards.push(row);
        return row;
      });
      return { inserted: created.length, cards: created };
    },
    suspendCards: async (ids, suspended) => {
      state.suspended.push(...ids);
      return { updated: ids.length, suspended, card_ids: ids };
    },
  };
}

const BACKUP = {
  version: BACKUP_VERSION,
  folders: [{ id: 1, name: "Biology", icon: "🧬", color: "sage" }],
  categories: [
    { id: 11, folder_id: 1, parent_id: null, name: "Cell" },
    { id: 12, folder_id: 1, parent_id: 11, name: "Nucleus" },
  ],
  cards: [
    { id: 101, category_id: 12, card_type: "basic", front: { blocks: [] }, back: { blocks: [] }, tags: ["x"] },
    { id: 102, category_id: 11, card_type: "basic", front: { blocks: [] }, back: { blocks: [] }, suspended: true },
    { id: 103, category_id: 999, card_type: "basic", front: {}, back: {} }, // orphan
  ],
};

describe("restoreBackup", () => {
  it("creates folders, nested categories and cards, and suspends flagged ones", async () => {
    const deps = makeDeps();
    const stats = await restoreBackup(BACKUP, deps);

    expect(stats.folders).toBe(1);
    expect(stats.categories).toBe(2);
    expect(stats.cards).toBe(2);
    expect(stats.suspended).toBe(1);
    expect(stats.skipped).toBe(1); // the orphan card

    // Parent resolved before child.
    const cell = deps.state.categories.find((c) => c.name === "Cell");
    const nucleus = deps.state.categories.find((c) => c.name === "Nucleus");
    expect(nucleus.parent_id).toBe(cell.id);
    expect(nucleus.folder_id).toBe(cell.folder_id);

    // Card landed in the nested category; suspended card flagged.
    expect(deps.state.cards.find((c) => c.tags.includes("x")).category_id).toBe(nucleus.id);
    expect(deps.state.suspended).toHaveLength(1);
  });

  it("reuses existing folders and categories by name", async () => {
    const deps = makeDeps({
      folders: [{ id: 5, name: "biology" }],
      categories: [{ id: 50, folder_id: 5, parent_id: null, name: "Cell" }],
    });
    const stats = await restoreBackup(BACKUP, deps);

    expect(stats.folders).toBe(0);
    expect(stats.foldersReused).toBe(1);
    expect(stats.categoriesReused).toBe(1); // "Cell" already existed (case-insensitive)
    expect(stats.categories).toBe(1); // only "Nucleus" created
    // The reused "Cell" id is the parent of the new "Nucleus".
    const nucleus = deps.state.categories.find((c) => c.name === "Nucleus");
    expect(nucleus.parent_id).toBe(50);
  });

  it("reports progress and throws on a non-backup", async () => {
    const deps = makeDeps();
    const phases = [];
    await restoreBackup(BACKUP, deps, { onProgress: (p) => phases.push(p.phase) });
    expect(phases).toContain("folders");
    expect(phases).toContain("categories");
    expect(phases).toContain("cards");

    await expect(restoreBackup({}, deps)).rejects.toThrow(/no folders|categories|cards/i);
  });
});
