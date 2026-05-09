// Phase 3.4 — missing-required-finalizer recovery.
//
// When a blueprint declares [outcomes] (with no grader) and the agent
// finishes its turn without calling `report_status`, the harness
// injects ONE synthetic user prompt asking it to call the tool. If the
// agent complies, the verdict gets set; if not, the run still ends
// without a verdict (single-shot, no retry loop).

import { describe, expect, test } from "bun:test";

import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";

import { loadBlueprint } from "@oddjob/core";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { runOnce } from "./loop.ts";

const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

describe("missing-required-finalizer recovery (Phase 3.4)", () => {
  test("agent finishes without report_status → forced re-invoke prompts it; second turn calls report_status", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-finalizer-recovers" }] });
    reg.setResponses([
      // 1st turn: agent says "hi" without calling report_status
      fauxAssistantMessage([fauxText("hi there")], { stopReason: "stop" }),
      // 2nd turn (forced re-invoke): agent finally calls report_status
      fauxAssistantMessage(
        [
          fauxToolCall(
            "report_status",
            { outcome: "success", reason: "Greeting produced." },
            { id: "rs_1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      // 3rd turn (after tool result): agent stops cleanly
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-finalizer-recovers",
        outcomes: {
          success: "produced a greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.verdict?.outcome).toBe("success");
    expect(r.verdict?.reason).toContain("Greeting");
    expect(r.run.status).toBe("complete");
    reg.unregister();
  });

  test("agent ignores forced prompt → no verdict, run still ends (single-shot, no loop)", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-finalizer-ignores" }] });
    reg.setResponses([
      // 1st turn: agent says "hi" without calling report_status
      fauxAssistantMessage([fauxText("hi there")], { stopReason: "stop" }),
      // 2nd turn (forced re-invoke): agent STILL doesn't call report_status
      fauxAssistantMessage([fauxText("apologies, I cannot")], { stopReason: "stop" }),
      // No 3rd turn — single-shot recovery means no further re-invoke.
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-finalizer-ignores",
        outcomes: {
          success: "produced a greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.verdict).toBeUndefined();
    // Run still completes naturally (no error)
    expect(r.run.status).toBe("complete");
    reg.unregister();
  });

  test("preserves the original artifact when blueprint has outputSchema (codex round-23 R-001)", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-finalizer-preserves-artifact" }] });
    // First turn: agent emits valid JSON output (would satisfy outputSchema)
    // but does NOT call report_status. Second turn: forced re-invoke
    // calls report_status with NO output — the recovery turn intentionally
    // emits no useful artifact. Output extraction must use the FIRST
    // turn's JSON, not the empty recovery turn.
    const validOutputJson = JSON.stringify({ greeting: "hello world" });
    reg.setResponses([
      // 1st turn: emits the canonical JSON artifact
      fauxAssistantMessage([fauxText(validOutputJson)], { stopReason: "stop" }),
      // 2nd turn (forced re-invoke): only calls report_status, no artifact
      fauxAssistantMessage(
        [
          fauxToolCall(
            "report_status",
            { outcome: "success", reason: "Done" },
            { id: "rs_artifact" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      // 3rd turn (post-tool): stops cleanly
      fauxAssistantMessage([fauxText("ok")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-finalizer-preserves-artifact",
        outcomes: {
          success: "produced a greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
        },
        outputSchema: {
          type: "json-schema",
          schema: {
            type: "object",
            properties: { greeting: { type: "string" } },
            required: ["greeting"],
            additionalProperties: false,
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.verdict?.outcome).toBe("success");
    // Run completes — output validation did NOT fail because we kept the
    // original JSON artifact rather than extracting from the empty
    // recovery turn.
    expect(r.run.status).toBe("complete");
    expect(r.output.structuredOutput).toEqual({ greeting: "hello world" });
    reg.unregister();
  });

  test("blueprints WITHOUT [outcomes] do not trigger the forced prompt", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-finalizer-no-outcomes" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxText("hello")], { stopReason: "stop" }),
      // If we tried to inject a forced prompt this would be queued; the
      // test would fail with "no more responses queued" instead of
      // succeeding cleanly.
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-finalizer-no-outcomes", outcomes: undefined },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.run.status).toBe("complete");
    expect(r.verdict).toBeUndefined();
    reg.unregister();
  });
});
