import { Database } from "bun:sqlite";

import type { MessageProvider, MessageQuery, MessageRecord } from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

export interface SqliteRunMessageOptions {
  path: string;
}

const PRAGMA_WAL = "PRAGMA journal_mode = WAL";
const PRAGMA_BUSY = "PRAGMA busy_timeout = 5000";

export class RunMessageSqliteProvider implements MessageProvider {
  readonly name = "run-message-sqlite";
  private db!: Database;
  private readonly path: string;

  constructor(options: SqliteRunMessageOptions) {
    this.path = options.path;
  }

  async connect(): Promise<void> {
    this.db = new Database(this.path, { create: true });
    this.db.run(PRAGMA_WAL);
    this.db.run(PRAGMA_BUSY);
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

  async recordMessage(record: MessageRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO run_messages (run_id, seq, role, content_json, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(record.runId, record.seq, record.role, JSON.stringify(record.content), record.recordedAt);
  }

  async getMessages(runId: string, options?: MessageQuery): Promise<MessageRecord[]> {
    const limit = options?.limit ?? 1000;
    const since = options?.sinceSeq ?? 0;
    if (options?.role) {
      const rows = this.db
        .query<MessageRow, [string, string, number, number]>(
          `SELECT * FROM run_messages WHERE run_id = ? AND role = ? AND seq >= ?
           ORDER BY seq ASC LIMIT ?`,
        )
        .all(runId, options.role, since, limit);
      return rows.map(rowToMessage);
    }
    const rows = this.db
      .query<MessageRow, [string, number, number]>(
        `SELECT * FROM run_messages WHERE run_id = ? AND seq >= ?
         ORDER BY seq ASC LIMIT ?`,
      )
      .all(runId, since, limit);
    return rows.map(rowToMessage);
  }

  async nextSeq(runId: string): Promise<number> {
    const row = this.db
      .query<{ max_seq: number | null }, [string]>(
        `SELECT MAX(seq) AS max_seq FROM run_messages WHERE run_id = ?`,
      )
      .get(runId);
    const cur = row?.max_seq ?? null;
    return cur === null ? 0 : cur + 1;
  }
}

interface MessageRow {
  run_id: string;
  seq: number;
  role: string;
  content_json: string;
  recorded_at: number;
}

function rowToMessage(row: MessageRow): MessageRecord {
  return {
    runId: row.run_id,
    seq: row.seq,
    role: row.role,
    content: JSON.parse(row.content_json),
    recordedAt: row.recorded_at,
  };
}
