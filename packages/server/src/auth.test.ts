import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PluginRegistry, RoleResolver } from "@oddjob/core";
import { LlmPiProvider } from "@oddjob/llm-pi";
import { LoggingSqliteProvider } from "@oddjob/logging-sqlite";
import { QueueSqliteProvider } from "@oddjob/queue-sqlite";
import { SandboxProcessProvider } from "@oddjob/sandbox-process";
import { SecretsSqliteProvider } from "@oddjob/secrets-sqlite";
import { StateSqliteProvider } from "@oddjob/state-sqlite";

import { startServer } from "./server.ts";
import type { Runtime } from "./runtime.ts";

let dir: string;

async function makeRuntime(host: string, port: number, bearerToken?: string): Promise<Runtime> {
  const masterKey = Buffer.from("0".repeat(64), "hex");
  const state = new StateSqliteProvider({ path: join(dir, `s-${port}.db`) });
  const queue = new QueueSqliteProvider({ path: join(dir, `q-${port}.db`) });
  const secrets = new SecretsSqliteProvider({ path: join(dir, `sec-${port}.db`), masterKey });
  const log = new LoggingSqliteProvider({ path: join(dir, `l-${port}.db`) });
  await Promise.all([state.connect(), queue.connect(), secrets.connect(), log.connect()]);
  const plugins = new PluginRegistry();
  const llm = new LlmPiProvider({ secrets });
  const roleResolver = new RoleResolver({
    registry: plugins,
    secrets,
    engineRoles: () => new Map(),
    credentials: () => new Map(),
    legacy: { resolve: (m, s) => llm.resolveModel(m, s) },
  });
  return {
    state,
    queue,
    secrets,
    log,
    sandbox: new SandboxProcessProvider(),
    llm,
    plugins,
    roleResolver,
    channelFor: () => undefined,
    bearerToken,
    config: { host, port, maxWorkers: 1, leaseMs: 30_000, heartbeatMs: 5_000, pollMs: 200 },
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-auth-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("server auth", () => {
  test("refuses to start on non-loopback without a bearer token", async () => {
    const rt = await makeRuntime("0.0.0.0", 7771);
    await expect(startServer({ runtime: rt })).rejects.toThrow(/bearer token/);
    await Promise.all([rt.state, rt.queue, rt.secrets, rt.log].map((p) => p.disconnect()));
  });

  test("starts on non-loopback when token configured", async () => {
    const rt = await makeRuntime("127.0.0.1", 7772, "secret-tok");
    const server = await startServer({ runtime: rt });
    const resp = await fetch(`${server.url}/api/v1/health`);
    expect(resp.status).toBe(401);
    const ok = await fetch(`${server.url}/api/v1/health`, {
      headers: { authorization: "Bearer secret-tok" },
    });
    expect(ok.status).toBe(200);
    await server.stop();
    await Promise.all([rt.state, rt.queue, rt.secrets, rt.log].map((p) => p.disconnect()));
  });

  test("loopback bind without token is open (current default)", async () => {
    const rt = await makeRuntime("127.0.0.1", 7773);
    const server = await startServer({ runtime: rt });
    const resp = await fetch(`${server.url}/api/v1/health`);
    expect(resp.status).toBe(200);
    await server.stop();
    await Promise.all([rt.state, rt.queue, rt.secrets, rt.log].map((p) => p.disconnect()));
  });
});
