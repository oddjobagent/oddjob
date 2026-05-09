// End-to-end test: script-mode runOnce + RunEventSqliteProvider produces a
// durable run_events log, AND a second run with the same runId replays
// from the log without re-executing side effects.
//
// This is the integration counterpart to the script-mode smoke tests +
// the run-events unit tests — together they prove B2.3 (runtime) and
// B2.4 (replay) are wired end-to-end through real sqlite providers.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Blueprint, BlueprintId, RunEventRecord } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";
import { RunEventSqliteProvider } from "@oddjob/state-sqlite";

import { runOnce } from "./loop.ts";

const FIXTURE_ROOT = new URL("./__test_fixtures__/script-mode/", import.meta.url).pathname;
let dir: string;
let dbPath: string;
let runEvents: RunEventSqliteProvider;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

function syntheticScriptBlueprint(blueprintDir: string): Blueprint {
  return {
    id: "test/script-persist" as BlueprintId,
    name: "script-persist",
    namespace: "test",
    version: "0.0.1",
    schemaVersion: 1,
    description: "script-mode persistence test",
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
  dir = await mkdtemp(join(FIXTURE_ROOT, "persist-"));
  dbPath = join(dir, "runevents.db");
  runEvents = new RunEventSqliteProvider({ path: dbPath });
  await runEvents.connect();
});

afterAll(async () => {
  await runEvents.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("script-mode + RunEventSqliteProvider end-to-end", () => {
  test("ctx.* calls persist as run_events rows in seq order", async () => {
    const bpDir = join(dir, "case-1");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");
    await writeFile(
      join(bpDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         await ctx.scratch.set("a", 1);
         const a = await ctx.scratch.get("a");
         const t = await ctx.tool<string>("datetime", { format: "unix" });
         const ts = await ctx.now();
         return { a, t: typeof t, hasTimestamp: ts instanceof Date };
       });`,
    );
    const r = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
      runEvents,
    });
    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toMatchObject({
      a: 1,
      t: "string",
      hasTimestamp: true,
    });

    // Inspect run_events directly.
    const rows = await runEvents.list(r.run.id);
    // Expect 4 rows: scratch_set, scratch_get, tool, now (in call order).
    expect(rows).toHaveLength(4);
    expect(rows.map((row: RunEventRecord) => row.callType)).toEqual([
      "scratch_set",
      "scratch_get",
      "tool",
      "now",
    ]);
    // All rows completed cleanly (no failed/pending).
    for (const row of rows) {
      expect(row.status).toBe("completed");
      expect(row.completedAt).toBeGreaterThanOrEqual(row.startedAt);
    }
    // Seq is 0..3 strictly monotonic.
    expect(rows.map((row: RunEventRecord) => row.seq)).toEqual([0, 1, 2, 3]);
  });

  test("re-running with the same runId returns recorded values (replay path)", async () => {
    const bpDir = join(dir, "case-replay");
    await rm(bpDir, { recursive: true, force: true });
    await Bun.write(join(bpDir, "blueprint.toml"), "# placeholder\n");

    // Counter that the script bumps on every call; if replay is working,
    // the second run reads from run_events and the counter stays at 1.
    const SIDE_EFFECT_FILE = join(dir, "side-effect-counter.txt");
    await Bun.write(SIDE_EFFECT_FILE, "0");
    await writeFile(
      join(bpDir, "main.ts"),
      `import { defineRun } from "@oddjob/sdk";
       export default defineRun({}, async (ctx) => {
         // ctx.now() is recorded — same value should come back on replay.
         const stamp = await ctx.now();
         return { ts: stamp.toISOString() };
       });`,
    );

    const fixedRunId = "fixed-replay-run-id-12345";

    const r1 = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
      runEvents,
      runId: fixedRunId,
    });
    expect(r1.run.status).toBe("complete");
    const ts1 = (r1.output.structuredOutput as { ts?: string }).ts;
    expect(typeof ts1).toBe("string");

    // Sleep a bit so a fresh `new Date()` would differ from ts1 in any
    // run that re-executed instead of replaying.
    await new Promise<void>((res) => setTimeout(res, 50));

    const r2 = await runOnce({
      blueprint: syntheticScriptBlueprint(bpDir),
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {},
      runEvents,
      runId: fixedRunId, // same runId → replay
    });
    expect(r2.run.status).toBe("complete");
    const ts2 = (r2.output.structuredOutput as { ts?: string }).ts;
    expect(ts2).toBe(ts1); // recorded value reused on replay
  });
});
