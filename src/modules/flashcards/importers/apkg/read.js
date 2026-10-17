// Read the handful of tables the .apkg importer needs out of an sql.js
// database. Kept apart from load.js so it can be exercised against a fake
// `{ exec() }` object or a real sql.js build.
//
// Only two tables matter:
//   col   - one row; its `models` column is JSON describing every notetype
//   notes - id, mid (notetype), flds (fields joined by 0x1f), tags
//
// Anki has kept this shape stable for a very long time, so no version sniffing
// is needed.

export const NOTETYPE_LOAD_HINT =
  "This deck uses Anki's compressed collection format (collection.anki21), which this importer cannot read yet. Re-export it from Anki with the older .anki2 format (or as CSV) and try again.";

function exec(db, sql) {
  const result = db.exec(sql);
  if (!Array.isArray(result) || result.length === 0) return [];
  return result[0].values ?? [];
}

// Open the collection bytes with a sql.js module and prove it is a real SQLite
// database. sql.js can open invalid bytes lazily, so the probe matters: a real
// collection always has sqlite_master, a zstd `collection.anki21` does not.
// `SQL` is injected so this can be exercised against a Node sql.js build.
export function openCollection(SQL, bytes, { collectionName = "collection.anki2" } = {}) {
  let db;
  try {
    db = new SQL.Database(bytes);
    db.exec("SELECT name FROM sqlite_master LIMIT 1");
  } catch {
    throw new Error(
      collectionName === "collection.anki21"
        ? NOTETYPE_LOAD_HINT
        : "Could not read the Anki collection in this deck."
    );
  }
  return db;
}

export function readNotetypes(db) {
  const rows = exec(db, "SELECT models FROM col");
  const json = rows?.[0]?.[0];
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readNotes(db) {
  const rows = exec(db, "SELECT id, mid, flds, tags FROM notes");
  return rows.map(([id, mid, flds, tags]) => ({
    id: String(id),
    mid: String(mid),
    flds: String(flds ?? ""),
    tags: String(tags ?? ""),
  }));
}
