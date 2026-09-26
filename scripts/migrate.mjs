import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.loadEnvFile(".env");

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

// The Neon HTTP driver sends every sql.query() as a single prepared
// statement, which Postgres rejects for multi-statement strings
// ("cannot insert multiple commands into a prepared statement").
// So split each migration file into individual statements and send
// them one at a time.
function splitStatements(text) {
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const files = (await readdir(MIGRATIONS_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const only = process.argv[2];

for (const file of files) {
  if (only && !file.includes(only)) continue;

  const statements = splitStatements(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
  console.log(`\n${file} (${statements.length} statements)`);

  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, " ").slice(0, 68);
    try {
      await sql.query(stmt);
      console.log(`  ok   ${label}...`);
    } catch (err) {
      // Idempotency guard: re-running an already-applied migration
      // should not abort the whole run.
      if (/already exists|duplicate key|duplicate object/i.test(err.message)) {
        console.log(`  skip ${label}... (${err.code ?? "exists"})`);
        continue;
      }
      console.error(`  FAIL ${label}...`);
      console.error(`       ${err.message}`);
      process.exit(1);
    }
  }
}

console.log("\nmigrations applied");
