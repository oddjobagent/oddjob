// Smoke test for script-mode runtime (B2.3): build a minimal script
// blueprint on disk, point runOnce at it, verify the user's run function
// executed and structured output landed in result.output.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Blueprint, BlueprintId } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { runOnce } from "./loop.ts";

// Fixtures live inside the workspace so the user-script's `import {defineRun}
// from "@oddjob/sdk"` resolves via packages/agent/node_modules/@oddjob/sdk.
// /tmp dirs don't have node_modules visible — Bun walks up looking for it.
const FIXTURE_ROOT = new URL("./__test_fixtures__/script-mode/", import.meta.url).pathname;
let dir: string;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

function syntheticScriptBlueprint(blueprintDir: string): Blueprint {
  return {
    id: "test/script-mode-smoke" as BlueprintId,
    name: "script-mode-smoke",
    namespace: "test",
    version: "0.0.1",
    schemaVersion: 1,
    description: "minimal script-mode blueprint for smoke testing",
    author: "test",
    tags: [],
    license: "MIT",
    // Blueprint TS interface requires prompt; in script mode the parser
    // allows it absent but the runtime accepts a placeholder.
    prompt: "(script-mode placeholder; ctx.runAgent provides any prompts)",
    tools: [],
    skills: [],
    connectors: {},
    scripts: {},
    memory: { store: "kv", retention: "0" },
    secrets: {},
    failOnToolError: false,
    scriptMode: true,
    entry: { runtime: "bun", file: "main.ts" },
    path: join(blueprintDir, "blueprint.toml"),
    contentHash: "synthetic",
  };
}

beforeAll(async () => {
  await Bun.write(join(FIXTURE_ROOT, ".keep"), "");
  dir = await mkdtemp(join(FIXTURE_ROOT, "run-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("script-mode runtime", () => {
  test("invokes the run function and returns structured output", async () => {
    const bpDir = join(dir, "smoke-1");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(bpDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         return { greeting: "hello", inputEcho: ctx.inputs };
       });`,
    );
    const r = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never }, // unused in script-mode
      environment: testEnv,
      input: { who: "world" },
    });
    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toEqual({
      greeting: "hello",
      inputEcho: { who: "world" },
    });
  });

  test("rejects a main.ts whose default export is not a RunDefinition", async () => {
    const bpDir = join(dir, "smoke-bad-export");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(bpDir, "main.ts"),
      `export default { something: "not a RunDefinition" };`,
    );
    const r = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
    });
    expect(r.run.status).toBe("failed");
    expect(r.run.error).toContain("RunDefinition");
  });

  test("ctx.scratch.set then ctx.scratch.get round-trips within a run", async () => {
    const bpDir = join(dir, "smoke-scratch");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(bpDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         await ctx.scratch.set("k", { v: 1 });
         const got = await ctx.scratch.get("k");
         return { roundtrip: got };
       });`,
    );
    const r = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
    });
    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toEqual({ roundtrip: { v: 1 } });
  });

  test("ctx.tool('datetime') executes through the internal-tool dispatch", async () => {
    const bpDir = join(dir, "smoke-tool");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(bpDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         const t = await ctx.tool<string>("datetime", { format: "iso" });
         return { hadDatetime: typeof t === "string" && t.length > 0 };
       });`,
    );
    const r = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
    });
    expect(r.run.status).toBe("complete");
    expect((r.output.structuredOutput as { hadDatetime?: boolean }).hadDatetime).toBe(true);
  });

  test("Promise.all([ctx.scratch.set, ctx.scratch.set]) errors on concurrent dispatch", async () => {
    const bpDir = join(dir, "smoke-concurrent");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(bpDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         await Promise.all([
           ctx.scratch.set("a", 1),
           ctx.scratch.set("b", 2),
         ]);
         return { ok: true };
       });`,
    );
    const r = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
    });
    expect(r.run.status).toBe("failed");
    expect(r.run.error).toMatch(/concurrent ctx.\* calls are forbidden/);
  });
});
