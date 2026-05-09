// B2.7 demo + crash-resume regression: jobs/digest-pipeline exercises
// ctx.fork in a 7-node tree (1 root + 3 fetcher + 3 summarizer + joiner =
// 7 fork events). This test runs it end-to-end + verifies that a second
// run with the same runId replays from run_events instead of re-executing.
//
// This is the canonical demo of B2.3 (script-mode runtime) + B2.4 (replay
// engine) + cost rollup (B2.5) working together.

import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadBlueprint, type RunEventRecord } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";
import { RunEventSqliteProvider } from "@oddjob/state-sqlite";

import { runOnce } from "./loop.ts";

const PIPELINE_DIR = resolve(import.meta.dir, "../../../jobs/digest-pipeline");
let dir: string;
let runEvents: RunEventSqliteProvider;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-digest-"));
  runEvents = new RunEventSqliteProvider({ path: join(dir, "events.db") });
  await runEvents.connect();
});

afterAll(async () => {
  await runEvents.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("jobs/digest-pipeline (B2.7 exemplar)", () => {
  test("end-to-end: parent forks 3 fetchers + 3 summarizers + joiner; output is a markdown digest", async () => {
    const bp = await loadBlueprint(PIPELINE_DIR);
    const r = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {
        topic: "Test Digest",
        urls: ["https://a.test", "https://b.test", "https://c.test"],
      },
      runEvents,
    });
    if (r.run.status !== "complete") {
      console.error("digest-pipeline run error:", r.run.error);
    }
    expect(r.run.status).toBe("complete");
    const out = r.output.structuredOutput as
      | { topic: string; digest: string; partial_summaries: string[] }
      | undefined;
    expect(out).toBeDefined();
    expect(out!.topic).toBe("Test Digest");
    expect(out!.partial_summaries).toHaveLength(3);
    // Digest is a markdown doc with one section per source.
    expect(out!.digest).toContain("# Test Digest");
    expect(out!.digest).toContain("## Source 1");
    expect(out!.digest).toContain("## Source 3");

    // run_events has 7 fork rows: 3 fetcher + 3 summarizer + 1 joiner
    // (the parent's perspective). Each fetcher/summarizer/joiner is a
    // separate child run with its own run_events sequence.
    const events = await runEvents.list(r.run.id);
    const forks = events.filter((e: RunEventRecord) => e.callType === "fork");
    expect(forks).toHaveLength(7);
    // Every fork landed completed and got a child_run_id.
    for (const f of forks) {
      expect(f.status).toBe("completed");
      expect(f.childRunId).toBeDefined();
    }
  });

  test("replay: re-running with the same runId returns recorded values without re-executing children", async () => {
    const bp = await loadBlueprint(PIPELINE_DIR);
    const fixedRunId = "digest-replay-run-id";
    const r1 = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {
        topic: "Replay Digest",
        urls: ["https://x.test", "https://y.test", "https://z.test"],
      },
      runId: fixedRunId,
      runEvents,
    });
    expect(r1.run.status).toBe("complete");
    const out1 = r1.output.structuredOutput as
      | { digest: string; partial_summaries: string[] }
      | undefined;
    expect(out1).toBeDefined();
    const digest1 = out1!.digest;

    // Wait so any fresh ctx.now would produce a different timestamp.
    await new Promise<void>((res) => setTimeout(res, 25));

    // Same runId → replay path. Returns recorded ctx.fork results without
    // re-running the children. Output stays identical.
    const r2 = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      input: {
        topic: "Replay Digest",
        urls: ["https://x.test", "https://y.test", "https://z.test"],
      },
      runId: fixedRunId,
      runEvents,
    });
    expect(r2.run.status).toBe("complete");
    const out2 = r2.output.structuredOutput as { digest: string } | undefined;
    expect(out2).toBeDefined();
    // Digest is identical because all child results are replayed from
    // run_events, which means the recorded ctx.now in the fetcher's
    // child run produces the same ISO timestamp on replay.
    expect(out2!.digest).toBe(digest1);
  });
});
