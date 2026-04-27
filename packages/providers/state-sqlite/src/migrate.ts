import type { Database } from "bun:sqlite";

import sql0001 from "./migrations/0001_init.sql" with { type: "text" };
import sql0002 from "./migrations/0002_deployment_extras.sql" with { type: "text" };
import sql0003 from "./migrations/0003_run_validation.sql" with { type: "text" };
import sql0004 from "./migrations/0004_channel_templates.sql" with { type: "text" };
import sql0005 from "./migrations/0005_blueprint_versions.sql" with { type: "text" };

interface Migration {
  version: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: "0001_init.sql", sql: sql0001 },
  { version: "0002_deployment_extras.sql", sql: sql0002 },
  { version: "0003_run_validation.sql", sql: sql0003 },
  { version: "0004_channel_templates.sql", sql: sql0004 },
  { version: "0005_blueprint_versions.sql", sql: sql0005 },
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
