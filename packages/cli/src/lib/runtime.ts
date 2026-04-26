import { mkdir } from "node:fs/promises";

import { ChannelConsoleProvider } from "@oddjob/channel-console";
import { ChannelEmailProvider } from "@oddjob/channel-email";
import { ChannelSlackProvider } from "@oddjob/channel-slack";
import { ChannelWebhookProvider } from "@oddjob/channel-webhook";
import type { ChannelProvider } from "@oddjob/core";
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
  const scheduler = new SchedulerCronerProvider();
  await scheduler.connect();

  const channels: Record<string, ChannelProvider> = {
    console: new ChannelConsoleProvider(),
    slack: new ChannelSlackProvider({ secrets }),
    email: new ChannelEmailProvider({ secrets }),
    webhook: new ChannelWebhookProvider({ secrets }),
  };

  const runtime: Runtime = {
    state,
    queue,
    secrets,
    log,
    sandbox,
    llm,
    mcp,
    scheduler,
    channelFor: (type) => channels[type],
    bearerToken: cfg.server.bearer_token,
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

export async function shutdownRuntime(rt: Runtime): Promise<void> {
  await rt.scheduler?.disconnect();
  await Promise.all([
    rt.state.disconnect(),
    rt.queue.disconnect(),
    rt.secrets.disconnect(),
    rt.log.disconnect(),
  ]);
}
