import { mkdir } from "node:fs/promises";

import { AuthLocalProvider } from "@oddjob/auth-local";
import { ChannelConsoleProvider } from "@oddjob/channel-console";
import { ChannelEmailProvider } from "@oddjob/channel-email";
import { ChannelSlackProvider } from "@oddjob/channel-slack";
import { ChannelWebhookProvider } from "@oddjob/channel-webhook";
import type { ChannelProvider, EngineConfig } from "@oddjob/core";
import { LlmPiProvider } from "@oddjob/llm-pi";
import { LoggingSqliteProvider } from "@oddjob/logging-sqlite";
import { McpClientProvider } from "@oddjob/mcp-client";
import { QueueSqliteProvider } from "@oddjob/queue-sqlite";
import { SandboxProcessProvider } from "@oddjob/sandbox-process";
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

export async function buildRuntime(cfg: OddjobConfig): Promise<Runtime> {
  await mkdir(`${ODDJOB_HOME}/state`, { recursive: true });

  const masterKey = await loadOrCreateMasterKey();

  const state = new StateSqliteProvider({ path: STATE_DB });
  const queue = new QueueSqliteProvider({ path: QUEUE_DB });
  const secrets = new SecretsSqliteProvider({ path: SECRETS_DB, masterKey });
  const log = new LoggingSqliteProvider({ path: LOGS_DB });
  await Promise.all([state.connect(), queue.connect(), secrets.connect(), log.connect()]);

  const sandbox = new SandboxProcessProvider();
  const llm = new LlmPiProvider({ secrets });
  const mcp = new McpClientProvider();
  const auth = new AuthLocalProvider({ state, secrets, masterKey });
  const scheduler = new SchedulerCronerProvider();
  await scheduler.connect();

  const channels: Record<string, ChannelProvider> = {
    console: new ChannelConsoleProvider(),
    slack: new ChannelSlackProvider({ secrets }),
    email: new ChannelEmailProvider({ secrets }),
    webhook: new ChannelWebhookProvider({ secrets }),
  };

  const engine = await buildEngineConfig(cfg, secrets);

  const runtime: Runtime = {
    state,
    queue,
    secrets,
    log,
    sandbox,
    llm,
    mcp,
    auth,
    scheduler,
    channelFor: (type) => channels[type],
    bearerToken: cfg.server.bearer_token,
    engine,
    persistEngine: async (next) => {
      const fresh = await loadConfig();
      const bt = next?.builtinTools;
      fresh.builtin_tools = bt
        ? {
            web_search: bt.webSearch
              ? {
                  provider: bt.webSearch.provider,
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
  if (bt.web_search?.provider) {
    const apiKey =
      (bt.web_search.api_key_secret ? await secrets.get(bt.web_search.api_key_secret) : undefined) ??
      bt.web_search.api_key;
    out.builtinTools!.webSearch = {
      provider: bt.web_search.provider,
      apiKey,
      baseUrl: bt.web_search.base_url,
      maxResults: bt.web_search.max_results,
    };
  }
  if (bt.web_fetch) {
    out.builtinTools!.webFetch = {
      maxBodyMb: bt.web_fetch.max_body_mb,
      privateIpsAllowed: bt.web_fetch.private_ips_allowed,
      allowlist: bt.web_fetch.allowlist,
      blocklist: bt.web_fetch.blocklist,
    };
  }
  return out;
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
