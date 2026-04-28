import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { ModelInfo } from "@oddjob/core";

import { StateSqliteProvider } from "./provider.ts";

let dir: string;
let p: StateSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-plugins-state-"));
  p = new StateSqliteProvider({ path: join(dir, "state.db") });
  await p.connect();
});

afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});

const sampleModel = (id: string): ModelInfo => ({
  id,
  displayName: id,
  contextWindow: 1000,
  maxOutput: 100,
  inputCostPerMillion: 1,
  outputCostPerMillion: 2,
  supports: { tools: true, streaming: true, vision: false, reasoning: false },
});

describe("state-sqlite plugin tables", () => {
  test("upsertPlugin then list", async () => {
    await p.upsertPlugin({
      slug: "openai",
      version: "0.1.0",
      source: "bundled",
      enabled: true,
      manifest: {
        slug: "openai",
        name: "OpenAI",
        description: "x",
        version: "0.1.0",
        oddjob: { engine: "*" },
      },
      installedAt: 1,
    });
    const list = await p.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe("openai");
    expect(list[0]?.manifest.name).toBe("OpenAI");
  });

  test("setPluginEnabled toggles + stamps disabled_at", async () => {
    await p.setPluginEnabled("openai", false);
    const r = await p.getPlugin("openai");
    expect(r?.enabled).toBe(false);
    expect(r?.disabledAt).toBeGreaterThan(0);
    await p.setPluginEnabled("openai", true);
    const r2 = await p.getPlugin("openai");
    expect(r2?.enabled).toBe(true);
    expect(r2?.disabledAt).toBeUndefined();
  });

  test("upsertProviderCredential roundtrip", async () => {
    await p.upsertProviderCredential({
      providerSlug: "openai",
      credentialName: "default",
      apiKeySecret: "OPENAI_API_KEY",
      optionsJson: JSON.stringify({ baseUrl: "https://api.openai.com/v1" }),
      source: "config",
      createdAt: 1,
      updatedAt: 1,
    });
    const row = await p.getProviderCredential("openai", "default");
    expect(row?.apiKeySecret).toBe("OPENAI_API_KEY");
    const list = await p.listProviderCredentials("openai");
    expect(list).toHaveLength(1);
  });

  test("upsertEngineModelRole roundtrip", async () => {
    await p.upsertEngineModelRole({
      role: "default",
      providerSlug: "openai",
      modelId: "gpt-4o",
      credentialName: "default",
      source: "config",
      updatedAt: 5,
    });
    const r = await p.getEngineModelRole("default");
    expect(r?.providerSlug).toBe("openai");
    expect(r?.modelId).toBe("gpt-4o");
    const all = await p.listEngineModelRoles();
    expect(all).toHaveLength(1);
  });

  test("model catalog upsert + list + delete by provider", async () => {
    await p.upsertModelCatalogEntry({
      providerSlug: "openai",
      modelId: "gpt-4o",
      data: sampleModel("gpt-4o"),
      fetchedAt: 10,
    });
    await p.upsertModelCatalogEntry({
      providerSlug: "openai",
      modelId: "gpt-4o-mini",
      data: sampleModel("gpt-4o-mini"),
      fetchedAt: 10,
    });
    let list = await p.listModelCatalog("openai");
    expect(list).toHaveLength(2);
    await p.deleteModelCatalogEntries("openai");
    list = await p.listModelCatalog("openai");
    expect(list).toHaveLength(0);
  });
});
