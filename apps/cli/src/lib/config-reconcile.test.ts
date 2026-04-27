import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { StateSqliteProvider } from "@oddjob/state-sqlite";

import type { OddjobConfig } from "./config.ts";
import { reconcileConfigToDb } from "./config-reconcile.ts";

let dir: string;
let state: StateSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-recon-"));
  state = new StateSqliteProvider({ path: join(dir, "state.db") });
  await state.connect();
});

afterAll(async () => {
  await state.disconnect();
  await rm(dir, { recursive: true, force: true });
});

const baseConfig = (): OddjobConfig => ({
  server: { host: "127.0.0.1", port: 7777, max_workers: 3 },
});

describe("reconcileConfigToDb", () => {
  test("upserts providers + roles from TOML with source='config'", async () => {
    const cfg: OddjobConfig = {
      ...baseConfig(),
      providers: {
        openai: {
          default: { api_key_secret: "OPENAI_API_KEY" },
        },
      },
      roles: {
        default: { provider: "openai", model: "gpt-4o" },
      },
    };
    const r = await reconcileConfigToDb(state, cfg);
    expect(r.providersUpserted).toBe(1);
    expect(r.rolesUpserted).toBe(1);
    const cred = await state.getProviderCredential("openai", "default");
    expect(cred?.source).toBe("config");
    expect(cred?.apiKeySecret).toBe("OPENAI_API_KEY");
    const role = await state.getEngineModelRole("default");
    expect(role?.source).toBe("config");
    expect(role?.modelId).toBe("gpt-4o");
  });

  test("removing TOML row deletes config-sourced DB row", async () => {
    const cfg: OddjobConfig = { ...baseConfig() };
    const r = await reconcileConfigToDb(state, cfg);
    expect(r.providersDeleted).toBeGreaterThanOrEqual(1);
    expect(r.rolesDeleted).toBeGreaterThanOrEqual(1);
    expect(await state.getProviderCredential("openai", "default")).toBeNull();
    expect(await state.getEngineModelRole("default")).toBeNull();
  });

  test("dashboard-sourced rows survive TOML reconciliation", async () => {
    await state.upsertProviderCredential({
      providerSlug: "anthropic",
      credentialName: "default",
      apiKeySecret: "ANTHROPIC_API_KEY",
      source: "dashboard",
      createdAt: 1,
      updatedAt: 1,
    });
    const cfg: OddjobConfig = { ...baseConfig() };
    await reconcileConfigToDb(state, cfg);
    const cred = await state.getProviderCredential("anthropic", "default");
    expect(cred?.source).toBe("dashboard");
  });
});
