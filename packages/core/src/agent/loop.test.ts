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
  dir = await mkdtemp(join(tmpdir(), "oddjob-agent-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runOnce - faux LLM", () => {
  test("echo blueprint runs end-to-end with faux", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-echo" }] });
    reg.setResponses([fauxAssistantMessage("Hello back!", { stopReason: "stop" })]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-echo" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "Hi",
    });

    expect(r.run.status).toBe("complete");
    expect(r.output.finalText).toContain("Hello back");
    expect(r.run.tokenInput).toBeGreaterThanOrEqual(0);
    reg.unregister();
  });

  test("script tool is called when faux returns toolCall", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-tools" }] });
    reg.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("count_words", { text: "the quick brown fox" }, { id: "tc-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("That has 4 words.")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/word-count", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-tools" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "Count words in: the quick brown fox",
    });

    expect(r.run.status).toBe("complete");
    expect(r.run.toolCalls).toBe(1);
    expect(r.output.finalText).toContain("4 words");
    reg.unregister();
  });

  test("verdict tool with outcome=warning marks run failed + retriable", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-warn" }] });
    reg.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "report_status",
            { outcome: "warning", reason: "web_fetch returned 503" },
            { id: "v-1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-warn",
        outcomes: {
          success: "ok",
          warning: "transient",
          error: "fatal",
          warningTools: [],
          errorTools: [],
          maxRetries: 2,
          retryBackoffMs: 1000,
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "x",
    });

    expect(r.run.status).toBe("failed");
    expect(r.retriable).toBe(true);
    expect(r.verdict?.outcome).toBe("warning");
    expect(r.run.error).toContain("web_fetch returned 503");
    reg.unregister();
  });

  test("verdict outcome=error marks run failed + non-retriable", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-err" }] });
    reg.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "report_status",
            { outcome: "error", reason: "auth invalid" },
            { id: "v-2" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-err",
        outcomes: {
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "x",
    });

    expect(r.run.status).toBe("failed");
    expect(r.retriable).toBe(false);
    expect(r.verdict?.outcome).toBe("error");
    reg.unregister();
  });

  test("dynamic channels compose into output schema; agent fills channels.email", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-dyn-ch" }] });
    reg.setResponses([
      fauxAssistantMessage(
        '```json\n{"channels":{"email":{"subject":"Hot take","body_text":"hi"}}}\n```',
        { stopReason: "stop" },
      ),
    ]);

    const bp = await loadBlueprint("./jobs/structured-output", {
      validate: true,
      checkFs: true,
    });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-dyn-ch" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "anything",
      dynamicChannels: [
        {
          name: "email",
          type: "email",
          contract: {
            type: "object",
            properties: {
              subject: { type: "string" },
              body_text: { type: "string" },
            },
          },
        },
      ],
    });

    expect(r.output.structuredOutput).toBeDefined();
    const channels = r.output.structuredOutput?.channels as
      | { email?: { subject?: string; body_text?: string } }
      | undefined;
    expect(channels?.email?.subject).toBe("Hot take");
    expect(channels?.email?.body_text).toBe("hi");
    reg.unregister();
  });

  test("output schema validation failure flips run to failed", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-bad-output" }] });
    reg.setResponses([
      fauxAssistantMessage('```json\n{"summary":"missing title field"}\n```', {
        stopReason: "stop",
      }),
    ]);

    const bp = await loadBlueprint("./jobs/structured-output", {
      validate: true,
      checkFs: true,
    });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-bad-output" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "extract: anything",
    });

    expect(r.run.status).toBe("failed");
    expect(r.run.error).toContain("output validation failed");
    reg.unregister();
  });

  test("schema validation failure overrides report_status success", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-validation-vs-verdict" }] });
    reg.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "report_status",
            { outcome: "success", reason: "agent thinks all good" },
            { id: "v-1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage('```json\n{"summary":"missing title field"}\n```', {
        stopReason: "stop",
      }),
    ]);

    const bp = await loadBlueprint("./jobs/structured-output", {
      validate: true,
      checkFs: true,
    });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-validation-vs-verdict",
        outcomes: {
          success: "ok",
          warning: "transient",
          error: "fatal",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "extract: anything",
    });

    expect(r.run.status).toBe("failed");
    expect(r.run.error).toContain("output validation failed");
    reg.unregister();
  });

  test("limits.enforce + tool_calls cap aborts the run as failed", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-enforce-tools" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxToolCall("count_words", { text: "one" }, { id: "t-1" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxToolCall("count_words", { text: "two" }, { id: "t-2" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/word-count", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-enforce-tools" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "x",
      limits: { toolCalls: 1, warnThresholdPct: 80, enforce: true },
    });

    expect(r.run.status).toBe("failed");
    expect(r.run.error).toContain("limit exceeded");
    reg.unregister();
  });

  test("structured output extracts JSON from final assistant text", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-struct" }] });
    reg.setResponses([
      fauxAssistantMessage(
        '```json\n{"title":"Demo","summary":"a meeting","attendees":["A","B"]}\n```',
        { stopReason: "stop" },
      ),
    ]);

    const bp = await loadBlueprint("./jobs/structured-output", {
      validate: true,
      checkFs: true,
    });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-struct" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "extract: meeting tomorrow with A and B",
    });

    expect(r.output.finalText).toContain("Demo");
    expect(r.output.structuredOutput?.title).toBe("Demo");
    expect(r.output.structuredOutput?.attendees).toEqual(["A", "B"]);
    reg.unregister();
  });
});
