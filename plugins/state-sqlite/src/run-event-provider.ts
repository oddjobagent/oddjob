import { Database } from "bun:sqlite";

import type { RunEventPatch, RunEventProvider, RunEventRecord } from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

export interface SqliteRunEventOptions {
  path: string;
}

const PRAGMA_WAL = "PRAGMA journal_mode = WAL";
const PRAGMA_BUSY = "PRAGMA busy_timeout = 5000";

export class RunEventSqliteProvider implements RunEventProvider {
  readonly name = "run-event-sqlite";
  private db!: Database;
  private readonly path: string;

  constructor(options: SqliteRunEventOptions) {
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

  async record(record: RunEventRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO run_events (
           run_id, seq, call_site, call_type, call_args_hash, args_json,
           status, started_at, completed_at, result_json, error_json,
           child_run_id, schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.runId,
        record.seq,
        record.callSite,
        record.callType,
        record.callArgsHash,
        record.argsJson ?? null,
        record.status,
        record.startedAt,
        record.completedAt ?? null,
        record.resultJson ?? null,
        record.errorJson ?? null,
        record.childRunId ?? null,
        record.schemaVersion,
      );
  }

  async update(runId: string, seq: number, patch: RunEventPatch): Promise<void> {
    this.db
      .query(
        `UPDATE run_events
            SET status = ?, completed_at = ?, result_json = ?, error_json = ?, child_run_id = COALESCE(?, child_run_id)
          WHERE run_id = ? AND seq = ?`,
      )
      .run(
        patch.status,
        patch.completedAt,
        patch.resultJson ?? null,
        patch.errorJson ?? null,
        patch.childRunId ?? null,
        runId,
        seq,
      );
  }

  async getNextSeq(runId: string): Promise<number> {
    const row = this.db
      .query<{ max_seq: number | null }, [string]>(
        `SELECT MAX(seq) AS max_seq FROM run_events WHERE run_id = ?`,
      )
      .get(runId);
    const cur = row?.max_seq ?? null;
    return cur === null ? 0 : cur + 1;
  }

  async findByKey(runId: string, seq: number): Promise<RunEventRecord | null> {
    const row = this.db
      .query<RunEventRow, [string, number]>(
        `SELECT * FROM run_events WHERE run_id = ? AND seq = ?`,
      )
      .get(runId, seq);
    return row ? rowToRecord(row) : null;
  }

  async list(runId: string): Promise<RunEventRecord[]> {
    const rows = this.db
      .query<RunEventRow, [string]>(
        `SELECT * FROM run_events WHERE run_id = ? ORDER BY seq ASC`,
      )
      .all(runId);
    return rows.map(rowToRecord);
  }
}

interface RunEventRow {
  run_id: string;
  seq: number;
  call_site: string;
  call_type: string;
  call_args_hash: string;
  args_json: string | null;
  status: "pending" | "completed" | "failed";
  started_at: number;
  completed_at: number | null;
  result_json: string | null;
  error_json: string | null;
  child_run_id: string | null;
  schema_version: number;
}

function rowToRecord(row: RunEventRow): RunEventRecord {
  return {
    runId: row.run_id,
    seq: row.seq,
    callSite: row.call_site,
    callType: row.call_type,
    callArgsHash: row.call_args_hash,
    argsJson: row.args_json ?? undefined,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    resultJson: row.result_json ?? undefined,
    errorJson: row.error_json ?? undefined,
    childRunId: row.child_run_id ?? undefined,
    schemaVersion: 1,
  };
}
