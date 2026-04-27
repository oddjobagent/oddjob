import { randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

import type { AckResult, QueueDepth, QueueProvider, QueuedRun, RunConfig } from "@oddjob/core";

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
    // Atomic UPDATE...RETURNING claims one eligible row in a single statement.
    // Eligibility = (queued AND available_at <= now) OR a stale-running lease.
    const row = this.db
      .query<ClaimRow, [string, number, number, number, number]>(
        `UPDATE queued_runs
            SET status = 'running',
                worker_id = ?,
                leased_until = ?,
                attempts = attempts + 1,
                started_at = COALESCE(started_at, ?)
          WHERE run_id = (
            SELECT run_id FROM queued_runs
             WHERE (status = 'queued' AND available_at <= ?)
                OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < ?)
             ORDER BY enqueued_at ASC LIMIT 1
          )
          RETURNING run_id, config_json, attempts, leased_until`,
      )
      .get(workerId, leasedUntil, now, now, now);
    if (!row) return null;
    return {
      runId: row.run_id,
      config: JSON.parse(row.config_json) as RunConfig,
      attempts: row.attempts,
      leasedUntil: row.leased_until,
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

  async ack(runId: string, workerId: string): Promise<AckResult> {
    const result = this.db
      .query(`DELETE FROM queued_runs WHERE run_id = ? AND worker_id = ? AND status = 'running'`)
      .run(runId, workerId);
    return result.changes > 0 ? "ok" : "lease_lost";
  }

  async nack(runId: string, workerId: string, error?: string): Promise<AckResult> {
    const result = this.db
      .query(
        `UPDATE queued_runs
            SET status = 'failed', last_error = ?, finished_at = ?, leased_until = NULL, worker_id = NULL
          WHERE run_id = ? AND worker_id = ? AND status = 'running'`,
      )
      .run(error ?? null, Date.now(), runId, workerId);
    return result.changes > 0 ? "ok" : "lease_lost";
  }

  async requeue(runId: string, workerId: string, delayMs: number): Promise<AckResult> {
    const availableAt = Date.now() + Math.max(0, delayMs);
    const result = this.db
      .query(
        `UPDATE queued_runs
            SET status = 'queued',
                leased_until = NULL,
                worker_id = NULL,
                available_at = ?
          WHERE run_id = ? AND worker_id = ? AND status = 'running'`,
      )
      .run(availableAt, runId, workerId);
    return result.changes > 0 ? "ok" : "lease_lost";
  }

  async cancel(runId: string): Promise<boolean> {
    // Only drop if not currently leased — running rows must be aborted via the worker pool's AbortController.
    const result = this.db
      .query(`DELETE FROM queued_runs WHERE run_id = ? AND status = 'queued' AND worker_id IS NULL`)
      .run(runId);
    return result.changes > 0;
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

interface ClaimRow {
  run_id: string;
  config_json: string;
  attempts: number;
  leased_until: number;
}
