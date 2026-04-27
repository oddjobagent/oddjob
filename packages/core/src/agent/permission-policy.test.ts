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

import { runOnce } from "./loop.ts";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";
import { loadBlueprint } from "../blueprint/index.ts";

let dir: string;
const sandbox = new ProcessEnvironmentProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-perm-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("permission policy: confirm gate", () => {
  test("approved confirm allows the tool to fire", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-perm-allow" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxToolCall("count_words", { text: "hello world" }, { id: "tc-1" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/word-count", { validate: true, checkFs: true });
    const requests: Array<{ toolUseId: string; toolName: string }> = [];

    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-perm-allow",
        toolPolicies: { count_words: { confirm: true } },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "x",
      onConfirmRequest: async (req) => {
        requests.push({ toolUseId: req.toolUseId, toolName: req.toolName });
        return { allow: true };
      },
    });

    expect(requests).toEqual([{ toolUseId: "tc-1", toolName: "count_words" }]);
    expect(r.run.status).toBe("complete");
    expect(r.run.toolCalls).toBe(1);
    reg.unregister();
  });

  test("denied confirm blocks the tool, agent sees the error", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-perm-deny" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxToolCall("count_words", { text: "x" }, { id: "tc-2" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("ok, skipping")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/word-count", { validate: true, checkFs: true });

    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-perm-deny",
        toolPolicies: { count_words: { confirm: true } },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "x",
      onConfirmRequest: async () => ({ allow: false, denyMessage: "not now" }),
    });

    expect(r.run.status).toBe("complete");
    expect(r.run.toolCalls).toBe(1);
    // The blocked tool was never executed, so the count_words script never returned data.
    expect(r.output.finalText).toContain("skipping");
    reg.unregister();
  });

  test("tool without confirm policy fires without onConfirmRequest", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-perm-skip" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxToolCall("count_words", { text: "x" }, { id: "tc-3" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/word-count", { validate: true, checkFs: true });
    let called = false;

    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-perm-skip" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "x",
      onConfirmRequest: async () => {
        called = true;
        return { allow: true };
      },
    });

    expect(called).toBe(false);
    expect(r.run.status).toBe("complete");
    reg.unregister();
  });
});
