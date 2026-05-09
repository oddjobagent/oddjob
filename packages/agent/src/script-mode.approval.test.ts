// COMPOSABLE_BLUEPRINTS Phase 2 — `ctx.requestApproval` integration.
//
// Verifies:
//   - When a RunOnceOptions.onApprovalRequest handler is wired, the
//     script's `await ctx.requestApproval(...)` resolves to whatever
//     the handler returned.
//   - Without a handler, ctx.requestApproval auto-denies (script
//     doesn't hang).
//   - Approval calls are recorded in run_events; replay reuses the
//     recorded resolution without re-paging the handler.

import { rm, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadBlueprint, type RunEventRecord } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";
import { RunEventSqliteProvider } from "@oddjob/state-sqlite";

import { runOnce } from "./loop.ts";
import type { ApprovalRequest } from "./script-mode.ts";

const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

let dir: string;
let runEvents: RunEventSqliteProvider;
const tmpBlueprintDir = resolve(import.meta.dir, "__test_fixtures__/script-mode/approval");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-approval-"));
  runEvents = new RunEventSqliteProvider({ path: join(dir, "events.db") });
  await runEvents.connect();

  // Build a minimal script-mode blueprint that calls ctx.requestApproval
  // and writes the resolution to its output. Runs once; deterministic
  // text output suffices.
  await mkdir(tmpBlueprintDir, { recursive: true });
  await writeFile(
    join(tmpBlueprintDir, "blueprint.toml"),
    `name = "approval-script"
version = "0.1.0"
description = "Test ctx.requestApproval."
author = "test"

[entry]
runtime = "bun"
file = "main.ts"
`,
  );
  await writeFile(
    join(tmpBlueprintDir, "main.ts"),
    `import { defineRun } from "@oddjob/sdk";

interface Output {
  approved: boolean;
  reason: string | null;
  resolver: string | null;
}

export default defineRun<unknown, Output>({}, async (ctx) => {
  const result = await ctx.requestApproval("Approve publishing this draft?", {
    channel: "slack-prod",
  });
  return {
    approved: result.approved,
    reason: result.reason ?? null,
    resolver: result.resolver ?? null,
  };
});
`,
  );
});

afterAll(async () => {
  await runEvents.disconnect();
  await rm(dir, { recursive: true, force: true });
  await rm(tmpBlueprintDir, { recursive: true, force: true });
});

describe("ctx.requestApproval (COMPOSABLE_BLUEPRINTS Phase 2)", () => {
  test("with a handler wired, returns the handler's resolution", async () => {
    let captured: ApprovalRequest | undefined;
    const bp = await loadBlueprint(tmpBlueprintDir, { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      runEvents,
      onApprovalRequest: async (req) => {
        captured = req;
        return { approved: true, reason: "lgtm", resolver: "cli:nik" };
      },
    });

    if (r.run.status !== "complete") console.error("run failed:", r.run.error);
    expect(r.run.status).toBe("complete");
    expect(captured).toBeDefined();
    expect(captured?.prompt).toBe("Approve publishing this draft?");
    expect(captured?.channel).toBe("slack-prod");
    expect(r.output.structuredOutput).toEqual({
      approved: true,
      reason: "lgtm",
      resolver: "cli:nik",
    });

    const events = await runEvents.list(r.run.id);
    const approvalEvent = events.find((e: RunEventRecord) => e.callType === "approval");
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent?.status).toBe("completed");
  });

  test("WITHOUT a handler, requestApproval auto-denies (script does not hang)", async () => {
    const bp = await loadBlueprint(tmpBlueprintDir, { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      runEvents,
      // no onApprovalRequest
    });

    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toMatchObject({
      approved: false,
      reason: expect.stringContaining("no approval handler configured"),
    });
  });

  test("approval handler that hangs forever is unblocked by an aborted signal (codex round-24 HIGH precursor)", async () => {
    // Sanity-check: when an approval handler returns a Promise that
    // never resolves on its own, we expect the run to abort cleanly
    // when its abort signal fires. This mirrors the pool's cancelRun
    // path that resolves pending approvals as system:cancel — without
    // that resolution, the script-mode loop would hang indefinitely.
    const bp = await loadBlueprint(tmpBlueprintDir, { validate: true, checkFs: true });
    let neverResolveResolve: ((v: { approved: boolean; reason: string; resolver: string }) => void) | undefined;
    const neverResolves = new Promise<{ approved: boolean; reason: string; resolver: string }>(
      (res) => {
        neverResolveResolve = res;
      },
    );
    const ac = new AbortController();
    const runP = runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      runEvents,
      signal: ac.signal,
      onApprovalRequest: () => neverResolves,
    });
    // Simulate the pool's cancelRun behavior: resolve the pending
    // approval as cancelled, then abort.
    setTimeout(() => {
      neverResolveResolve?.({ approved: false, reason: "cancelled", resolver: "system:cancel" });
      ac.abort();
    }, 50);
    const r = await runP;
    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toMatchObject({
      approved: false,
      reason: "cancelled",
      resolver: "system:cancel",
    });
  });

  test("replay returns the recorded resolution without re-calling the handler", async () => {
    const fixedRunId = "approval-replay-run-id";
    let handlerCallCount = 0;

    const bp = await loadBlueprint(tmpBlueprintDir, { validate: true, checkFs: true });
    const r1 = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      runId: fixedRunId,
      runEvents,
      onApprovalRequest: async () => {
        handlerCallCount++;
        return { approved: true, reason: "first-time", resolver: "cli" };
      },
    });
    expect(r1.run.status).toBe("complete");
    expect(handlerCallCount).toBe(1);

    // Re-run with same runId. The recorded approval event should
    // serve the result without invoking the handler again.
    const r2 = await runOnce({
      blueprint: bp,
      llm: { model: { id: "stub" } as never },
      environment: testEnv,
      runId: fixedRunId,
      runEvents,
      onApprovalRequest: async () => {
        handlerCallCount++;
        return { approved: false, reason: "should-not-fire", resolver: "x" };
      },
    });
    expect(r2.run.status).toBe("complete");
    expect(handlerCallCount).toBe(1); // handler NOT called again
    expect(r2.output.structuredOutput).toEqual({
      approved: true,
      reason: "first-time",
      resolver: "cli",
    });
  });
});
