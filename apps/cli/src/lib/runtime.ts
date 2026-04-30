import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { AuthLocalProvider } from "@oddjob/auth-local";
import type {
  ChannelProvider,
  EngineModelRoleRecord,
  LegacyResolver,
  ProviderCredentialRecord,
  ResolvedRoleModel,
  SecretsProvider,
} from "@oddjob/core";
import { loadLocalPlugins, PluginRegistry, registerBundled, RoleResolver } from "@oddjob/core";
import type { EngineConfig } from "@oddjob/agent";
import { LlmPiProvider } from "@oddjob/llm-pi";

import piModelsPlugin from "@oddjob/plugin-pi-models";
import llamaLocalPlugin from "@oddjob/plugin-llama-local";
import channelsCorePlugin from "@oddjob/plugin-channels-core";
import toolsWebFetchPlugin from "@oddjob/plugin-tools-web-fetch";
import toolsWebSearchPlugin from "@oddjob/plugin-tools-web-search";
import envProcessPlugin from "@oddjob/plugin-env-process";
import envLocalStrictPlugin from "@oddjob/plugin-env-local-strict";
import envDockerPlugin from "@oddjob/plugin-env-docker";
import envDaytonaPlugin from "@oddjob/plugin-env-daytona";
import { LoggingSqliteProvider } from "@oddjob/logging-sqlite";
import { McpClientProvider } from "@oddjob/mcp-client";
import { QueueSqliteProvider } from "@oddjob/queue-sqlite";
import { SchedulerCronerProvider } from "@oddjob/scheduler-croner";
import { loadOrCreateMasterKey, SecretsSqliteProvider } from "@oddjob/secrets-sqlite";
import type { Runtime } from "@oddjob/server";
import { StateSqliteProvider } from "@oddjob/state-sqlite";

import {
  LOGS_DB,
  type OddjobConfig,
  ODDJOB_HOME,
  QUEUE_DB,
  SECRETS_DB,
  STATE_DB,
  loadConfig,
  saveConfig,
} from "./config.ts";
import { reconcileConfigToDb } from "./config-reconcile.ts";
import { persistConfigFromDb } from "./config-serialize.ts";

export async function buildRuntime(cfg: OddjobConfig): Promise<Runtime> {
  await mkdir(`${ODDJOB_HOME}/state`, { recursive: true });

  const masterKey = await loadOrCreateMasterKey();

  const state = new StateSqliteProvider({ path: STATE_DB });
  const queue = new QueueSqliteProvider({ path: QUEUE_DB });
  const secrets = new SecretsSqliteProvider({ path: SECRETS_DB, masterKey });
  const log = new LoggingSqliteProvider({ path: LOGS_DB });
  await Promise.all([state.connect(), queue.connect(), secrets.connect(), log.connect()]);

  const llm = new LlmPiProvider({ secrets });
  const mcp = new McpClientProvider();
  const auth = new AuthLocalProvider({ state, secrets, masterKey });
  const scheduler = new SchedulerCronerProvider();
  await scheduler.connect();

  const engine = await buildEngineConfig(cfg, secrets);

  // Plugin registry: bundled providers + channels compiled into the binary,
  // plus any local plugins under ~/.oddjob/plugins/.
  const plugins = new PluginRegistry();
  const disabledSlugs = new Set<string>(cfg.plugins?.disabled ?? []);
  for (const p of [
    piModelsPlugin,
    llamaLocalPlugin,
    channelsCorePlugin,
    toolsWebFetchPlugin,
    toolsWebSearchPlugin,
    envProcessPlugin,
    envLocalStrictPlugin,
    envDockerPlugin,
    envDaytonaPlugin,
  ]) {
    const reg = registerBundled(plugins, p);
    if (disabledSlugs.has(reg.record.slug)) plugins.setEnabled(reg.record.slug, false);
    await state.upsertPlugin(reg.record);
  }
  // Cached channel providers — channelFor instantiates lazily then caches.
  // The registry already filters disabled plugins out of channelFor lookups.
  const channelCache = new Map<string, ChannelProvider>();
  const channelFor = (type: string): ChannelProvider | undefined =>
    resolveChannel(plugins, type, secrets, channelCache);
  const localResults = await loadLocalPlugins(plugins, {
    root: join(ODDJOB_HOME, "plugins"),
    disabled: disabledSlugs,
    onError: (slug, err) => {
      console.warn(`[oddjob] failed to load plugin '${slug}': ${err.message}`);
    },
  });
  for (const r of localResults) {
    if (r.ok && r.record) {
      if (disabledSlugs.has(r.record.slug)) plugins.setEnabled(r.record.slug, false);
      await state.upsertPlugin(r.record);
    }
  }

  // TOML is the source of truth for [providers.*.*] and [roles.*]. Reconcile
  // upserts those rows with source='config' and deletes config-sourced rows
  // that no longer appear in the TOML. Dashboard-sourced rows are untouched.
  await reconcileConfigToDb(state, cfg);

  // Snapshot engine roles + provider credentials. Refreshed via reloadRoles().
  let engineRoleSnapshot = await loadEngineRoles(state);
  let credentialSnapshot = await loadProviderCredentials(state);
  const legacyResolver: LegacyResolver = {
    async resolve(modelString, secretRef): Promise<ResolvedRoleModel> {
      const resolved = await llm.resolveModel(modelString, secretRef);
      return { model: resolved.model, apiKey: resolved.apiKey };
    },
  };
  const roleResolver = new RoleResolver({
    registry: plugins,
    secrets,
    engineRoles: () => engineRoleSnapshot,
    credentials: () => credentialSnapshot,
    legacy: legacyResolver,
  });

  const runtime: Runtime = {
    state,
    queue,
    secrets,
    log,
    llm,
    mcp,
    auth,
    scheduler,
    channelFor,
    bearerToken: cfg.server.bearer_token,
    engine,
    plugins,
    roleResolver,
    reloadRoles: async () => {
      engineRoleSnapshot = await loadEngineRoles(state);
      credentialSnapshot = await loadProviderCredentials(state);
    },
    persistConfig: async () => {
      await persistConfigFromDb(state);
    },
    reloadConfig: async () => {
      const fresh = await loadConfig();
      await reconcileConfigToDb(state, fresh);
      engineRoleSnapshot = await loadEngineRoles(state);
      credentialSnapshot = await loadProviderCredentials(state);
      // Rebuild EngineConfig (builtin_tools may have changed), apply
      // [plugins].disabled to the in-process registry, and drop the channel
      // cache so a re-enabled channel-type rebuilds with current secrets.
      runtime.engine = await buildEngineConfig(fresh, secrets);
      const nowDisabled = new Set<string>(fresh.plugins?.disabled ?? []);
      for (const reg of plugins.list()) {
        const shouldEnable = !nowDisabled.has(reg.record.slug);
        if (reg.record.enabled !== shouldEnable) {
          plugins.setEnabled(reg.record.slug, shouldEnable);
          await state.setPluginEnabled(reg.record.slug, shouldEnable);
        }
      }
      channelCache.clear();
    },
    persistEngine: async (next) => {
      const fresh = await loadConfig();
      const bt = next?.builtinTools;
      fresh.builtin_tools = bt
        ? {
            web_search: bt.webSearch
              ? {
                  plugin: bt.webSearch.plugin,
                  api_key: bt.webSearch.apiKey,
                  base_url: bt.webSearch.baseUrl,
                  max_results: bt.webSearch.maxResults,
                }
              : undefined,
            web_fetch: bt.webFetch
              ? {
                  max_body_mb: bt.webFetch.maxBodyMb,
                  private_ips_allowed: bt.webFetch.privateIpsAllowed,
                  allowlist: bt.webFetch.allowlist,
                  blocklist: bt.webFetch.blocklist,
                }
              : undefined,
          }
        : undefined;
      await saveConfig(fresh);
    },
    config: {
      host: cfg.server.host,
      port: cfg.server.port,
      maxWorkers: cfg.server.max_workers,
      leaseMs: 60_000,
      heartbeatMs: 15_000,
      pollMs: 1000,
    },
  };
  return runtime;
}

async function buildEngineConfig(
  cfg: OddjobConfig,
  secrets: SecretsSqliteProvider,
): Promise<EngineConfig | undefined> {
  const bt = cfg.builtin_tools;
  if (!bt) return undefined;
  const out: EngineConfig = { builtinTools: {} };
  if (bt.web_search) {
    const apiKey =
      (bt.web_search.api_key_secret
        ? await secrets.get(bt.web_search.api_key_secret)
        : undefined) ?? bt.web_search.api_key;
    out.builtinTools!.webSearch = {
      plugin: bt.web_search.plugin ?? bt.web_search.provider,
      apiKey,
      baseUrl: bt.web_search.base_url,
      maxResults: bt.web_search.max_results,
    };
  }
  if (bt.web_fetch) {
    out.builtinTools!.webFetch = {
      plugin: bt.web_fetch.plugin ?? "raw",
      apiKey: bt.web_fetch.api_key_secret
        ? ((await secrets.get(bt.web_fetch.api_key_secret)) ?? undefined)
        : bt.web_fetch.api_key,
      maxBodyMb: bt.web_fetch.max_body_mb,
      privateIpsAllowed: bt.web_fetch.private_ips_allowed,
      allowlist: bt.web_fetch.allowlist,
      blocklist: bt.web_fetch.blocklist,
      renderJs: bt.web_fetch.render_js,
    };
  }
  return out;
}

function resolveChannel(
  registry: PluginRegistry,
  type: string,
  secrets: SecretsProvider,
  cache: Map<string, ChannelProvider>,
): ChannelProvider | undefined {
  const cached = cache.get(type);
  if (cached) return cached;
  const svc = registry.channelFor(type);
  if (!svc) return undefined;
  const built = svc.create({ secrets });
  cache.set(type, built);
  return built;
}

async function loadEngineRoles(
  state: StateSqliteProvider,
): Promise<ReadonlyMap<string, EngineModelRoleRecord>> {
  const rows = await state.listEngineModelRoles();
  return new Map(rows.map((r) => [r.role, r]));
}

async function loadProviderCredentials(
  state: StateSqliteProvider,
): Promise<ReadonlyMap<string, ReadonlyMap<string, ProviderCredentialRecord>>> {
  const rows = await state.listProviderCredentials();
  const out = new Map<string, Map<string, ProviderCredentialRecord>>();
  for (const r of rows) {
    let inner = out.get(r.providerSlug);
    if (!inner) {
      inner = new Map();
      out.set(r.providerSlug, inner);
    }
    inner.set(r.credentialName, r);
  }
  return out;
}

/**
 * Resolve the effective default-environment service id. Mirrors the worker's
 * cascade for the no-deployment-override case: engine setting > "default" row
 * > "process" fallback. Used by the CLI to surface a sandbox-warning banner.
 */
export async function resolveDefaultEnvServiceId(rt: Runtime): Promise<string> {
  const engineDefaultId =
    (await rt.state.getEngineSetting<string>("default_environment_id")) ?? "default";
  const env = await rt.state.getEnvironment(engineDefaultId);
  return env?.config.provider?.service ?? "process";
}

export async function warnIfBareProcessEnv(rt: Runtime): Promise<void> {
  const serviceId = await resolveDefaultEnvServiceId(rt);
  if (serviceId !== "process") return;
  const banner = [
    "",
    "\x1b[33;1m⚠  Running with `process` environment — NO sandbox isolation.\x1b[0m",
    "\x1b[33;1m   Trusted-local blueprints only. Untrusted code can read/write your\x1b[0m",
    "\x1b[33;1m   host filesystem and network. To sandbox: `oddjob env set-default\x1b[0m",
    "\x1b[33;1m   local-strict` (macOS seatbelt / Linux bwrap) or `... docker`.\x1b[0m",
    "",
    "",
  ].join("\n");
  process.stderr.write(banner);
}

export async function shutdownRuntime(rt: Runtime): Promise<void> {
  await rt.scheduler?.disconnect();
  await Promise.all([
    rt.state.disconnect(),
    rt.queue.disconnect(),
    rt.secrets.disconnect(),
    rt.log.disconnect(),
  ]);
}
