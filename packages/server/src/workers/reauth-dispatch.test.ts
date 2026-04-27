import { describe, expect, test } from "bun:test";

import type {
  ChannelMessage,
  ChannelProvider,
  Deployment,
  LogEntry,
  LogProvider,
} from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import { WorkerPool } from "./pool.ts";

interface FakeChannel extends ChannelProvider {
  sent: ChannelMessage[];
}
function makeChannel(name = "console"): FakeChannel {
  const sent: ChannelMessage[] = [];
  return {
    name,
    sent,
    async connect() {},
    async disconnect() {},
    async healthy() {
      return true;
    },
    async send(msg: ChannelMessage) {
      sent.push(msg);
    },
  };
}

function makeFakeRuntime(opts: { deployment: Deployment | null; channel: ChannelProvider }): {
  rt: Runtime;
  logs: LogEntry[];
} {
  const logs: LogEntry[] = [];
  const log: LogProvider = {
    name: "fake-log",
    async connect() {},
    async disconnect() {},
    async healthy() {
      return true;
    },
    async log(_runId: string, entry: LogEntry) {
      logs.push(entry);
    },
    async logs() {
      return [];
    },
    async tail() {
      return [];
    },
  } as unknown as LogProvider;
  const state = {
    async getDeployment(id: string) {
      return opts.deployment && opts.deployment.id === id ? opts.deployment : null;
    },
  };
  const rt = {
    state,
    log,
    channelFor: (type: string) =>
      opts.channel.name.includes(type) || type === "console" ? opts.channel : undefined,
    config: {
      host: "127.0.0.1",
      port: 0,
      maxWorkers: 1,
      leaseMs: 1000,
      heartbeatMs: 1000,
      pollMs: 100,
    },
  } as unknown as Runtime;
  return { rt, logs };
}

const dep: Deployment = {
  id: "dep-1",
  name: "demo-deployment",
  blueprintId: "demo/x",
  blueprintTag: "latest",
  triggers: [],
  channels: [{ type: "console", mode: "static" }],
  limits: { tokens: 0, durationMs: 0, costUsd: 0, toolCalls: 0 } as unknown as Deployment["limits"],
  status: "active" as Deployment["status"],
  createdAt: 0,
  updatedAt: 0,
};

describe("WorkerPool.dispatchReauthNotification", () => {
  test("sends reauth message via each configured channel with kind=reauth_needed meta", async () => {
    const channel = makeChannel("console");
    const { rt } = makeFakeRuntime({ deployment: dep, channel });
    const pool = new WorkerPool({ runtime: rt });
    await pool.dispatchReauthNotification("dep-1:gmail", "run-A");
    expect(channel.sent.length).toBe(1);
    const msg = channel.sent[0]!;
    expect(msg.format).toBe("markdown");
    expect(msg.body).toContain("requires re-authentication");
    expect(msg.body).toContain("gmail");
    expect(msg.body).toContain("demo-deployment");
    const meta = msg.meta as Record<string, unknown>;
    expect(meta.kind).toBe("reauth_needed");
    expect(meta.connectorId).toBe("dep-1:gmail");
    expect(meta.connectorName).toBe("gmail");
    expect(meta.deploymentId).toBe("dep-1");
    expect(meta.deploymentName).toBe("demo-deployment");
  });

  test("throttles repeat notifications within window", async () => {
    const channel = makeChannel("console");
    const { rt, logs } = makeFakeRuntime({ deployment: dep, channel });
    const pool = new WorkerPool({ runtime: rt });
    await pool.dispatchReauthNotification("dep-1:gmail", "run-A");
    await pool.dispatchReauthNotification("dep-1:gmail", "run-B");
    expect(channel.sent.length).toBe(1);
    expect(logs.some((e) => /throttled/.test(e.message))).toBe(true);
  });

  test("logs warning when deployment can't be resolved (no channel dispatch)", async () => {
    const channel = makeChannel("console");
    const { rt, logs } = makeFakeRuntime({ deployment: null, channel });
    const pool = new WorkerPool({ runtime: rt });
    await pool.dispatchReauthNotification("missing:gmail", "run-A");
    expect(channel.sent.length).toBe(0);
    expect(logs.some((e) => /deployment not found/.test(e.message))).toBe(true);
  });
});
