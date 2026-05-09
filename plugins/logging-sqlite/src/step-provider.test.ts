import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StepRecord } from "@oddjob/core";

import { StepSqliteProvider } from "./step-provider.ts";

describe("StepSqliteProvider", () => {
  let dir: string;
  let provider: StepSqliteProvider;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "step-test-"));
    provider = new StepSqliteProvider({ path: join(dir, "steps.db") });
    await provider.connect();
  });

  afterEach(async () => {
    await provider.disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it("records and retrieves a tool_call step with usage", async () => {
    const step: StepRecord = {
      stepId: "step-1",
      runId: "run-a",
      iteration: 1,
      kind: "tool_call",
      startedAt: 1000,
      endedAt: 1042,
      toolName: "bash",
      toolArgsHash: "deadbeef",
      toolResultSize: 256,
    };
    await provider.recordStep(step);
    const rows = await provider.getSteps("run-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toolName).toBe("bash");
    expect(rows[0]?.endedAt).toBe(1042);
  });

  it("upserts on duplicate step_id (open then close pattern)", async () => {
    await provider.recordStep({
      stepId: "step-2",
      runId: "run-a",
      iteration: 0,
      kind: "llm_call",
      startedAt: 1000,
    });
    await provider.recordStep({
      stepId: "step-2",
      runId: "run-a",
      iteration: 0,
      kind: "llm_call",
      startedAt: 1000,
      endedAt: 1100,
      tokensIn: 500,
      tokensOut: 80,
      cacheRead: 400,
      costUsd: 0.001,
      model: "claude-sonnet-4.6",
    });
    const rows = await provider.getSteps("run-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokensIn).toBe(500);
    expect(rows[0]?.cacheRead).toBe(400);
    expect(rows[0]?.endedAt).toBe(1100);
  });

  it("filters by kind", async () => {
    await provider.recordStep({
      stepId: "s-llm",
      runId: "run-a",
      iteration: 0,
      kind: "llm_call",
      startedAt: 1000,
    });
    await provider.recordStep({
      stepId: "s-tool",
      runId: "run-a",
      iteration: 0,
      kind: "tool_call",
      startedAt: 1010,
    });
    const llm = await provider.getSteps("run-a", { kind: "llm_call" });
    expect(llm).toHaveLength(1);
    expect(llm[0]?.kind).toBe("llm_call");
  });

  it("scopes by runId", async () => {
    await provider.recordStep({
      stepId: "a-1",
      runId: "run-a",
      iteration: 0,
      kind: "verdict",
      startedAt: 1000,
    });
    await provider.recordStep({
      stepId: "b-1",
      runId: "run-b",
      iteration: 0,
      kind: "verdict",
      startedAt: 1000,
    });
    const a = await provider.getSteps("run-a");
    const b = await provider.getSteps("run-b");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.stepId).toBe("a-1");
  });

  it("redacts secrets in meta", async () => {
    await provider.recordStep({
      stepId: "s-meta",
      runId: "run-a",
      iteration: 0,
      kind: "tool_call",
      startedAt: 1000,
      meta: { token: "sk-ant-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    });
    const rows = await provider.getSteps("run-a");
    const tok = (rows[0]?.meta as { token?: string } | undefined)?.token ?? "";
    expect(tok).not.toContain("sk-ant-deadbeef");
  });
});
