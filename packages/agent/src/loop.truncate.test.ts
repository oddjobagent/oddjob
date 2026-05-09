// Integration test: runOnce + a tool that returns >8KB triggers
// withResultTruncation, AND show_tool_result is auto-included so the agent
// can recover the full payload.

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
  dir = await mkdtemp(join(tmpdir(), "oddjob-trunc-"));
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

describe("runOnce truncation wiring", () => {
  test("a tool returning >8KB has its result truncated + show_tool_result is registered", async () => {
    const reg = registerFauxProvider({ models: [{ id: "trunc-test" }] });
    // The faux loop: assistant calls `bash` with a command that produces
    // a giant output, then we have it call `show_tool_result` on the
    // truncated id, then it stops with text.
    const big = "X".repeat(20000); // 20KB result — well above the 8KB cap
    reg.setResponses([
      // Turn 1: invoke bash to produce big output
      fauxAssistantMessage(
        [fauxToolCall("bash", { command: `printf '${big}'` }, { id: "tc-bash-1" })],
        { stopReason: "toolUse" },
      ),
      // Turn 2: the truncated response would mention "show_tool_result"
      // — invoke it to fetch the rest. The sandbox-provider records the
      // full result keyed by tc-bash-1, so this should succeed.
      fauxAssistantMessage(
        [fauxToolCall("show_tool_result", { toolUseId: "tc-bash-1" }, { id: "tc-show-1" })],
        { stopReason: "toolUse" },
      ),
      // Turn 3: terminate with success text
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    // Force the bash tool into the allowlist.
    const step = new CapturingStepProvider();
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/trunc-test", tools: ["bash"] },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "do it",
      step,
    });
    expect(r.run.status).toBe("complete");

    // Two distinct tool steps: bash and show_tool_result. Each gets an
    // open + close row → 4 rows total under kind=tool_call.
    const toolCalls = step.steps.filter((s) => s.kind === "tool_call");
    const byName = toolCalls.reduce<Record<string, number>>((acc, s) => {
      const n = s.toolName ?? "?";
      acc[n] = (acc[n] ?? 0) + 1;
      return acc;
    }, {});
    expect(byName.bash).toBeGreaterThanOrEqual(2); // open + close
    // show_tool_result is auto-included into every run, AND the agent
    // invoked it — so it should appear too.
    expect(byName.show_tool_result).toBeGreaterThanOrEqual(2);

    // The bash close row should have a tool_result_size that's NOT the
    // full 20K — the wrapper truncates before the result is recorded.
    const bashClose = toolCalls.find((s) => s.toolName === "bash" && s.endedAt !== undefined);
    expect(bashClose?.toolResultSize).toBeDefined();
    // After truncation: ~4KB head + marker ≈ 4150 bytes. Definitely < 20KB.
    expect(bashClose?.toolResultSize).toBeLessThan(8500);
    // And > the marker boundary (assert it's the truncated payload, not
    // an empty/error result).
    expect(bashClose?.toolResultSize).toBeGreaterThan(3000);

    reg.unregister();
  });
});
