import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "bun:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS = join(HERE, "migrations");

export async function runMigrations(db: Database, dir: string = DEFAULT_MIGRATIONS): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const appliedRows = db.query("SELECT version FROM schema_migrations").all() as Array<{
    version: string;
  }>;
  const applied = new Set(appliedRows.map((r) => r.version));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        file,
        Date.now(),
      );
    })();
  }
}
