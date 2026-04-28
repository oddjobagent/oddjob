import type { Database } from "bun:sqlite";

import sql0001 from "./migrations/0001_queue.sql" with { type: "text" };
import sql0002 from "./migrations/0002_available_at.sql" with { type: "text" };

interface Migration {
  version: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: "0001_queue.sql", sql: sql0001 },
  { version: "0002_available_at.sql", sql: sql0002 },
];

export async function runMigrations(db: Database): Promise<void> {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const appliedRows = db.query("SELECT version FROM schema_migrations").all() as Array<{
    version: string;
  }>;
  const applied = new Set(appliedRows.map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        m.version,
        Date.now(),
      );
    })();
  }
}
