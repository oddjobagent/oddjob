// End-to-end test: parent script-mode blueprint forks a child, child runs,
// parent gets the child's output. Validates B2.3 ctx.fork in real conditions
// AND that run_events.child_run_id is populated correctly.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Blueprint, BlueprintId, RunEventRecord } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";
import { RunEventSqliteProvider, StateSqliteProvider } from "@oddjob/state-sqlite";

import { runOnce } from "./loop.ts";

const FIXTURE_ROOT = new URL("./__test_fixtures__/script-mode/", import.meta.url).pathname;
let dir: string;
let dbPath: string;
let runEvents: RunEventSqliteProvider;
let state: StateSqliteProvider;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

function bp(name: string, blueprintDir: string): Blueprint {
  return {
    id: `test/${name}` as BlueprintId,
    name,
    namespace: "test",
    version: "0.0.1",
    schemaVersion: 1,
    description: `${name} test`,
    author: "test",
    tags: [],
    license: "MIT",
    prompt: "(script-mode placeholder)",
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
  dir = await mkdtemp(join(FIXTURE_ROOT, "fork-"));
  dbPath = join(dir, "fork.db");
  runEvents = new RunEventSqliteProvider({ path: dbPath });
  state = new StateSqliteProvider({ path: dbPath });
  await runEvents.connect();
  await state.connect();
});

afterAll(async () => {
  await runEvents.disconnect();
  await state.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("ctx.fork end-to-end", () => {
  test("parent forks child; child output flows back; parent_run_id + child_run_id link", async () => {
    // Layout:
    //   <dir>/parent/blueprint.toml + main.ts (forks "../child")
    //   <dir>/child/blueprint.toml + main.ts  (returns inputs.x * 2)
    const parentDir = join(dir, "parent");
    const childDir = join(dir, "child");
    await rm(parentDir, { recursive: true, force: true });
    await rm(childDir, { recursive: true, force: true });
    await Bun.write(join(parentDir, "blueprint.toml"), "# placeholder\n");
    // Child must be a real loadable blueprint — parent forks via
    // loadBlueprint which validates required TOML fields. Auto-detect
    // script-mode happens via the sibling main.ts presence.
    await Bun.write(
      join(childDir, "blueprint.toml"),
      `name = "fork-child"
version = "0.0.1"
description = "fork-child test blueprint"
author = "test"
license = "MIT"
`,
    );
    await writeFile(
      join(parentDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         const inputs = ctx.inputs as { x: number };
         const doubled = await ctx.fork<{ x: number }, { result: number }>(
           "../child",
           { x: inputs.x },
         );
         return { from_parent: inputs.x, from_child: doubled.result };
       });`,
    );
    await writeFile(
      join(childDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         const inputs = ctx.inputs as { x: number };
         return { result: inputs.x * 2 };
       });`,
    );

    // Note on state persistence: ctx.fork attempts to write the child
    // run row via opts.state.createRun, but runs.deployment_id has an FK
    // to deployments — synthesizing a fixture deployment + blueprint
    // would balloon this test. The fork code's persistence call is
    // exercised under test in plugins/state-sqlite/src/run-parent-id.
    // test.ts (focused createRun/getRun roundtrip with parent_run_id).
    // Here we leave state out so the in-memory child run is what we
    // assert against.
    const parentRunId = "fixed-parent-run";
    const r = await runOnce({
      blueprint: bp("fork-parent", parentDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: { x: 7 },
      runId: parentRunId,
      runEvents,
    });

    if (r.run.status !== "complete") {
      console.log("FAIL: parent run error:", r.run.error);
    }
    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toEqual({ from_parent: 7, from_child: 14 });

    // Inspect parent's run_events: should have one fork event whose
    // child_run_id field is populated.
    const parentEvents = await runEvents.list(parentRunId);
    const forkEvents = parentEvents.filter((e: RunEventRecord) => e.callType === "fork");
    expect(forkEvents).toHaveLength(1);
    const childRunId = forkEvents[0]!.childRunId;
    expect(childRunId).toBeDefined();
    expect(typeof childRunId).toBe("string");

    // The child's run_events should also exist (the child's ctx.now,
    // tool, etc. would land here — for this minimal child there are
    // none, but the count is allowed to be 0 for childless children).
    const childEvents = await runEvents.list(childRunId!);
    expect(Array.isArray(childEvents)).toBe(true);

  });

  test("forking a non-existent ref fails the parent run with a clear error", async () => {
    const parentDir = join(dir, "fork-bad-ref");
    await rm(parentDir, { recursive: true, force: true });
    await Bun.write(join(parentDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(parentDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         await ctx.fork("./does-not-exist", {});
         return { ok: true };
       });`,
    );
    const r = await runOnce({
      blueprint: bp("fork-bad", parentDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
      runEvents,
    });
    expect(r.run.status).toBe("failed");
    expect(r.run.error).toMatch(/does-not-exist|Cannot read blueprint|ENOENT/);
  });
});
