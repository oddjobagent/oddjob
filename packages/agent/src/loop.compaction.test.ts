// Integration test: when the grader iterates and priorMessages exceeds
// the configured threshold, runOnce fires compactHistory + writes a
// `compaction` step row + persists the collapsed segment to run_messages.
//
// We use a low triggerRatio so a small synthetic conversation triggers
// the compactor without burning tokens on a real long-horizon run.

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

import type { MessageProvider, MessageQuery, MessageRecord } from "@oddjob/core";
import type { StepProvider, StepQuery, StepRecord } from "@oddjob/core";
import { loadBlueprint } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { runOnce } from "./loop.ts";

let dir: string;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-compact-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

class CapturingStepProvider implements StepProvider {
  readonly name = "capturing-step";
  readonly steps: StepRecord[] = [];
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }
  async recordStep(step: StepRecord): Promise<void> {
    this.steps.push(step);
  }
  async getSteps(runId: string, _opts?: StepQuery): Promise<StepRecord[]> {
    return this.steps.filter((s) => s.runId === runId);
  }
}

class CapturingMessageProvider implements MessageProvider {
  readonly name = "capturing-msg";
  readonly records: MessageRecord[] = [];
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }
  async recordMessage(record: MessageRecord): Promise<void> {
    this.records.push(record);
  }
  async getMessages(runId: string, _opts?: MessageQuery): Promise<MessageRecord[]> {
    return this.records.filter((r) => r.runId === runId);
  }
  async nextSeq(runId: string): Promise<number> {
    const rs = this.records.filter((r) => r.runId === runId).map((r) => r.seq);
    return rs.length === 0 ? 0 : Math.max(...rs) + 1;
  }
}

describe("runOnce compaction wiring", () => {
  test("compacts history at inter-invocation boundary when grader iterates + threshold crossed", async () => {
    const reg = registerFauxProvider({ models: [{ id: "compact-test" }] });

    // Big bash output to inflate the message history past the
    // triggerRatio threshold. The agent calls bash once, gets a 20KB
    // tool result (truncated to ~4KB on the wire), receives a verdict
    // text, then report_status with success.
    const big = "X".repeat(20000);
    reg.setResponses([
      // Iteration 0 — initial pass: bash → report_status (terminates loop).
      fauxAssistantMessage(
        [fauxToolCall("bash", { command: `printf '${big}'` }, { id: "tc-bash" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("report_status", { outcome: "success", reason: "first try" }, { id: "rs-1" })],
        { stopReason: "toolUse" },
      ),
      // Grader iter 0 — needs_revision (forces another invokeAgent)
      fauxAssistantMessage(
        [
          fauxText(
            '```json\n{"result": "needs_revision", "explanation": "try again", "criteria": []}\n```',
          ),
        ],
        { stopReason: "stop" },
      ),
      // Compactor summarisation call (fires before iter 1 invokeAgent
      // because priorMessages is non-empty at this boundary).
      fauxAssistantMessage([fauxText("Compact summary: the agent ran bash once.")], {
        stopReason: "stop",
      }),
      // Iteration 1 — revision pass: just report_status success.
      fauxAssistantMessage(
        [
          fauxToolCall(
            "report_status",
            { outcome: "success", reason: "fixed up" },
            { id: "rs-2" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      // Filler in case iter 1's runAgentLoop wants an extra turn after
      // report_status (some pi-agent-core paths emit a final no-op).
      fauxAssistantMessage([fauxText("acknowledged")], { stopReason: "stop" }),
      // Grader iter 1 — satisfied; run completes.
      fauxAssistantMessage(
        [fauxText('```json\n{"result": "satisfied", "explanation": "ok now"}\n```')],
        { stopReason: "stop" },
      ),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const step = new CapturingStepProvider();
    const messages = new CapturingMessageProvider();

    // Compaction config: very low triggerRatio so even a small
    // history triggers it. We rely on the faux model's contextWindow
    // (8192 in pi-ai's faux registration) so threshold = 0.05 * 8192 ≈
    // 410 tokens. A single ~4KB truncated bash result + a few user/
    // assistant turns easily exceeds that.
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/compact-test",
        tools: ["bash"],
        outcomes: {
          success: "ok",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
          grader: {
            // Inline rubric so runGrader fires on the first iteration.
            rubricText: "must succeed",
            maxIterations: 2,
            onVerdict: "fail-only" as const,
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "trigger compaction",
      step,
      messages,
      // Faux model contextWindow = 128_000 by default; pick a tiny ratio so
      // even a small synthetic conversation crosses the threshold.
      engine: { compaction: { mode: "auto", triggerRatio: 0.005, pinHead: 1, pinTail: 1 } },
    });

    expect(r.run.status).toBe("complete");

    // Compaction step row should appear (open + close share stepId)
    const compactionSteps = step.steps.filter((s) => s.kind === "compaction");
    expect(compactionSteps.length).toBeGreaterThanOrEqual(1);
    const closed = compactionSteps.find((s) => s.endedAt !== undefined);
    expect(closed).toBeDefined();
    expect(closed?.meta).toMatchObject({ collapsedRange: expect.any(Array) });

    // Pre-compaction history persisted to run_messages: there should be
    // at least the collapsed segment + 1 synthetic 'compacted' summary
    // row.
    const persisted = await messages.getMessages(r.run.id);
    expect(persisted.length).toBeGreaterThanOrEqual(2);
    const compactedRows = persisted.filter((m) => m.role === "compacted");
    expect(compactedRows.length).toBe(1);

    reg.unregister();
  });
});
