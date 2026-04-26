import { Database } from "bun:sqlite";

import type { LogEntry, LogProvider, LogQuery } from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

export interface SqliteLogOptions {
  path: string;
}

export class LoggingSqliteProvider implements LogProvider {
  readonly name = "logging-sqlite";
  private db!: Database;
  private readonly path: string;

  constructor(options: SqliteLogOptions) {
    this.path = options.path;
  }

  async connect(): Promise<void> {
    this.db = new Database(this.path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    await runMigrations(this.db);
  }

  async disconnect(): Promise<void> {
    this.db?.close();
  }

  async healthy(): Promise<boolean> {
    try {
      this.db.query("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  async log(runId: string, entry: LogEntry): Promise<void> {
    this.db
      .query(
        `INSERT INTO run_logs (run_id, level, message, meta_json, timestamp) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        entry.level,
        entry.message,
        entry.meta ? JSON.stringify(entry.meta) : null,
        entry.timestamp,
      );
  }

  async getLogs(runId: string, options?: LogQuery): Promise<LogEntry[]> {
    const limit = options?.limit ?? 1000;
    const since = options?.since ?? 0;
    if (options?.level) {
      const rows = this.db
        .query<LogRow, [string, string, number, number]>(
          `SELECT * FROM run_logs WHERE run_id = ? AND level = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT ?`,
        )
        .all(runId, options.level, since, limit);
      return rows.map(rowToEntry);
    }
    const rows = this.db
      .query<LogRow, [string, number, number]>(
        `SELECT * FROM run_logs WHERE run_id = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT ?`,
      )
      .all(runId, since, limit);
    return rows.map(rowToEntry);
  }
}

interface LogRow {
  id: number;
  run_id: string;
  level: string;
  message: string;
  meta_json: string | null;
  timestamp: number;
}

function rowToEntry(row: LogRow): LogEntry {
  return {
    timestamp: row.timestamp,
    level: row.level as LogEntry["level"],
    message: row.message,
    meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
  };
}
