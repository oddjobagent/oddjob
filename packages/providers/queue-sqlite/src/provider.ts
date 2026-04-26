import { randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

import type { QueueDepth, QueueProvider, QueuedRun, RunConfig } from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

export interface SqliteQueueOptions {
  path: string;
}

export class QueueSqliteProvider implements QueueProvider {
  readonly name = "queue-sqlite";
  private db!: Database;
  private readonly path: string;

  constructor(options: SqliteQueueOptions) {
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

  async enqueue(config: RunConfig): Promise<string> {
    const runId = randomUUID();
    this.db
      .query(
        `INSERT INTO queued_runs (run_id, config_json, status, attempts, enqueued_at)
         VALUES (?, ?, 'queued', 0, ?)`,
      )
      .run(runId, JSON.stringify(config), Date.now());
    return runId;
  }

  async dequeue(workerId: string, leaseMs: number): Promise<QueuedRun | null> {
    const now = Date.now();
    const leasedUntil = now + leaseMs;
    let claimed: QueueRow | null = null;
    this.db.transaction(() => {
      const row = this.db
        .query<QueueRow, []>(
          `SELECT * FROM queued_runs
            WHERE status = 'queued'
               OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < ${now})
            ORDER BY enqueued_at ASC LIMIT 1`,
        )
        .get();
      if (!row) return;
      this.db
        .query(
          `UPDATE queued_runs
             SET status = 'running', worker_id = ?, leased_until = ?,
                 attempts = attempts + 1, started_at = COALESCE(started_at, ?)
           WHERE run_id = ?`,
        )
        .run(workerId, leasedUntil, now, row.run_id);
      claimed = { ...row, status: "running", worker_id: workerId, leased_until: leasedUntil };
    })();
    if (!claimed) return null;
    const c = claimed as QueueRow;
    return {
      runId: c.run_id,
      config: JSON.parse(c.config_json) as RunConfig,
      attempts: c.attempts + 1,
      leasedUntil,
    };
  }

  async heartbeat(runId: string, workerId: string): Promise<void> {
    const now = Date.now();
    this.db
      .query(
        `UPDATE queued_runs
           SET leased_until = ?
         WHERE run_id = ? AND worker_id = ? AND status = 'running'`,
      )
      .run(now + 30_000, runId, workerId);
    this.db
      .query(
        `INSERT INTO worker_heartbeats (worker_id, last_beat_at)
         VALUES (?, ?)
         ON CONFLICT(worker_id) DO UPDATE SET last_beat_at = excluded.last_beat_at`,
      )
      .run(workerId, now);
  }

  async ack(runId: string): Promise<void> {
    this.db.query(`DELETE FROM queued_runs WHERE run_id = ?`).run(runId);
  }

  async nack(runId: string, error?: string): Promise<void> {
    this.db
      .query(
        `UPDATE queued_runs
           SET status = 'failed', last_error = ?, finished_at = ?, leased_until = NULL, worker_id = NULL
         WHERE run_id = ?`,
      )
      .run(error ?? null, Date.now(), runId);
  }

  async reclaimStale(): Promise<number> {
    const now = Date.now();
    const result = this.db
      .query(
        `UPDATE queued_runs
           SET status = 'queued', leased_until = NULL, worker_id = NULL
         WHERE status = 'running' AND leased_until IS NOT NULL AND leased_until < ?`,
      )
      .run(now);
    return Number(result.changes);
  }

  async depth(): Promise<QueueDepth> {
    const rows = this.db
      .query<{ status: string; n: number }, []>(
        `SELECT status, COUNT(*) as n FROM queued_runs GROUP BY status`,
      )
      .all();
    const out: QueueDepth = { queued: 0, running: 0, failed: 0 };
    for (const r of rows) {
      if (r.status === "queued") out.queued = r.n;
      else if (r.status === "running") out.running = r.n;
      else if (r.status === "failed") out.failed = r.n;
    }
    return out;
  }
}

interface QueueRow {
  run_id: string;
  config_json: string;
  status: string;
  attempts: number;
  worker_id: string | null;
  leased_until: number | null;
  last_error: string | null;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
}
