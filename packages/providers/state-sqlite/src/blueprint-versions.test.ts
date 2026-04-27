import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Blueprint } from "@oddjob/core";
import { BlueprintVersionExistsError } from "@oddjob/core";

import { StateSqliteProvider } from "./provider.ts";

const baseFixture = (version: string, hash: string): Blueprint => ({
  id: "demo/tagged",
  name: "tagged",
  namespace: "demo",
  version,
  schemaVersion: 1,
  description: `tagged@${version}`,
  author: "demo",
  tags: [],
  license: "MIT",
  model: "openrouter/x",
  prompt: "noop",
  tools: [],
  skills: [],
  connectors: {},
  scripts: {},
  memory: { store: "kv", retention: "30d" },
  secrets: {},
  failOnToolError: false,
  path: "/tmp/blueprint.toml",
  contentHash: hash,
  sourceToml: `# version=${version}`,
});

let dir: string;
let p: StateSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-tags-"));
  p = new StateSqliteProvider({ path: join(dir, "oddjob.db") });
  await p.connect();
});

afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("blueprint versioning + tags", () => {
  test("first push creates v0.1.0 and points latest at it", async () => {
    await p.upsertBlueprint(baseFixture("0.1.0", "a".repeat(64)));
    const versions = await p.listBlueprintVersions("demo/tagged");
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe("0.1.0");

    const tags = await p.listBlueprintTags("demo/tagged");
    expect(tags).toEqual([
      expect.objectContaining({ tag: "latest", version: "0.1.0" }),
    ]);

    const bp = await p.getBlueprint("demo/tagged");
    expect(bp?.version).toBe("0.1.0");
    expect(bp?.description).toBe("tagged@0.1.0");
  });

  test("second push moves latest pointer + retains old version", async () => {
    await p.upsertBlueprint(baseFixture("0.1.1", "b".repeat(64)));
    const versions = await p.listBlueprintVersions("demo/tagged");
    expect(versions.map((v) => v.version).sort()).toEqual(["0.1.0", "0.1.1"]);

    const latest = await p.getBlueprint("demo/tagged", { tag: "latest" });
    expect(latest?.version).toBe("0.1.1");

    const old = await p.getBlueprint("demo/tagged", { version: "0.1.0" });
    expect(old?.version).toBe("0.1.0");
  });

  test("duplicate (id, version) without force throws BlueprintVersionExistsError", async () => {
    expect(() => p.upsertBlueprint(baseFixture("0.1.1", "c".repeat(64)))).toThrow(
      BlueprintVersionExistsError,
    );
  });

  test("force=true overwrites the existing version row", async () => {
    await p.upsertBlueprint({ ...baseFixture("0.1.1", "d".repeat(64)), description: "rebuilt" }, { force: true });
    const v = await p.getBlueprint("demo/tagged", { version: "0.1.1" });
    expect(v?.description).toBe("rebuilt");
    expect(v?.contentHash).toBe("d".repeat(64));
  });

  test("setBlueprintTag pins a custom tag to a specific version", async () => {
    await p.setBlueprintTag("demo/tagged", "stable", "0.1.0");
    const tags = await p.listBlueprintTags("demo/tagged");
    const stable = tags.find((t) => t.tag === "stable");
    expect(stable?.version).toBe("0.1.0");

    const resolved = await p.getBlueprint("demo/tagged", { tag: "stable" });
    expect(resolved?.version).toBe("0.1.0");
  });

  test("setBlueprintTag rejects unknown version", async () => {
    expect(() => p.setBlueprintTag("demo/tagged", "bad", "9.9.9")).toThrow(/does not exist/);
  });

  test("getBlueprint with unknown tag returns null (no fallback)", async () => {
    const miss = await p.getBlueprint("demo/tagged", { tag: "ghost" });
    expect(miss).toBeNull();
  });

  test("upsertBlueprint with tags=['stable'] moves both latest and stable", async () => {
    await p.upsertBlueprint(baseFixture("0.2.0", "e".repeat(64)), { tags: ["stable"] });
    const tags = await p.listBlueprintTags("demo/tagged");
    expect(tags.find((t) => t.tag === "latest")?.version).toBe("0.2.0");
    expect(tags.find((t) => t.tag === "stable")?.version).toBe("0.2.0");
  });

  test("deleteBlueprintTag removes a custom tag", async () => {
    await p.deleteBlueprintTag("demo/tagged", "stable");
    const tags = await p.listBlueprintTags("demo/tagged");
    expect(tags.find((t) => t.tag === "stable")).toBeUndefined();
  });

  test("deleteBlueprintTag refuses to remove 'latest'", async () => {
    expect(() => p.deleteBlueprintTag("demo/tagged", "latest")).toThrow(/cannot delete/);
  });

  test("deleteBlueprint cascades versions and tags", async () => {
    await p.deleteBlueprint("demo/tagged");
    expect(await p.getBlueprint("demo/tagged")).toBeNull();
    expect(await p.listBlueprintVersions("demo/tagged")).toEqual([]);
    expect(await p.listBlueprintTags("demo/tagged")).toEqual([]);
  });
});
