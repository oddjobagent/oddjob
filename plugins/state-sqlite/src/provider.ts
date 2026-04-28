import { randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

import type {
  Blueprint,
  BlueprintResolveRef,
  BlueprintTagRow,
  BlueprintVersionRow,
  ChannelTemplate,
  ConnectorTokenRecord,
  Deployment,
  DeploymentInput,
  DeploymentListFilter,
  EngineModelRoleRecord,
  Environment,
  EnvironmentInput,
  ModelCatalogRecord,
  ModelInfo,
  PluginManifest,
  PluginRecord,
  PluginSource,
  ProviderCredentialRecord,
  Run,
  RunFilter,
  StateProvider,
  UpsertBlueprintOptions,
} from "@oddjob/core";
import { BlueprintTagNotFoundError, BlueprintVersionExistsError } from "@oddjob/core";

import { runMigrations } from "./migrate.ts";

const DEFAULT_TAG = "latest";

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
      .query<{ key: string }, [string, string, number]>(
        "SELECT key FROM memory WHERE deployment_id = '_global' AND namespace = ? AND key LIKE ? AND (expires_at IS NULL OR expires_at > ?)",
      )
      .all(namespace, `${prefix ?? ""}%`, Date.now());
    return rows.map((r) => r.key);
  }

  async upsertBlueprint(blueprint: Blueprint, opts?: UpsertBlueprintOptions): Promise<void> {
    const now = Date.now();
    const force = opts?.force ?? false;
    const extraTags = opts?.tags ?? [];

    const existingVersion = this.db
      .query<{ blueprint_id: string }, [string, string]>(
        "SELECT blueprint_id FROM blueprint_versions WHERE blueprint_id = ? AND version = ?",
      )
      .get(blueprint.id, blueprint.version);
    if (existingVersion && !force) {
      throw new BlueprintVersionExistsError(blueprint.id, blueprint.version);
    }

    const cfgJson = JSON.stringify(blueprint);
    const tomlSrc = blueprint.sourceToml ?? "";

    this.db.transaction(() => {
      // 1. Immutable version row.
      if (existingVersion && force) {
        this.db
          .query(
            `UPDATE blueprint_versions
                SET schema_version = ?, description = ?, config_toml = ?, config_json = ?,
                    content_hash = ?, source_path = ?, created_at = ?
              WHERE blueprint_id = ? AND version = ?`,
          )
          .run(
            blueprint.schemaVersion,
            blueprint.description,
            tomlSrc,
            cfgJson,
            blueprint.contentHash,
            blueprint.path,
            now,
            blueprint.id,
            blueprint.version,
          );
      } else {
        this.db
          .query(
            `INSERT INTO blueprint_versions (blueprint_id, version, schema_version, description,
                                              config_toml, config_json, content_hash, source_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            blueprint.id,
            blueprint.version,
            blueprint.schemaVersion,
            blueprint.description,
            tomlSrc,
            cfgJson,
            blueprint.contentHash,
            blueprint.path,
            now,
          );
      }

      // 2. Move `latest` + any caller-supplied tags.
      const tags = new Set<string>([DEFAULT_TAG, ...extraTags]);
      for (const tag of tags) {
        this.db
          .query(
            `INSERT INTO blueprint_tags (blueprint_id, tag, version, updated_at)
                 VALUES (?, ?, ?, ?)
             ON CONFLICT(blueprint_id, tag) DO UPDATE SET
                 version = excluded.version, updated_at = excluded.updated_at`,
          )
          .run(blueprint.id, tag, blueprint.version, now);
      }

      // 3. Keep the legacy `blueprints` table in sync with whatever `latest` now points at,
      // so existing single-row reads continue to work.
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
          tomlSrc,
          cfgJson,
          blueprint.contentHash,
          blueprint.path,
          now,
          now,
        );
    })();
  }

  async getBlueprint(id: string, ref?: BlueprintResolveRef): Promise<Blueprint | null> {
    if (ref?.version) {
      const row = this.db
        .query<{ config_json: string }, [string, string]>(
          "SELECT config_json FROM blueprint_versions WHERE blueprint_id = ? AND version = ?",
        )
        .get(id, ref.version);
      return row ? (JSON.parse(row.config_json) as Blueprint) : null;
    }
    const tag = ref?.tag ?? DEFAULT_TAG;
    const tagRow = this.db
      .query<{ version: string }, [string, string]>(
        "SELECT version FROM blueprint_tags WHERE blueprint_id = ? AND tag = ?",
      )
      .get(id, tag);
    if (tagRow) {
      const row = this.db
        .query<{ config_json: string }, [string, string]>(
          "SELECT config_json FROM blueprint_versions WHERE blueprint_id = ? AND version = ?",
        )
        .get(id, tagRow.version);
      if (row) return JSON.parse(row.config_json) as Blueprint;
    }
    if (ref?.tag && ref.tag !== DEFAULT_TAG) {
      // Caller asked for a specific tag that doesn't exist — explicit miss.
      return null;
    }
    // Legacy fallback for rows that haven't been backfilled (defensive — migration handles this).
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
    this.db.transaction(() => {
      this.db.query("DELETE FROM blueprint_tags WHERE blueprint_id = ?").run(id);
      this.db.query("DELETE FROM blueprint_versions WHERE blueprint_id = ?").run(id);
      this.db.query("DELETE FROM blueprints WHERE id = ?").run(id);
    })();
  }

  async listBlueprintVersions(id: string): Promise<BlueprintVersionRow[]> {
    const rows = this.db
      .query<
        {
          blueprint_id: string;
          version: string;
          description: string;
          content_hash: string;
          created_at: number;
        },
        [string]
      >(
        "SELECT blueprint_id, version, description, content_hash, created_at FROM blueprint_versions WHERE blueprint_id = ? ORDER BY created_at DESC",
      )
      .all(id);
    return rows.map((r) => ({
      blueprintId: r.blueprint_id,
      version: r.version,
      description: r.description,
      contentHash: r.content_hash,
      createdAt: r.created_at,
    }));
  }

  async listBlueprintTags(id: string): Promise<BlueprintTagRow[]> {
    const rows = this.db
      .query<{ blueprint_id: string; tag: string; version: string; updated_at: number }, [string]>(
        "SELECT blueprint_id, tag, version, updated_at FROM blueprint_tags WHERE blueprint_id = ? ORDER BY tag",
      )
      .all(id);
    return rows.map((r) => ({
      blueprintId: r.blueprint_id,
      tag: r.tag,
      version: r.version,
      updatedAt: r.updated_at,
    }));
  }

  async setBlueprintTag(id: string, tag: string, version: string): Promise<void> {
    const versionRow = this.db
      .query<{ version: string }, [string, string]>(
        "SELECT version FROM blueprint_versions WHERE blueprint_id = ? AND version = ?",
      )
      .get(id, version);
    if (!versionRow) {
      throw new Error(`blueprint ${id}@${version} does not exist — push it before tagging`);
    }
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO blueprint_tags (blueprint_id, tag, version, updated_at)
             VALUES (?, ?, ?, ?)
         ON CONFLICT(blueprint_id, tag) DO UPDATE SET
             version = excluded.version, updated_at = excluded.updated_at`,
      )
      .run(id, tag, version, now);
    if (tag === DEFAULT_TAG) {
      // Keep legacy single-row blueprints table in sync with the latest pointer.
      const cfgRow = this.db
        .query<
          {
            config_json: string;
            description: string;
            content_hash: string;
            source_path: string;
            schema_version: number;
            config_toml: string;
          },
          [string, string]
        >(
          "SELECT config_json, description, content_hash, source_path, schema_version, config_toml FROM blueprint_versions WHERE blueprint_id = ? AND version = ?",
        )
        .get(id, version);
      if (cfgRow) {
        const bp = JSON.parse(cfgRow.config_json) as Blueprint;
        this.db
          .query(
            `UPDATE blueprints SET version = ?, schema_version = ?, description = ?, config_toml = ?,
                                    config_json = ?, content_hash = ?, source_path = ?, updated_at = ?
                              WHERE id = ?`,
          )
          .run(
            version,
            cfgRow.schema_version,
            cfgRow.description,
            cfgRow.config_toml,
            cfgRow.config_json,
            cfgRow.content_hash,
            cfgRow.source_path,
            now,
            bp.id,
          );
      }
    }
  }

  async deleteBlueprintTag(id: string, tag: string): Promise<void> {
    if (tag === DEFAULT_TAG) {
      throw new Error("cannot delete the 'latest' tag");
    }
    const res = this.db
      .query("DELETE FROM blueprint_tags WHERE blueprint_id = ? AND tag = ?")
      .run(id, tag);
    if (res.changes === 0) throw new BlueprintTagNotFoundError(id, tag);
  }

  async createDeployment(input: DeploymentInput): Promise<Deployment> {
    const id = randomUUID();
    const now = Date.now();
    const limits = { warnThresholdPct: 80, ...input.limits };
    const dep: Deployment = {
      id,
      name: input.name,
      blueprintId: input.blueprintId,
      blueprintTag: input.blueprintTag ?? "latest",
      triggers: input.triggers,
      channels: input.channels,
      limits,
      status: "active",
      modelOverride: input.modelOverride,
      modelRoleOverrides: input.modelRoleOverrides,
      defaultInput: input.defaultInput,
      environmentId: input.environmentId,
      environmentInline: input.environmentInline,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO deployments (id, name, blueprint_id, blueprint_tag, triggers_json, channels_json, limits_json, status, model_override, default_input_json, model_role_overrides_json, environment_id, environment_inline_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dep.id,
        dep.name,
        dep.blueprintId,
        dep.blueprintTag,
        JSON.stringify(dep.triggers),
        JSON.stringify(dep.channels),
        JSON.stringify(dep.limits),
        dep.status,
        dep.modelOverride ?? null,
        dep.defaultInput !== undefined ? JSON.stringify(dep.defaultInput) : null,
        dep.modelRoleOverrides ? JSON.stringify(dep.modelRoleOverrides) : null,
        dep.environmentId ?? null,
        dep.environmentInline ? JSON.stringify(dep.environmentInline) : null,
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

  async listDeployments(filter?: DeploymentListFilter): Promise<Deployment[]> {
    const rows = filter?.includeArchived
      ? this.db.query<DeploymentRow, []>("SELECT * FROM deployments ORDER BY name").all()
      : this.db
          .query<DeploymentRow, []>(
            "SELECT * FROM deployments WHERE status != 'archived' ORDER BY name",
          )
          .all();
    return rows.map(rowToDeployment);
  }

  async updateDeployment(id: string, patch: Partial<Deployment>): Promise<Deployment> {
    const current = await this.getDeployment(id);
    if (!current) throw new Error(`Deployment not found: ${id}`);
    const next: Deployment = { ...current, ...patch, id, updatedAt: Date.now() };
    this.db
      .query(
        `UPDATE deployments
            SET name = ?, blueprint_id = ?, blueprint_tag = ?, triggers_json = ?, channels_json = ?,
                limits_json = ?, status = ?, model_override = ?, default_input_json = ?,
                model_role_overrides_json = ?, environment_id = ?, environment_inline_json = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.name,
        next.blueprintId,
        next.blueprintTag,
        JSON.stringify(next.triggers),
        JSON.stringify(next.channels),
        JSON.stringify(next.limits),
        next.status,
        next.modelOverride ?? null,
        next.defaultInput !== undefined ? JSON.stringify(next.defaultInput) : null,
        next.modelRoleOverrides ? JSON.stringify(next.modelRoleOverrides) : null,
        next.environmentId ?? null,
        next.environmentInline ? JSON.stringify(next.environmentInline) : null,
        next.updatedAt,
        id,
      );
    return next;
  }

  async deleteDeployment(id: string): Promise<void> {
    // Soft delete: mark archived. Hard delete is no longer supported (Phase 15).
    const now = Date.now();
    this.db
      .query(`UPDATE deployments SET status = 'archived', updated_at = ? WHERE id = ?`)
      .run(now, id);
  }

  async createRun(run: Run): Promise<void> {
    this.db
      .query(
        `INSERT INTO runs (id, deployment_id, blueprint_id, blueprint_hash, blueprint_version, triggered_by, status,
                           input_json, output_json, output_validation_json, error, cost_usd,
                           token_input, token_output, tool_calls,
                           started_at, finished_at, created_at, environment_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.deploymentId,
        run.blueprintId,
        run.blueprintHash ?? "",
        run.blueprintVersion ?? null,
        run.triggeredBy,
        run.status,
        run.input ? JSON.stringify(run.input) : null,
        run.output ? JSON.stringify(run.output) : null,
        run.outputValidation ? JSON.stringify(run.outputValidation) : null,
        run.error ?? null,
        run.costUsd ?? null,
        run.tokenInput,
        run.tokenOutput,
        run.toolCalls,
        run.startedAt ?? null,
        run.finishedAt ?? null,
        run.createdAt,
        run.environmentSnapshot ? JSON.stringify(run.environmentSnapshot) : null,
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

  async upsertConnectorToken(record: ConnectorTokenRecord): Promise<void> {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO connector_tokens (connector_id, deployment_id, connector_name,
              access_token_encrypted, refresh_token_encrypted, expires_at, refresh_expires_at,
              token_url, client_id, client_secret_encrypted, scopes, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connector_id) DO UPDATE SET
           access_token_encrypted = excluded.access_token_encrypted,
           refresh_token_encrypted = excluded.refresh_token_encrypted,
           expires_at = excluded.expires_at,
           refresh_expires_at = excluded.refresh_expires_at,
           token_url = excluded.token_url,
           client_id = excluded.client_id,
           client_secret_encrypted = excluded.client_secret_encrypted,
           scopes = excluded.scopes,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.connectorId,
        record.deploymentId,
        record.connectorName,
        record.accessTokenEncrypted,
        record.refreshTokenEncrypted ?? null,
        record.expiresAt ?? null,
        record.refreshExpiresAt ?? null,
        record.tokenUrl ?? null,
        record.clientId ?? null,
        record.clientSecretEncrypted ?? null,
        record.scopes ?? null,
        record.status,
        record.updatedAt ?? now,
      );
  }

  async getConnectorToken(connectorId: string): Promise<ConnectorTokenRecord | null> {
    const row = this.db
      .query<ConnectorTokenRow, [string]>("SELECT * FROM connector_tokens WHERE connector_id = ?")
      .get(connectorId);
    return row ? rowToConnectorToken(row) : null;
  }

  async listConnectorTokens(): Promise<ConnectorTokenRecord[]> {
    const rows = this.db
      .query<ConnectorTokenRow, []>("SELECT * FROM connector_tokens ORDER BY connector_id")
      .all();
    return rows.map(rowToConnectorToken);
  }

  async deleteConnectorToken(connectorId: string): Promise<void> {
    this.db.query("DELETE FROM connector_tokens WHERE connector_id = ?").run(connectorId);
  }

  async upsertChannelTemplate(template: ChannelTemplate): Promise<void> {
    this.db
      .query(
        `INSERT INTO channel_templates (name, type, config_json, description, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
              type = excluded.type,
              config_json = excluded.config_json,
              description = excluded.description,
              updated_at = excluded.updated_at`,
      )
      .run(
        template.name,
        template.type,
        JSON.stringify(template.config),
        template.description ?? null,
        template.createdAt,
        template.updatedAt,
      );
  }

  async getChannelTemplate(name: string): Promise<ChannelTemplate | null> {
    const row = this.db
      .query<ChannelTemplateRow, [string]>(
        "SELECT name, type, config_json, description, created_at, updated_at FROM channel_templates WHERE name = ?",
      )
      .get(name);
    return row ? rowToTemplate(row) : null;
  }

  async listChannelTemplates(): Promise<ChannelTemplate[]> {
    const rows = this.db
      .query<ChannelTemplateRow, []>(
        "SELECT name, type, config_json, description, created_at, updated_at FROM channel_templates ORDER BY name",
      )
      .all();
    return rows.map(rowToTemplate);
  }

  async deleteChannelTemplate(name: string): Promise<void> {
    this.db.query("DELETE FROM channel_templates WHERE name = ?").run(name);
  }

  async upsertEnvironment(input: EnvironmentInput): Promise<Environment> {
    const now = Date.now();
    const env: Environment = {
      id: input.id,
      name: input.name,
      description: input.description,
      config: input.config,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO environments (id, name, description, config_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              config_json = excluded.config_json,
              updated_at = excluded.updated_at`,
      )
      .run(env.id, env.name ?? null, env.description ?? null, JSON.stringify(env.config), now, now);
    const existing = await this.getEnvironment(env.id);
    return existing ?? env;
  }

  async getEnvironment(id: string): Promise<Environment | null> {
    const row = this.db.query<EnvRow, [string]>("SELECT * FROM environments WHERE id = ?").get(id);
    return row ? rowToEnv(row) : null;
  }

  async listEnvironments(): Promise<Environment[]> {
    const rows = this.db.query<EnvRow, []>("SELECT * FROM environments ORDER BY id").all();
    return rows.map(rowToEnv);
  }

  async deleteEnvironment(id: string): Promise<void> {
    this.db.query("DELETE FROM environments WHERE id = ?").run(id);
  }

  async listPlugins(): Promise<PluginRecord[]> {
    const rows = this.db.query<PluginRow, []>("SELECT * FROM plugins ORDER BY slug").all();
    return rows.map(rowToPlugin);
  }

  async getPlugin(slug: string): Promise<PluginRecord | null> {
    const row = this.db
      .query<PluginRow, [string]>("SELECT * FROM plugins WHERE slug = ?")
      .get(slug);
    return row ? rowToPlugin(row) : null;
  }

  async upsertPlugin(record: PluginRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO plugins (slug, version, source, enabled, manifest_json, config_json, installed_at, disabled_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
              version = excluded.version,
              source = excluded.source,
              enabled = excluded.enabled,
              manifest_json = excluded.manifest_json,
              config_json = excluded.config_json,
              disabled_at = excluded.disabled_at`,
      )
      .run(
        record.slug,
        record.version,
        record.source,
        record.enabled ? 1 : 0,
        JSON.stringify(record.manifest),
        record.configJson ?? null,
        record.installedAt,
        record.disabledAt ?? null,
      );
  }

  async setPluginEnabled(slug: string, enabled: boolean): Promise<void> {
    this.db
      .query(`UPDATE plugins SET enabled = ?, disabled_at = ? WHERE slug = ?`)
      .run(enabled ? 1 : 0, enabled ? null : Date.now(), slug);
  }

  async deletePlugin(slug: string): Promise<void> {
    // Soft delete: flip enabled off + stamp disabled_at; rows linger for audit.
    this.db
      .query(`UPDATE plugins SET enabled = 0, disabled_at = ? WHERE slug = ?`)
      .run(Date.now(), slug);
  }

  async listProviderCredentials(providerSlug?: string): Promise<ProviderCredentialRecord[]> {
    const rows = providerSlug
      ? this.db
          .query<ProviderCredRow, [string]>(
            "SELECT * FROM provider_credentials WHERE provider_slug = ? ORDER BY credential_name",
          )
          .all(providerSlug)
      : this.db
          .query<ProviderCredRow, []>(
            "SELECT * FROM provider_credentials ORDER BY provider_slug, credential_name",
          )
          .all();
    return rows.map(rowToProviderCred);
  }

  async getProviderCredential(
    providerSlug: string,
    credentialName: string,
  ): Promise<ProviderCredentialRecord | null> {
    const row = this.db
      .query<ProviderCredRow, [string, string]>(
        "SELECT * FROM provider_credentials WHERE provider_slug = ? AND credential_name = ?",
      )
      .get(providerSlug, credentialName);
    return row ? rowToProviderCred(row) : null;
  }

  async upsertProviderCredential(record: ProviderCredentialRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO provider_credentials (provider_slug, credential_name, api_key_secret, options_json, source, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_slug, credential_name) DO UPDATE SET
              api_key_secret = excluded.api_key_secret,
              options_json = excluded.options_json,
              source = excluded.source,
              updated_at = excluded.updated_at`,
      )
      .run(
        record.providerSlug,
        record.credentialName,
        record.apiKeySecret ?? null,
        record.optionsJson ?? null,
        record.source,
        record.createdAt,
        record.updatedAt,
      );
  }

  async deleteProviderCredential(providerSlug: string, credentialName: string): Promise<void> {
    this.db
      .query("DELETE FROM provider_credentials WHERE provider_slug = ? AND credential_name = ?")
      .run(providerSlug, credentialName);
  }

  async listEngineModelRoles(): Promise<EngineModelRoleRecord[]> {
    const rows = this.db
      .query<EngineRoleRow, []>("SELECT * FROM engine_model_roles ORDER BY role")
      .all();
    return rows.map(rowToEngineRole);
  }

  async getEngineModelRole(role: string): Promise<EngineModelRoleRecord | null> {
    const row = this.db
      .query<EngineRoleRow, [string]>("SELECT * FROM engine_model_roles WHERE role = ?")
      .get(role);
    return row ? rowToEngineRole(row) : null;
  }

  async upsertEngineModelRole(record: EngineModelRoleRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO engine_model_roles (role, provider_slug, model_id, credential_name, options_json, source, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(role) DO UPDATE SET
              provider_slug = excluded.provider_slug,
              model_id = excluded.model_id,
              credential_name = excluded.credential_name,
              options_json = excluded.options_json,
              source = excluded.source,
              updated_at = excluded.updated_at`,
      )
      .run(
        record.role,
        record.providerSlug,
        record.modelId,
        record.credentialName,
        record.optionsJson ?? null,
        record.source,
        record.updatedAt,
      );
  }

  async deleteEngineModelRole(role: string): Promise<void> {
    this.db.query("DELETE FROM engine_model_roles WHERE role = ?").run(role);
  }

  async listModelCatalog(providerSlug?: string): Promise<ModelCatalogRecord[]> {
    const rows = providerSlug
      ? this.db
          .query<ModelCatalogRow, [string]>(
            "SELECT * FROM model_catalog WHERE provider_slug = ? ORDER BY model_id",
          )
          .all(providerSlug)
      : this.db
          .query<ModelCatalogRow, []>(
            "SELECT * FROM model_catalog ORDER BY provider_slug, model_id",
          )
          .all();
    return rows.map(rowToCatalog);
  }

  async upsertModelCatalogEntry(entry: ModelCatalogRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO model_catalog (provider_slug, model_id, data_json, fetched_at)
              VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_slug, model_id) DO UPDATE SET
              data_json = excluded.data_json,
              fetched_at = excluded.fetched_at`,
      )
      .run(entry.providerSlug, entry.modelId, JSON.stringify(entry.data), entry.fetchedAt);
  }

  async deleteModelCatalogEntries(providerSlug: string): Promise<void> {
    this.db.query("DELETE FROM model_catalog WHERE provider_slug = ?").run(providerSlug);
  }

  async getEngineSetting<T = unknown>(key: string): Promise<T | null> {
    const row = this.db
      .query<{ value_json: string }, [string]>(
        "SELECT value_json FROM engine_settings WHERE key = ?",
      )
      .get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return null;
    }
  }

  async setEngineSetting(key: string, value: unknown): Promise<void> {
    this.db
      .query(
        `INSERT INTO engine_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), Date.now());
  }

  async deleteEngineSetting(key: string): Promise<void> {
    this.db.query("DELETE FROM engine_settings WHERE key = ?").run(key);
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<void> {
    const current = await this.getRun(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    const next: Run = { ...current, ...patch, id };
    this.db
      .query(
        `UPDATE runs SET status = ?, output_json = ?, output_validation_json = ?, error = ?,
                          cost_usd = ?, token_input = ?, token_output = ?, tool_calls = ?,
                          blueprint_version = ?, blueprint_hash = ?,
                          started_at = ?, finished_at = ?, environment_snapshot_json = ?
                    WHERE id = ?`,
      )
      .run(
        next.status,
        next.output ? JSON.stringify(next.output) : null,
        next.outputValidation ? JSON.stringify(next.outputValidation) : null,
        next.error ?? null,
        next.costUsd ?? null,
        next.tokenInput,
        next.tokenOutput,
        next.toolCalls,
        next.blueprintVersion ?? null,
        next.blueprintHash ?? "",
        next.startedAt ?? null,
        next.finishedAt ?? null,
        next.environmentSnapshot ? JSON.stringify(next.environmentSnapshot) : null,
        id,
      );
  }
}

interface DeploymentRow {
  id: string;
  name: string;
  blueprint_id: string;
  blueprint_tag: string;
  triggers_json: string;
  channels_json: string;
  limits_json: string;
  status: string;
  model_override: string | null;
  default_input_json: string | null;
  model_role_overrides_json: string | null;
  environment_id: string | null;
  environment_inline_json: string | null;
  created_at: number;
  updated_at: number;
}

interface PluginRow {
  slug: string;
  version: string;
  source: string;
  enabled: number;
  manifest_json: string;
  config_json: string | null;
  installed_at: number;
  disabled_at: number | null;
}

interface ProviderCredRow {
  provider_slug: string;
  credential_name: string;
  api_key_secret: string | null;
  options_json: string | null;
  source: string;
  created_at: number;
  updated_at: number;
}

interface EngineRoleRow {
  role: string;
  provider_slug: string;
  model_id: string;
  credential_name: string;
  options_json: string | null;
  source: string;
  updated_at: number;
}

interface ModelCatalogRow {
  provider_slug: string;
  model_id: string;
  data_json: string;
  fetched_at: number;
}

function rowToPlugin(row: PluginRow): PluginRecord {
  return {
    slug: row.slug,
    version: row.version,
    source: row.source as PluginSource,
    enabled: row.enabled === 1,
    manifest: JSON.parse(row.manifest_json) as PluginManifest,
    configJson: row.config_json ?? undefined,
    installedAt: row.installed_at,
    disabledAt: row.disabled_at ?? undefined,
  };
}

function rowToProviderCred(row: ProviderCredRow): ProviderCredentialRecord {
  return {
    providerSlug: row.provider_slug,
    credentialName: row.credential_name,
    apiKeySecret: row.api_key_secret ?? undefined,
    optionsJson: row.options_json ?? undefined,
    source: assertConfigSource(
      row.source,
      `provider_credentials(${row.provider_slug}/${row.credential_name})`,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEngineRole(row: EngineRoleRow): EngineModelRoleRecord {
  return {
    role: row.role,
    providerSlug: row.provider_slug,
    modelId: row.model_id,
    credentialName: row.credential_name,
    optionsJson: row.options_json ?? undefined,
    source: assertConfigSource(row.source, `engine_model_roles(${row.role})`),
    updatedAt: row.updated_at,
  };
}

function assertConfigSource(value: string, where: string): "config" | "dashboard" {
  if (value === "config" || value === "dashboard") return value;
  throw new Error(
    `state-sqlite: invalid source='${value}' in ${where} (expected 'config' or 'dashboard')`,
  );
}

function rowToCatalog(row: ModelCatalogRow): ModelCatalogRecord {
  return {
    providerSlug: row.provider_slug,
    modelId: row.model_id,
    data: JSON.parse(row.data_json) as ModelInfo,
    fetchedAt: row.fetched_at,
  };
}

interface RunRow {
  id: string;
  deployment_id: string;
  blueprint_id: string;
  blueprint_hash: string;
  blueprint_version: string | null;
  triggered_by: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  output_validation_json: string | null;
  error: string | null;
  cost_usd: number | null;
  token_input: number;
  token_output: number;
  tool_calls: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  environment_snapshot_json: string | null;
}

function rowToDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    name: row.name,
    blueprintId: row.blueprint_id as `${string}/${string}`,
    blueprintTag: row.blueprint_tag ?? "latest",
    triggers: JSON.parse(row.triggers_json),
    channels: JSON.parse(row.channels_json),
    limits: JSON.parse(row.limits_json),
    status: row.status as Deployment["status"],
    modelOverride: row.model_override ?? undefined,
    modelRoleOverrides: row.model_role_overrides_json
      ? (JSON.parse(row.model_role_overrides_json) as Deployment["modelRoleOverrides"])
      : undefined,
    defaultInput: row.default_input_json ? JSON.parse(row.default_input_json) : undefined,
    environmentId: row.environment_id ?? undefined,
    environmentInline: row.environment_inline_json
      ? (JSON.parse(row.environment_inline_json) as Deployment["environmentInline"])
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ChannelTemplateRow {
  name: string;
  type: string;
  config_json: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTemplate(row: ChannelTemplateRow): ChannelTemplate {
  return {
    name: row.name,
    type: row.type,
    config: JSON.parse(row.config_json),
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface EnvRow {
  id: string;
  name: string | null;
  description: string | null;
  config_json: string;
  created_at: number;
  updated_at: number;
}

function rowToEnv(row: EnvRow): Environment {
  return {
    id: row.id,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    config: JSON.parse(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ConnectorTokenRow {
  connector_id: string;
  deployment_id: string;
  connector_name: string;
  access_token_encrypted: string | Uint8Array;
  refresh_token_encrypted: string | Uint8Array | null;
  expires_at: number | null;
  refresh_expires_at: number | null;
  token_url: string | null;
  client_id: string | null;
  client_secret_encrypted: string | Uint8Array | null;
  scopes: string | null;
  status: string;
  updated_at: number;
}

function rowToConnectorToken(row: ConnectorTokenRow): ConnectorTokenRecord {
  return {
    connectorId: row.connector_id,
    deploymentId: row.deployment_id,
    connectorName: row.connector_name,
    accessTokenEncrypted: blobToString(row.access_token_encrypted),
    refreshTokenEncrypted: row.refresh_token_encrypted
      ? blobToString(row.refresh_token_encrypted)
      : undefined,
    expiresAt: row.expires_at ?? undefined,
    refreshExpiresAt: row.refresh_expires_at ?? undefined,
    tokenUrl: row.token_url ?? undefined,
    clientId: row.client_id ?? undefined,
    clientSecretEncrypted: row.client_secret_encrypted
      ? blobToString(row.client_secret_encrypted)
      : undefined,
    scopes: row.scopes ?? undefined,
    status: row.status as ConnectorTokenRecord["status"],
    updatedAt: row.updated_at,
  };
}

function blobToString(v: string | Uint8Array | Buffer): string {
  if (typeof v === "string") return v;
  return Buffer.from(v).toString("utf8");
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    blueprintId: row.blueprint_id as `${string}/${string}`,
    blueprintVersion: row.blueprint_version ?? undefined,
    blueprintHash: row.blueprint_hash || undefined,
    triggeredBy: row.triggered_by as Run["triggeredBy"],
    status: row.status as Run["status"],
    input: row.input_json ? JSON.parse(row.input_json) : undefined,
    output: row.output_json ? JSON.parse(row.output_json) : undefined,
    outputValidation: row.output_validation_json
      ? JSON.parse(row.output_validation_json)
      : undefined,
    error: row.error ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    tokenInput: row.token_input,
    tokenOutput: row.token_output,
    toolCalls: row.tool_calls,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
    environmentSnapshot: row.environment_snapshot_json
      ? (JSON.parse(row.environment_snapshot_json) as Run["environmentSnapshot"])
      : undefined,
  };
}
