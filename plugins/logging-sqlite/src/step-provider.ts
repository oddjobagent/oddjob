import { Database } from "bun:sqlite";

import {
  redactStringified,
  type StepKind,
  type StepProvider,
  type StepQuery,
  type StepRecord,
} from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

export interface SqliteStepOptions {
  path: string;
}

const PRAGMA_WAL = "PRAGMA journal_mode = WAL";
const PRAGMA_BUSY = "PRAGMA busy_timeout = 5000";

export class StepSqliteProvider implements StepProvider {
  readonly name = "step-sqlite";
  private db!: Database;
  private readonly path: string;

  constructor(options: SqliteStepOptions) {
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

  async recordStep(step: StepRecord): Promise<void> {
    const metaJson = step.meta != null ? redactStringified(step.meta) : null;
    this.db
      .query(
        `INSERT INTO run_steps (
          step_id, run_id, parent_step_id, iteration, kind,
          started_at, ended_at,
          tokens_in, tokens_out, cache_read, cache_write, cost_usd,
          model, tool_name, tool_args_hash, tool_result_size,
          error, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(step_id) DO UPDATE SET
          ended_at = excluded.ended_at,
          tokens_in = excluded.tokens_in,
          tokens_out = excluded.tokens_out,
          cache_read = excluded.cache_read,
          cache_write = excluded.cache_write,
          cost_usd = excluded.cost_usd,
          model = excluded.model,
          tool_result_size = excluded.tool_result_size,
          error = excluded.error,
          meta_json = excluded.meta_json`,
      )
      .run(
        step.stepId,
        step.runId,
        step.parentStepId ?? null,
        step.iteration,
        step.kind,
        step.startedAt,
        step.endedAt ?? null,
        step.tokensIn ?? null,
        step.tokensOut ?? null,
        step.cacheRead ?? null,
        step.cacheWrite ?? null,
        step.costUsd ?? null,
        step.model ?? null,
        step.toolName ?? null,
        step.toolArgsHash ?? null,
        step.toolResultSize ?? null,
        step.error ?? null,
        metaJson,
      );
  }

  async getSteps(runId: string, options?: StepQuery): Promise<StepRecord[]> {
    const limit = options?.limit ?? 1000;
    const since = options?.since ?? 0;
    if (options?.kind) {
      const rows = this.db
        .query<StepRow, [string, string, number, number]>(
          `SELECT * FROM run_steps WHERE run_id = ? AND kind = ? AND started_at >= ?
           ORDER BY started_at ASC LIMIT ?`,
        )
        .all(runId, options.kind, since, limit);
      return rows.map(rowToStep);
    }
    const rows = this.db
      .query<StepRow, [string, number, number]>(
        `SELECT * FROM run_steps WHERE run_id = ? AND started_at >= ?
         ORDER BY started_at ASC LIMIT ?`,
      )
      .all(runId, since, limit);
    return rows.map(rowToStep);
  }
}

interface StepRow {
  step_id: string;
  run_id: string;
  parent_step_id: string | null;
  iteration: number;
  kind: string;
  started_at: number;
  ended_at: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost_usd: number | null;
  model: string | null;
  tool_name: string | null;
  tool_args_hash: string | null;
  tool_result_size: number | null;
  error: string | null;
  meta_json: string | null;
}

function rowToStep(row: StepRow): StepRecord {
  const step: StepRecord = {
    stepId: row.step_id,
    runId: row.run_id,
    iteration: row.iteration,
    kind: row.kind as StepKind,
    startedAt: row.started_at,
  };
  if (row.parent_step_id != null) step.parentStepId = row.parent_step_id;
  if (row.ended_at != null) step.endedAt = row.ended_at;
  if (row.tokens_in != null) step.tokensIn = row.tokens_in;
  if (row.tokens_out != null) step.tokensOut = row.tokens_out;
  if (row.cache_read != null) step.cacheRead = row.cache_read;
  if (row.cache_write != null) step.cacheWrite = row.cache_write;
  if (row.cost_usd != null) step.costUsd = row.cost_usd;
  if (row.model != null) step.model = row.model;
  if (row.tool_name != null) step.toolName = row.tool_name;
  if (row.tool_args_hash != null) step.toolArgsHash = row.tool_args_hash;
  if (row.tool_result_size != null) step.toolResultSize = row.tool_result_size;
  if (row.error != null) step.error = row.error;
  if (row.meta_json != null) step.meta = JSON.parse(row.meta_json) as Record<string, unknown>;
  return step;
}
