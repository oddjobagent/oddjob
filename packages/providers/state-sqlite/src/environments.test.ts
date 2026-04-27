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
});
