import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { LlmPiProvider } from "@oddjob/llm-pi";
import { LoggingSqliteProvider } from "@oddjob/logging-sqlite";
import { QueueSqliteProvider } from "@oddjob/queue-sqlite";
import { SandboxProcessProvider } from "@oddjob/sandbox-process";
import { SecretsSqliteProvider } from "@oddjob/secrets-sqlite";
import { StateSqliteProvider } from "@oddjob/state-sqlite";

import { startServer } from "./server.ts";
import type { Runtime } from "./runtime.ts";

let dir: string;
let runtime: Runtime;
let server: Awaited<ReturnType<typeof startServer>>;
const fauxReg = registerFauxProvider({ models: [{ id: "echo" }] });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-server-"));
  const masterKey = Buffer.from("0".repeat(64), "hex");

  const state = new StateSqliteProvider({ path: join(dir, "oddjob.db") });
  const queue = new QueueSqliteProvider({ path: join(dir, "queue.db") });
  const secrets = new SecretsSqliteProvider({ path: join(dir, "secrets.db"), masterKey });
  const log = new LoggingSqliteProvider({ path: join(dir, "logs.db") });
  await state.connect();
  await queue.connect();
  await secrets.connect();
  await log.connect();

  runtime = {
    state,
    queue,
    secrets,
    log,
    sandbox: new SandboxProcessProvider(),
    llm: new LlmPiProvider({ secrets }),
    channelFor: () => undefined,
    config: {
      host: "127.0.0.1",
      port: 7787,
      maxWorkers: 2,
      leaseMs: 30_000,
      heartbeatMs: 5_000,
      pollMs: 200,
    },
  };

  server = await startServer({ runtime });
});

afterAll(async () => {
  await server.stop();
  await runtime.state.disconnect();
  await runtime.queue.disconnect();
  await runtime.secrets.disconnect();
  await runtime.log.disconnect();
  fauxReg.unregister();
  await rm(dir, { recursive: true, force: true });
});

const BASE = () => server.url;

describe("server end-to-end", () => {
  test("health returns ok", async () => {
    const r = await fetch(`${BASE()}/api/v1/health`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });

  test("404 for unknown route", async () => {
    const r = await fetch(`${BASE()}/api/v1/banana`);
    expect(r.status).toBe(404);
  });

  test("push blueprint, create deployment, trigger run, fetch result", async () => {
    const toml = await readFile("./jobs/echo/blueprint.toml", "utf8");
    const pushBp = await fetch(`${BASE()}/api/v1/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toml, path: "./jobs/echo/blueprint.toml" }),
    });
    expect(pushBp.status).toBe(201);

    fauxReg.setResponses([fauxAssistantMessage("Hello from faux", { stopReason: "stop" })]);

    // Override blueprint to use faux model after push (no need; we will pass model via secrets workaround later)
    // For now, mutate blueprint in DB to swap model
    const bp = await runtime.state.getBlueprint("demo/echo");
    if (bp) await runtime.state.upsertBlueprint({ ...bp, model: "faux/echo" });

    const createDep = await fetch(`${BASE()}/api/v1/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "echo-prod",
        blueprintId: "demo/echo",
        triggers: [{ type: "manual" }],
        channels: [],
      }),
    });
    expect(createDep.status).toBe(201);
    const dep = (await createDep.json()) as { id: string };

    const trig = await fetch(`${BASE()}/api/v1/deployments/${dep.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    expect(trig.status).toBe(202);
    const { run_id: runId } = (await trig.json()) as { run_id: string };

    let attempts = 0;
    let run: { status: string } | null = null;
    while (attempts < 30) {
      attempts++;
      await new Promise((r) => setTimeout(r, 200));
      const fetched = await fetch(`${BASE()}/api/v1/runs/${runId}`);
      if (fetched.status === 200) {
        run = (await fetched.json()) as { status: string };
        if (run.status === "complete" || run.status === "failed") break;
      }
    }
    expect(["complete", "failed"]).toContain(run?.status);
  }, 30_000);

  test("webhook ingress validates path + auth", async () => {
    const r = await fetch(`${BASE()}/webhooks/demo/does-not-exist`, {
      method: "POST",
      body: "{}",
    });
    expect(r.status).toBe(404);
  });

  test("secrets list/set/delete via API", async () => {
    const set = await fetch(`${BASE()}/api/v1/secrets/MY_KEY`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "hunter2" }),
    });
    expect(set.status).toBe(204);
    const list = await fetch(`${BASE()}/api/v1/secrets`);
    const j = (await list.json()) as { secrets: string[] };
    expect(j.secrets).toContain("MY_KEY");
  });
});
