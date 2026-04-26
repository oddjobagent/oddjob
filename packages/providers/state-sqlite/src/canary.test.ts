import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Blueprint } from "@oddjob/core";

import { StateSqliteProvider } from "./provider.ts";

let dir: string;
let p: StateSqliteProvider;

const fixture: Blueprint = {
  id: "demo/echo",
  name: "echo",
  namespace: "demo",
  version: "0.1.0",
  schemaVersion: 1,
  description: "test",
  author: "demo",
  tags: [],
  license: "MIT",
  model: "openrouter/x",
  prompt: "echo",
  tools: [],
  skills: [],
  connectors: {},
  scripts: {},
  memory: { store: "kv", retention: "30d" },
  secrets: {},
  path: "/tmp/blueprint.toml",
  contentHash: "a".repeat(64),
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-state-"));
  p = new StateSqliteProvider({ path: join(dir, "oddjob.db") });
  await p.connect();
});

afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("StateSqliteProvider", () => {
  test("healthy after connect", async () => {
    expect(await p.healthy()).toBe(true);
  });

  test("blueprint round trip", async () => {
    await p.upsertBlueprint(fixture);
    const got = await p.getBlueprint("demo/echo");
    expect(got?.id).toBe("demo/echo");
    expect(got?.contentHash).toBe(fixture.contentHash);
    const list = await p.listBlueprints();
    expect(list.length).toBe(1);
  });

  test("deployment create / fetch / list / update", async () => {
    const dep = await p.createDeployment({
      name: "echo-prod",
      blueprintId: "demo/echo",
      triggers: [{ type: "manual" }],
      channels: [{ type: "console" }],
      limits: { warnThresholdPct: 90 },
    });
    expect(dep.status).toBe("active");
    expect(dep.limits.warnThresholdPct).toBe(90);
    const fetched = await p.getDeploymentByName("echo-prod");
    expect(fetched?.id).toBe(dep.id);
    const updated = await p.updateDeployment(dep.id, { status: "paused" });
    expect(updated.status).toBe("paused");
  });

  test("kv set / get / delete with ttl", async () => {
    await p.setKv("ns", "k", { hello: "world" });
    expect(await p.getKv("ns", "k")).toEqual({ hello: "world" });
    await p.setKv("ns", "expiring", "v", -1000);
    expect(await p.getKv("ns", "expiring")).toBeNull();
    await p.deleteKv("ns", "k");
    expect(await p.getKv("ns", "k")).toBeNull();
  });

  test("listRuns filter", async () => {
    const dep = await p.createDeployment({
      name: "x",
      blueprintId: "demo/echo",
      triggers: [{ type: "manual" }],
      channels: [],
    });
    await p.createRun({
      id: "run-1",
      deploymentId: dep.id,
      blueprintId: "demo/echo",
      triggeredBy: "manual",
      status: "complete",
      tokenInput: 10,
      tokenOutput: 20,
      toolCalls: 0,
      createdAt: Date.now(),
    });
    const rows = await p.listRuns({ deploymentId: dep.id });
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("complete");
  });
});
