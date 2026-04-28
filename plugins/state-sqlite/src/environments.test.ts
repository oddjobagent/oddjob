import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { StateSqliteProvider } from "./provider.ts";

let dir: string;
let p: StateSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-env-"));
  p = new StateSqliteProvider({ path: join(dir, "oddjob.db") });
  await p.connect();
});

afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("environments table", () => {
  test("upsert + get", async () => {
    const env = await p.upsertEnvironment({
      id: "data-analysis",
      description: "pandas + numpy",
      config: {
        type: "cloud",
        packages: { pip: ["pandas", "numpy"] },
        networking: { type: "unrestricted" },
      },
    });
    expect(env.id).toBe("data-analysis");

    const fetched = await p.getEnvironment("data-analysis");
    expect(fetched?.config.packages?.pip).toEqual(["pandas", "numpy"]);
    expect(fetched?.config.networking).toEqual({ type: "unrestricted" });
  });

  test("upsert overrides existing config", async () => {
    await p.upsertEnvironment({
      id: "data-analysis",
      description: "now with sklearn",
      config: {
        type: "cloud",
        packages: { pip: ["pandas", "numpy", "scikit-learn"] },
        networking: { type: "unrestricted" },
      },
    });
    const fetched = await p.getEnvironment("data-analysis");
    expect(fetched?.description).toBe("now with sklearn");
    expect(fetched?.config.packages?.pip).toContain("scikit-learn");
  });

  test("list returns all environments sorted by id", async () => {
    await p.upsertEnvironment({
      id: "alpha",
      config: { type: "local" },
    });
    const list = await p.listEnvironments();
    expect(list.map((e) => e.id)).toEqual(["alpha", "data-analysis"]);
  });

  test("delete removes the row", async () => {
    await p.deleteEnvironment("alpha");
    expect(await p.getEnvironment("alpha")).toBeNull();
  });

  test("Phase 15b: provider/resources/template fields round-trip", async () => {
    await p.upsertEnvironment({
      id: "remote-1",
      config: {
        type: "cloud",
        provider: { service: "daytona", credential: "default" },
        resources: { cpu: 2, memMb: 2048, diskMb: 8192 },
        template: "ubuntu-22.04",
      },
    });
    const fetched = await p.getEnvironment("remote-1");
    expect(fetched?.config.provider?.service).toBe("daytona");
    expect(fetched?.config.provider?.credential).toBe("default");
    expect(fetched?.config.resources?.cpu).toBe(2);
    expect(fetched?.config.resources?.memMb).toBe(2048);
    expect(fetched?.config.template).toBe("ubuntu-22.04");
  });
});

describe("Phase 15b: engine_settings", () => {
  test("get returns null when key missing", async () => {
    expect(await p.getEngineSetting("nonexistent")).toBeNull();
  });

  test("set + get round trip with JSON encoding", async () => {
    await p.setEngineSetting("default_environment_id", "default");
    expect(await p.getEngineSetting<string>("default_environment_id")).toBe("default");
  });

  test("set overwrites existing value", async () => {
    await p.setEngineSetting("default_environment_id", "default");
    await p.setEngineSetting("default_environment_id", "data-analysis");
    expect(await p.getEngineSetting<string>("default_environment_id")).toBe("data-analysis");
  });

  test("delete removes the key", async () => {
    await p.setEngineSetting("default_environment_id", "x");
    await p.deleteEngineSetting("default_environment_id");
    expect(await p.getEngineSetting("default_environment_id")).toBeNull();
  });

  test("supports complex JSON values", async () => {
    const value = { foo: "bar", arr: [1, 2, 3], nested: { ok: true } };
    await p.setEngineSetting("complex", value);
    const back = await p.getEngineSetting<typeof value>("complex");
    expect(back).toEqual(value);
  });
});

describe("Phase 15b: deployments env wiring", () => {
  test("create deployment with environmentId persists round trip", async () => {
    await p.upsertEnvironment({
      id: "for-deploy",
      config: { type: "local", provider: { service: "process" } },
    });
    await p.upsertBlueprint({
      id: "demo/env-wire",
      name: "env-wire",
      namespace: "demo",
      version: "0.0.1",
      schemaVersion: 1,
      description: "x",
      author: "x",
      tags: [],
      model: "faux/x",
      prompt: "x",
      tools: [],
      skills: [],
      connectors: {},
      scripts: {},
      memory: { store: "kv", retention: "30d" },
      secrets: {},
      failOnToolError: false,
      path: "<inline>",
      contentHash: "b".repeat(64),
    } as never);
    const dep = await p.createDeployment({
      name: "env-wire-dep",
      blueprintId: "demo/env-wire",
      triggers: [{ type: "manual" }],
      channels: [],
      environmentId: "for-deploy",
      environmentInline: { image: "override-image" },
    });
    const fetched = await p.getDeployment(dep.id);
    expect(fetched?.environmentId).toBe("for-deploy");
    expect(fetched?.environmentInline?.image).toBe("override-image");
  });
});
