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
import { SandboxProcessProvider } from "../../../../packages/providers/sandbox-process/src/provider.ts";
import { loadBlueprint } from "../blueprint/index.ts";

let dir: string;
const sandbox = new SandboxProcessProvider();

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
      sandbox,
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
      sandbox,
      input: "Count words in: the quick brown fox",
    });

    expect(r.run.status).toBe("complete");
    expect(r.run.toolCalls).toBe(1);
    expect(r.output.finalText).toContain("4 words");
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
      sandbox,
      input: "extract: meeting tomorrow with A and B",
    });

    expect(r.output.finalText).toContain("Demo");
    expect(r.output.structuredOutput?.title).toBe("Demo");
    expect(r.output.structuredOutput?.attendees).toEqual(["A", "B"]);
    reg.unregister();
  });
});
