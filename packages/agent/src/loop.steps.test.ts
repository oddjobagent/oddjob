import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadBlueprint } from "@oddjob/core";
import type { StepProvider, StepQuery, StepRecord } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { runOnce } from "./loop.ts";

let dir: string;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-step-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

class CapturingStepProvider implements StepProvider {
  readonly name = "capturing";
  readonly steps: StepRecord[] = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }
  async recordStep(step: StepRecord): Promise<void> {
    this.steps.push(step);
  }
  async getSteps(runId: string, _options?: StepQuery): Promise<StepRecord[]> {
    return this.steps.filter((s) => s.runId === runId);
  }
}

describe("runOnce step trace", () => {
  test("llm_call is a span (open + close share stepId; endedAt > startedAt)", async () => {
    const reg = registerFauxProvider({ models: [{ id: "step-llm" }] });
    reg.setResponses([fauxAssistantMessage("hi back", { stopReason: "stop" })]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const step = new CapturingStepProvider();
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/step-llm" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "hi",
      step,
    });
    expect(r.run.status).toBe("complete");
    const llmSteps = step.steps.filter((s) => s.kind === "llm_call");
    // 1 open + 1 close per LLM call
    expect(llmSteps.length).toBe(2);
    expect(llmSteps[0]?.stepId).toBe(llmSteps[1]?.stepId);
    expect(llmSteps[0]?.endedAt).toBeUndefined();
    expect(llmSteps[1]?.endedAt).toBeGreaterThanOrEqual(llmSteps[1]?.startedAt ?? 0);
    expect(llmSteps[1]?.model).toBe(reg.getModel().id);
    // Usage attached on close from the terminal `done` event
    expect(llmSteps[1]?.tokensIn).toBeGreaterThanOrEqual(0);
    reg.unregister();
  });

  test("tool_call step has matching open + close (same step_id) with hash + size", async () => {
    const reg = registerFauxProvider({ models: [{ id: "step-tool" }] });
    reg.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("count_words", { text: "one two three" }, { id: "tc-step-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/word-count", { validate: true, checkFs: true });
    const step = new CapturingStepProvider();
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/step-tool" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "count me",
      step,
    });
    expect(r.run.status).toBe("complete");
    const toolSteps = step.steps.filter((s) => s.kind === "tool_call");
    // Insert + update share the same stepId; capturing provider keeps both.
    expect(toolSteps.length).toBe(2);
    expect(toolSteps[0]?.stepId).toBe(toolSteps[1]?.stepId);
    expect(toolSteps[0]?.toolName).toBe("count_words");
    expect(toolSteps[0]?.toolArgsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(toolSteps[1]?.endedAt).toBeGreaterThanOrEqual(toolSteps[1]?.startedAt ?? 0);
    expect(toolSteps[1]?.toolResultSize).toBeGreaterThan(0);
    reg.unregister();
  });

  test("verdict step emitted when report_status fires", async () => {
    const reg = registerFauxProvider({ models: [{ id: "step-verdict" }] });
    reg.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("report_status", { outcome: "success", reason: "ok" }, { id: "v-step-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const step = new CapturingStepProvider();
    await runOnce({
      blueprint: {
        ...bp,
        model: "faux/step-verdict",
        outcomes: {
          success: "ok",
          error: "any failure",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 30000,
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "go",
      step,
    });
    const verdictSteps = step.steps.filter((s) => s.kind === "verdict");
    expect(verdictSteps.length).toBe(1);
    expect((verdictSteps[0]?.meta as { outcome?: string } | undefined)?.outcome).toBe("success");
    reg.unregister();
  });

  test("step write failure does NOT fail the run", async () => {
    const reg = registerFauxProvider({ models: [{ id: "step-fail-safe" }] });
    reg.setResponses([fauxAssistantMessage("hi", { stopReason: "stop" })]);

    const exploding: StepProvider = {
      name: "exploding",
      async connect() {},
      async disconnect() {},
      async healthy() {
        return true;
      },
      async recordStep() {
        throw new Error("disk full");
      },
      async getSteps() {
        return [];
      },
    };

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/step-fail-safe" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "hi",
      step: exploding,
    });
    expect(r.run.status).toBe("complete");
    reg.unregister();
  });
});
