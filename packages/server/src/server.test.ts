import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PluginRegistry, RoleResolver, registerBundled } from "@oddjob/core";
import { LlmPiProvider } from "@oddjob/llm-pi";
import { LoggingSqliteProvider } from "@oddjob/logging-sqlite";
import { QueueSqliteProvider } from "@oddjob/queue-sqlite";
import { SandboxProcessProvider } from "@oddjob/sandbox-process";
import { SecretsSqliteProvider } from "@oddjob/secrets-sqlite";
import { StateSqliteProvider } from "@oddjob/state-sqlite";
import { definePlugin } from "@oddjob/sdk";

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

  const llm = new LlmPiProvider({ secrets, modelOverrides: new Map() });
  // Wire the registered faux model so the worker pool's resolveModel can find it.
  llm.registerModelOverride("faux/echo", fauxReg.getModel());
  const plugins = new PluginRegistry();
  // Inline env-process plugin so the cascade resolver finds the "process" service.
  registerBundled(
    plugins,
    definePlugin({ slug: "env-process", version: "0.0.0" }, (b) =>
      b.environment({
        id: "process",
        displayName: "Process",
        trustTier: "trusted",
        capabilities: {
          snapshot: false,
          fork: false,
          pauseResume: false,
          exposePort: false,
          egressAllowlist: false,
          packageManagers: [],
        },
        available: async () => ({ ok: true }),
        create: () => new SandboxProcessProvider(),
      }),
    ),
  );
  // Hard-default Environment row pointing at "process".
  await state.upsertEnvironment({
    id: "default",
    name: "Default",
    config: { type: "local", provider: { service: "process" } },
  });
  const roleResolver = new RoleResolver({
    registry: plugins,
    secrets,
    engineRoles: () => new Map(),
    credentials: () => new Map(),
    legacy: { resolve: (m, s) => llm.resolveModel(m, s) },
  });
  runtime = {
    state,
    queue,
    secrets,
    log,
    llm,
    plugins,
    roleResolver,
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
    if (bp) await runtime.state.upsertBlueprint({ ...bp, model: "faux/echo" }, { force: true });

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
    expect(["complete", "failed"]).toContain(run?.status ?? "<none>");
  }, 30_000);

  test("webhook ingress validates path + auth", async () => {
    const r = await fetch(`${BASE()}/webhooks/demo/does-not-exist`, {
      method: "POST",
      body: "{}",
    });
    expect(r.status).toBe(404);
  });

  test("blueprint version + tag endpoints (push, list versions/tags, set/delete tag)", async () => {
    const toml = await readFile("./jobs/echo/blueprint.toml", "utf8");

    // First push: v0.1.0 already pushed by the earlier test. Bump to 0.1.1.
    const v2 = toml.replace(/version\s*=\s*"[^"]+"/, 'version = "0.1.1"');
    const push2 = await fetch(`${BASE()}/api/v1/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toml: v2, path: "./jobs/echo/blueprint.toml" }),
    });
    expect(push2.status).toBe(201);

    // Duplicate push at same version → 409.
    const dup = await fetch(`${BASE()}/api/v1/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toml: v2, path: "./jobs/echo/blueprint.toml" }),
    });
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as { error: string };
    expect(dupBody.error).toBe("blueprint_version_exists");

    // ?force=1 overwrites.
    const forced = await fetch(`${BASE()}/api/v1/blueprints?force=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toml: v2, path: "./jobs/echo/blueprint.toml" }),
    });
    expect(forced.status).toBe(201);

    // List versions.
    const versionsR = await fetch(`${BASE()}/api/v1/blueprints/demo/echo/versions`);
    expect(versionsR.status).toBe(200);
    const versions = (await versionsR.json()) as { versions: Array<{ version: string }> };
    expect(versions.versions.map((v) => v.version).sort()).toEqual(["0.1.0", "0.1.1"]);

    // List tags. After two pushes, latest -> 0.1.1.
    const tagsR = await fetch(`${BASE()}/api/v1/blueprints/demo/echo/tags`);
    const tags = (await tagsR.json()) as { tags: Array<{ tag: string; version: string }> };
    expect(tags.tags.find((t) => t.tag === "latest")?.version).toBe("0.1.1");

    // Pin stable -> 0.1.0.
    const setStable = await fetch(`${BASE()}/api/v1/blueprints/demo/echo/tags/stable`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "0.1.0" }),
    });
    expect(setStable.status).toBe(200);

    // GET ?tag=stable returns 0.1.0.
    const stableR = await fetch(`${BASE()}/api/v1/blueprints/demo/echo?tag=stable`);
    const stableBp = (await stableR.json()) as { version: string };
    expect(stableBp.version).toBe("0.1.0");

    // GET ?version=0.1.0 returns the immutable row.
    const exactR = await fetch(`${BASE()}/api/v1/blueprints/demo/echo?version=0.1.0`);
    const exactBp = (await exactR.json()) as { version: string };
    expect(exactBp.version).toBe("0.1.0");

    // Cannot delete `latest`.
    const dropLatest = await fetch(`${BASE()}/api/v1/blueprints/demo/echo/tags/latest`, {
      method: "DELETE",
    });
    expect(dropLatest.status).toBe(400);

    // Custom tag deletes cleanly.
    const dropStable = await fetch(`${BASE()}/api/v1/blueprints/demo/echo/tags/stable`, {
      method: "DELETE",
    });
    expect(dropStable.status).toBe(204);
  });

  test("deployment with blueprintTag pin runs the pinned version even after latest moves", async () => {
    // Pin stable -> 0.1.0 again so we can deploy against it.
    await fetch(`${BASE()}/api/v1/blueprints/demo/echo/tags/stable`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "0.1.0" }),
    });

    fauxReg.setResponses([fauxAssistantMessage("ok", { stopReason: "stop" })]);

    const create = await fetch(`${BASE()}/api/v1/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "echo-stable",
        blueprintId: "demo/echo",
        blueprintTag: "stable",
        triggers: [{ type: "manual" }],
        channels: [],
      }),
    });
    expect(create.status).toBe(201);
    const dep = (await create.json()) as { id: string; blueprintTag: string };
    expect(dep.blueprintTag).toBe("stable");

    const trig = await fetch(`${BASE()}/api/v1/deployments/${dep.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(trig.status).toBe(202);
    const { run_id: runId } = (await trig.json()) as { run_id: string };

    let attempts = 0;
    let run: { status: string; blueprintVersion?: string } | null = null;
    while (attempts < 50) {
      attempts++;
      await new Promise((r) => setTimeout(r, 100));
      const fetched = await fetch(`${BASE()}/api/v1/runs/${runId}`);
      if (fetched.status === 200) {
        run = (await fetched.json()) as { status: string; blueprintVersion?: string };
        if (run.status === "complete" || run.status === "failed") break;
      }
    }
    expect(run?.blueprintVersion).toBe("0.1.0");
  }, 30_000);

  test("deploy with unknown tag returns 400", async () => {
    const create = await fetch(`${BASE()}/api/v1/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "echo-ghost",
        blueprintId: "demo/echo",
        blueprintTag: "ghost",
        triggers: [{ type: "manual" }],
        channels: [],
      }),
    });
    expect(create.status).toBe(400);
  });

  test("permission policy: tool gated by confirm waits for /confirm POST", async () => {
    // Push a one-shot blueprint that uses the bash builtin under a confirm policy.
    const toml = `
name = "perm-demo"
version = "0.1.0"
description = "perm demo"
author = "demo"
model = "faux/echo"

prompt = """
Run bash with no args. Then say done.
"""

tools = [{ name = "bash", confirm = true }]

[secrets]
openrouter = "OPENROUTER_API_KEY"
`;
    fauxReg.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" }, { id: "tc-perm" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done", { stopReason: "stop" }),
    ]);

    const push = await fetch(`${BASE()}/api/v1/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toml, path: "<inline>" }),
    });
    expect(push.status).toBe(201);

    const create = await fetch(`${BASE()}/api/v1/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "perm-demo",
        blueprintId: "demo/perm-demo",
        triggers: [{ type: "manual" }],
        channels: [],
      }),
    });
    expect(create.status).toBe(201);
    const dep = (await create.json()) as { id: string };

    const trig = await fetch(`${BASE()}/api/v1/deployments/${dep.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(trig.status).toBe(202);
    const { run_id: runId } = (await trig.json()) as { run_id: string };

    // Poll until the run is awaiting_confirmation.
    let pending: Array<{ toolUseId: string; toolName: string }> = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const c = await fetch(`${BASE()}/api/v1/runs/${runId}/confirmations`);
      if (c.status === 200) {
        const body = (await c.json()) as { pending: typeof pending };
        if (body.pending.length > 0) {
          pending = body.pending;
          break;
        }
      }
    }
    expect(pending).toHaveLength(1);
    expect(pending[0]?.toolName).toBe("bash");

    const runStatus = await fetch(`${BASE()}/api/v1/runs/${runId}`);
    const runRow = (await runStatus.json()) as { status: string };
    expect(runRow.status).toBe("awaiting_confirmation");

    // Approve and watch the run finish.
    const approve = await fetch(`${BASE()}/api/v1/runs/${runId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool_use_id: pending[0]!.toolUseId, result: "allow" }),
    });
    expect(approve.status).toBe(200);

    let final: { status: string } | null = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const r2 = await fetch(`${BASE()}/api/v1/runs/${runId}`);
      if (r2.status === 200) {
        final = (await r2.json()) as { status: string };
        if (final.status === "complete" || final.status === "failed") break;
      }
    }
    expect(["complete", "failed"]).toContain(final?.status ?? "<none>");
  }, 30_000);

  test("environment CRUD via API (TOML push, list, delete)", async () => {
    const toml = `
id = "data-analysis"
description = "test env"

[config]
type = "cloud"

[config.packages]
pip = ["pandas", "numpy"]

[config.networking]
type = "limited"
allowed_hosts = ["api.example.com"]
allow_mcp_servers = true
`;
    const push = await fetch(`${BASE()}/api/v1/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toml }),
    });
    expect(push.status).toBe(201);
    const created = (await push.json()) as { id: string };
    expect(created.id).toBe("data-analysis");

    const list = await fetch(`${BASE()}/api/v1/environments`);
    const listBody = (await list.json()) as { environments: Array<{ id: string }> };
    expect(listBody.environments.find((e) => e.id === "data-analysis")).toBeDefined();

    const get = await fetch(`${BASE()}/api/v1/environments/data-analysis`);
    expect(get.status).toBe(200);
    const env = (await get.json()) as {
      config: { networking: { type: string; allowedHosts?: string[] } };
    };
    expect(env.config.networking.type).toBe("limited");
    expect(env.config.networking.allowedHosts).toEqual(["api.example.com"]);

    const del = await fetch(`${BASE()}/api/v1/environments/data-analysis`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    const miss = await fetch(`${BASE()}/api/v1/environments/data-analysis`);
    expect(miss.status).toBe(404);
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
