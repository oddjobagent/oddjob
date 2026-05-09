// Phase 3.2 — task tool unit tests. The tool itself is light: the
// heavy work is the child runOnce (lazy-loaded). Here we verify the
// guard rails (depth, concurrency, budget, tool-subset filter, error
// shapes) without spinning up a real agent.

import { describe, expect, test } from "bun:test";

import type { Blueprint, EnvironmentSession } from "@oddjob/core";

import type { ResolvedLLM, ResolvedEnvironmentForRun } from "../loop.ts";
import { makeSeqCursor } from "../run-events.ts";

import {
  createTaskTool,
  MAX_CONCURRENT_CHILDREN,
  MAX_SUBAGENT_DEPTH,
  type TaskParentContext,
} from "./task.ts";

const fakeLlm: ResolvedLLM = {
  model: { id: "stub", provider: "anthropic" } as ResolvedLLM["model"],
  apiKey: "sk-test",
};
const fakeBlueprint = {
  id: "test/parent",
  prompt: "do stuff",
  tools: ["bash", "read", "task"],
} as unknown as Blueprint;
const fakeSession = {
  sessionWorkdir: "/tmp/parent",
  exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  writeFile: async () => undefined,
  readFile: async () => "",
  kill: async () => undefined,
} as unknown as EnvironmentSession;
const fakeEnv: ResolvedEnvironmentForRun = {
  provider: { name: "fake", connect: async () => {}, disconnect: async () => {}, healthy: async () => true, spawn: async () => fakeSession },
  config: { type: "local", workingDir: "/tmp/parent", networking: { type: "unrestricted" } },
};

function makeParent(overrides: Partial<TaskParentContext> = {}): TaskParentContext {
  return {
    parentRunId: "run_parent",
    parentBlueprint: fakeBlueprint,
    parentLlmFn: () => fakeLlm,
    parentEnvironment: fakeEnv,
    parentSession: fakeSession,
    parentTotalCostFn: () => 0,
    parentDepth: 0,
    taskConcurrencyTracker: new Map(),
    rootRunId: "run_parent",
    parentSeqCursor: makeSeqCursor(0),
    currentParentStepIdFn: () => undefined,
    onChildResult: () => {},
    ...overrides,
  };
}

describe("task tool — guard rails", () => {
  test("rejects when parent depth >= MAX_SUBAGENT_DEPTH", async () => {
    const parent = makeParent({ parentDepth: MAX_SUBAGENT_DEPTH });
    const tool = createTaskTool(parent);
    const out = await tool.execute("call_1", { prompt: "hi" }, undefined);
    expect(out.details).toMatchObject({ error: expect.stringContaining("max sub-agent depth") });
  });

  test("rejects when concurrency tracker is at cap", async () => {
    const tracker = new Map<string, number>();
    tracker.set("run_parent", MAX_CONCURRENT_CHILDREN);
    const parent = makeParent({ taskConcurrencyTracker: tracker });
    const tool = createTaskTool(parent);
    const out = await tool.execute("call_1", { prompt: "hi" }, undefined);
    expect(out.details).toMatchObject({
      error: expect.stringContaining(`concurrent children limit (${MAX_CONCURRENT_CHILDREN})`),
    });
  });

  test("rejects when remaining budget is exhausted", async () => {
    const parent = makeParent({
      parentBudgetUsd: 0.5,
      parentTotalCostFn: () => 0.5, // already spent
    });
    const tool = createTaskTool(parent);
    const out = await tool.execute("call_1", { prompt: "hi" }, undefined);
    expect(out.details).toMatchObject({ error: expect.stringContaining("exhausted") });
  });

  test("rejects when tools_subset reduces to empty (only 'task' available)", async () => {
    const onlyTaskBlueprint = {
      ...fakeBlueprint,
      tools: ["task"],
    } as unknown as Blueprint;
    const parent = makeParent({ parentBlueprint: onlyTaskBlueprint });
    const tool = createTaskTool(parent);
    const out = await tool.execute("call_1", { prompt: "hi" }, undefined);
    expect(out.details).toMatchObject({
      error: expect.stringContaining("must have at least one tool"),
    });
  });

  test("rejects when explicit tools_subset filters to empty", async () => {
    const parent = makeParent();
    const tool = createTaskTool(parent);
    const out = await tool.execute("call_1", { prompt: "hi", tools_subset: ["nonexistent"] }, undefined);
    expect(out.details).toMatchObject({
      error: expect.stringContaining("must have at least one tool"),
    });
  });

  test("describes itself with depth/concurrency caps", () => {
    const tool = createTaskTool(makeParent());
    expect(tool.description).toContain(`depth ≤ ${MAX_SUBAGENT_DEPTH}`);
    expect(tool.description).toContain(`children ≤ ${MAX_CONCURRENT_CHILDREN}`);
  });

  test("typebox parameters include prompt, tools_subset, max_tokens", () => {
    const tool = createTaskTool(makeParent());
    const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect(props.prompt).toBeDefined();
    expect(props.tools_subset).toBeDefined();
    expect(props.max_tokens).toBeDefined();
  });
});
