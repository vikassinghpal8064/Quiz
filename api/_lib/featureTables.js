// Guard for the flags/difficulty feature, added in
// migrations/005_flags_difficulty.sql.
//
// The migration is additive and is NOT assumed to have been applied. If it
// has not, Postgres answers a query against one of the new tables with
// SQLSTATE 42P01 ("undefined_table"); without help that surfaces as a bare
// 500. Every handler that touches the new tables checks for it and returns a
// clear, actionable message instead.
//
// Run against Neon with:
//   node scripts/migrate.mjs 005_flags_difficulty
export const FLAGS_MIGRATION_HINT =
  "Flags/difficulty tables are missing. Run the migration first: node scripts/migrate.mjs 005_flags_difficulty";

const FEATURE_TABLES = /flagged_questions|question_difficulty_tags/;

export function isMissingFeatureTable(err) {
  return err?.code === "42P01" && FEATURE_TABLES.test(err.message ?? "");
}

// Sends the 503 + hint and returns true when the error is the missing-table
// case, so callers can `if (sendMissingTable(res, err)) return;`.
export function sendMissingTable(res, err) {
  if (!isMissingFeatureTable(err)) return false;
  res.status(503).json({ error: FLAGS_MIGRATION_HINT });
  return true;
}
