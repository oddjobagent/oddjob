import { randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

import type {
  Blueprint,
  Deployment,
  DeploymentInput,
  Run,
  RunFilter,
  StateProvider,
} from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

export interface SqliteStateOptions {
  path: string;
}

export class StateSqliteProvider implements StateProvider {
  readonly name = "state-sqlite";
  private db!: Database;
  private readonly path: string;

  constructor(options: SqliteStateOptions) {
    this.path = options.path;
  }

  async connect(): Promise<void> {
    this.db = new Database(this.path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
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

  async getKv(namespace: string, key: string): Promise<unknown | null> {
    const row = this.db
      .query<{ value_json: string; expires_at: number | null }, [string, string]>(
        "SELECT value_json, expires_at FROM memory WHERE deployment_id = '_global' AND namespace = ? AND key = ?",
      )
      .get(namespace, key);
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) return null;
    return JSON.parse(row.value_json) as unknown;
  }

  async setKv(namespace: string, key: string, value: unknown, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.db
      .query(
        `INSERT INTO memory (deployment_id, namespace, key, value_json, expires_at, updated_at)
         VALUES ('_global', ?, ?, ?, ?, ?)
         ON CONFLICT(deployment_id, namespace, key)
         DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      )
      .run(namespace, key, JSON.stringify(value), expiresAt, Date.now());
  }

  async deleteKv(namespace: string, key: string): Promise<void> {
    this.db
      .query("DELETE FROM memory WHERE deployment_id = '_global' AND namespace = ? AND key = ?")
      .run(namespace, key);
  }

  async listKv(namespace: string, prefix?: string): Promise<string[]> {
    const rows = this.db
      .query<{ key: string }, [string, string]>(
        "SELECT key FROM memory WHERE deployment_id = '_global' AND namespace = ? AND key LIKE ?",
      )
      .all(namespace, `${prefix ?? ""}%`);
    return rows.map((r) => r.key);
  }

  async upsertBlueprint(blueprint: Blueprint): Promise<void> {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO blueprints (id, name, namespace, version, schema_version, description, config_toml, config_json, content_hash, source_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           schema_version = excluded.schema_version,
           description = excluded.description,
           config_toml = excluded.config_toml,
           config_json = excluded.config_json,
           content_hash = excluded.content_hash,
           source_path = excluded.source_path,
           updated_at = excluded.updated_at`,
      )
      .run(
        blueprint.id,
        blueprint.name,
        blueprint.namespace,
        blueprint.version,
        blueprint.schemaVersion,
        blueprint.description,
        "",
        JSON.stringify(blueprint),
        blueprint.contentHash,
        blueprint.path,
        now,
        now,
      );
  }

  async getBlueprint(id: string): Promise<Blueprint | null> {
    const row = this.db
      .query<{ config_json: string }, [string]>("SELECT config_json FROM blueprints WHERE id = ?")
      .get(id);
    return row ? (JSON.parse(row.config_json) as Blueprint) : null;
  }

  async listBlueprints(): Promise<Blueprint[]> {
    const rows = this.db
      .query<{ config_json: string }, []>(
        "SELECT config_json FROM blueprints ORDER BY namespace, name",
      )
      .all();
    return rows.map((r) => JSON.parse(r.config_json) as Blueprint);
  }

  async deleteBlueprint(id: string): Promise<void> {
    this.db.query("DELETE FROM blueprints WHERE id = ?").run(id);
  }

  async createDeployment(input: DeploymentInput): Promise<Deployment> {
    const id = randomUUID();
    const now = Date.now();
    const limits = { warnThresholdPct: 80, ...input.limits };
    const dep: Deployment = {
      id,
      name: input.name,
      blueprintId: input.blueprintId,
      triggers: input.triggers,
      channels: input.channels,
      limits,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO deployments (id, name, blueprint_id, triggers_json, channels_json, limits_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dep.id,
        dep.name,
        dep.blueprintId,
        JSON.stringify(dep.triggers),
        JSON.stringify(dep.channels),
        JSON.stringify(dep.limits),
        dep.status,
        now,
        now,
      );
    return dep;
  }

  async getDeployment(id: string): Promise<Deployment | null> {
    const row = this.db
      .query<DeploymentRow, [string]>("SELECT * FROM deployments WHERE id = ?")
      .get(id);
    return row ? rowToDeployment(row) : null;
  }

  async getDeploymentByName(name: string): Promise<Deployment | null> {
    const row = this.db
      .query<DeploymentRow, [string]>("SELECT * FROM deployments WHERE name = ?")
      .get(name);
    return row ? rowToDeployment(row) : null;
  }

  async listDeployments(): Promise<Deployment[]> {
    const rows = this.db.query<DeploymentRow, []>("SELECT * FROM deployments ORDER BY name").all();
    return rows.map(rowToDeployment);
  }

  async updateDeployment(id: string, patch: Partial<Deployment>): Promise<Deployment> {
    const current = await this.getDeployment(id);
    if (!current) throw new Error(`Deployment not found: ${id}`);
    const next: Deployment = { ...current, ...patch, id, updatedAt: Date.now() };
    this.db
      .query(
        `UPDATE deployments SET name = ?, blueprint_id = ?, triggers_json = ?, channels_json = ?, limits_json = ?, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.blueprintId,
        JSON.stringify(next.triggers),
        JSON.stringify(next.channels),
        JSON.stringify(next.limits),
        next.status,
        next.updatedAt,
        id,
      );
    return next;
  }

  async deleteDeployment(id: string): Promise<void> {
    this.db.query("DELETE FROM deployments WHERE id = ?").run(id);
  }

  async createRun(run: Run): Promise<void> {
    this.db
      .query(
        `INSERT INTO runs (id, deployment_id, blueprint_id, blueprint_hash, triggered_by, status,
                           input_json, output_json, error, cost_usd, token_input, token_output, tool_calls,
                           started_at, finished_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.deploymentId,
        run.blueprintId,
        (run as Run & { blueprintHash?: string }).blueprintHash ?? "",
        run.triggeredBy,
        run.status,
        run.input ? JSON.stringify(run.input) : null,
        run.output ? JSON.stringify(run.output) : null,
        run.error ?? null,
        run.costUsd ?? null,
        run.tokenInput,
        run.tokenOutput,
        run.toolCalls,
        run.startedAt ?? null,
        run.finishedAt ?? null,
        run.createdAt,
      );
  }

  async getRun(id: string): Promise<Run | null> {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? rowToRun(row) : null;
  }

  async listRuns(filter?: RunFilter): Promise<Run[]> {
    const limit = filter?.limit ?? 50;
    if (filter?.deploymentId && filter?.status) {
      const rows = this.db
        .query<RunRow, [string, string, number]>(
          "SELECT * FROM runs WHERE deployment_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(filter.deploymentId, filter.status, limit);
      return rows.map(rowToRun);
    }
    if (filter?.deploymentId) {
      const rows = this.db
        .query<RunRow, [string, number]>(
          "SELECT * FROM runs WHERE deployment_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(filter.deploymentId, limit);
      return rows.map(rowToRun);
    }
    if (filter?.status) {
      const rows = this.db
        .query<RunRow, [string, number]>(
          "SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(filter.status, limit);
      return rows.map(rowToRun);
    }
    const rows = this.db
      .query<RunRow, [number]>("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(limit);
    return rows.map(rowToRun);
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<void> {
    const current = await this.getRun(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    const next: Run = { ...current, ...patch, id };
    this.db
      .query(
        `UPDATE runs SET status = ?, output_json = ?, error = ?, cost_usd = ?, token_input = ?, token_output = ?, tool_calls = ?, started_at = ?, finished_at = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.output ? JSON.stringify(next.output) : null,
        next.error ?? null,
        next.costUsd ?? null,
        next.tokenInput,
        next.tokenOutput,
        next.toolCalls,
        next.startedAt ?? null,
        next.finishedAt ?? null,
        id,
      );
  }
}

interface DeploymentRow {
  id: string;
  name: string;
  blueprint_id: string;
  triggers_json: string;
  channels_json: string;
  limits_json: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  deployment_id: string;
  blueprint_id: string;
  blueprint_hash: string;
  triggered_by: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  cost_usd: number | null;
  token_input: number;
  token_output: number;
  tool_calls: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}

function rowToDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    name: row.name,
    blueprintId: row.blueprint_id as `${string}/${string}`,
    triggers: JSON.parse(row.triggers_json),
    channels: JSON.parse(row.channels_json),
    limits: JSON.parse(row.limits_json),
    status: row.status as Deployment["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    blueprintId: row.blueprint_id as `${string}/${string}`,
    triggeredBy: row.triggered_by as Run["triggeredBy"],
    status: row.status as Run["status"],
    input: row.input_json ? JSON.parse(row.input_json) : undefined,
    output: row.output_json ? JSON.parse(row.output_json) : undefined,
    error: row.error ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    tokenInput: row.token_input,
    tokenOutput: row.token_output,
    toolCalls: row.tool_calls,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
  };
}
