// Regression: replay must FAIL LOUD when the recorded result was
// truncated (codex round-16 #1). Previously the replay path silently
// JSON.parsed the sentinel envelope and returned it as the actual
// result, corrupting downstream logic for any ctx.* call > the cap.

import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { RunEventSqliteProvider } from "@oddjob/state-sqlite";

import { withRunEvent, makeSeqCursor } from "./run-events.ts";

let dir: string;
let provider: RunEventSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-run-events-trunc-"));
  provider = new RunEventSqliteProvider({ path: join(dir, "events.db") });
  await provider.connect();
});

afterAll(async () => {
  await provider.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("withRunEvent + truncation", () => {
  test("results <= 64KB round-trip exactly through replay", async () => {
    const runId = "trunc-small";
    const cursor = makeSeqCursor();
    const small: Record<string, string> = { bytes: "a".repeat(8 * 1024) };
    const recorded = await withRunEvent<Record<string, string>>(
      provider,
      {
        runId,
        seq: cursor.next(),
        callSite: "ctx.fork:test",
        callType: "fork",
        args: { x: 1 },
      },
      async () => small,
    );
    expect(recorded).toEqual(small);

    const replay = makeSeqCursor();
    const replayed = await withRunEvent<Record<string, string>>(
      provider,
      {
        runId,
        seq: replay.next(),
        callSite: "ctx.fork:test",
        callType: "fork",
        args: { x: 1 },
      },
      async () => ({ should: "not-run" }),
    );
    expect(replayed).toEqual(small);
  });

  test("results > 64KB record a truncation sentinel + replay THROWS loud", async () => {
    const runId = "trunc-large";
    const cursor = makeSeqCursor();
    const huge: Record<string, string> = { blob: "x".repeat(80 * 1024) };
    const recorded = await withRunEvent<Record<string, string>>(
      provider,
      {
        runId,
        seq: cursor.next(),
        callSite: "ctx.tool:test",
        callType: "tool",
        args: { tool: "huge" },
      },
      async () => huge,
    );
    expect(recorded).toEqual(huge);

    const replay = makeSeqCursor();
    await expect(
      withRunEvent<Record<string, string>>(
        provider,
        {
          runId,
          seq: replay.next(),
          callSite: "ctx.tool:test",
          callType: "tool",
          args: { tool: "huge" },
        },
        async () => ({ should: "not-run" }),
      ),
    ).rejects.toThrow(/truncated.*Re-record/);
  });
});
