import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import {
  createShowToolResultTool,
  makeTruncateStore,
  MAX_RESULT_BYTES,
  TRUNCATE_HEAD_BYTES,
  withResultTruncation,
} from "./truncate-result.ts";

const noop = Type.Object({});

function makeTool(text: string): AgentTool<typeof noop, undefined> {
  return {
    name: "echo",
    label: "echo",
    description: "echoes a fixed text",
    parameters: noop,
    async execute() {
      return { content: [{ type: "text", text }], details: undefined };
    },
  };
}

describe("withResultTruncation", () => {
  test("passes small results through untouched", async () => {
    const store = makeTruncateStore();
    const wrapped = withResultTruncation(makeTool("small output"), store);
    const r = await wrapped.execute("id-1", {}, undefined);
    expect(r.content[0]).toMatchObject({ type: "text", text: "small output" });
    expect(store.size()).toBe(0);
  });

  test("truncates oversized text + stashes full + writes affordance marker", async () => {
    const store = makeTruncateStore();
    const big = "X".repeat(MAX_RESULT_BYTES + 1000);
    const wrapped = withResultTruncation(makeTool(big), store);
    const r = await wrapped.execute("id-2", {}, undefined);
    const block = r.content[0] as { type: "text"; text: string };
    expect(block.type).toBe("text");
    expect(block.text.length).toBeLessThan(big.length);
    expect(block.text).toContain("[truncated");
    expect(block.text).toContain("id-2");
    expect(store.size()).toBe(1);
    expect(store.get("id-2")?.totalBytes).toBe(big.length);
  });

  test("custom maxBytes override", async () => {
    const store = makeTruncateStore();
    const wrapped = withResultTruncation(makeTool("hello world"), store, 5);
    const r = await wrapped.execute("id-3", {}, undefined);
    const block = r.content[0] as { type: "text"; text: string };
    expect(block.text).toContain("[truncated");
    expect(store.size()).toBe(1);
  });

  test("non-text blocks pass through", async () => {
    const store = makeTruncateStore();
    const tool: AgentTool<typeof noop, undefined> = {
      name: "img",
      label: "img",
      description: "img",
      parameters: noop,
      async execute() {
        return {
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "xx" } },
          ],
          details: undefined,
        } as never;
      },
    };
    const wrapped = withResultTruncation(tool, store);
    const r = await wrapped.execute("id-img", {}, undefined);
    expect(r.content[0]).toMatchObject({ type: "image" });
    expect(store.size()).toBe(0);
  });
});

describe("createShowToolResultTool", () => {
  test("returns tail (start = TRUNCATE_HEAD_BYTES) by default", async () => {
    const store = makeTruncateStore();
    const big = "ABCDEFGHIJ".repeat(2000); // 20000 bytes
    store.set("u-1", big);
    const tool = createShowToolResultTool(store);
    const r = await tool.execute("show-1", { toolUseId: "u-1" }, undefined);
    const text = (r.content[0] as { text: string }).text;
    expect(text.startsWith(big.slice(TRUNCATE_HEAD_BYTES, TRUNCATE_HEAD_BYTES + 50))).toBe(true);
    expect(text).toContain("end of content");
  });

  test("explicit byteRange honored", async () => {
    const store = makeTruncateStore();
    store.set("u-2", "0123456789ABCDEFGHIJ");
    const tool = createShowToolResultTool(store);
    const r = await tool.execute("show-2", { toolUseId: "u-2", byteRange: [3, 8] }, undefined);
    const text = (r.content[0] as { text: string }).text;
    expect(text.startsWith("34567")).toBe(true);
    expect(text).toContain("3-8 of 20");
  });

  test("missing toolUseId errors with helpful message", async () => {
    const store = makeTruncateStore();
    const tool = createShowToolResultTool(store);
    const r = await tool.execute("show-3", { toolUseId: "ghost" }, undefined);
    const errText = (r.content[0] as { text: string }).text;
    expect(errText).toContain("ERROR");
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("ghost");
  });

  test("empty range errors", async () => {
    const store = makeTruncateStore();
    store.set("u-3", "abcdef");
    const tool = createShowToolResultTool(store);
    const r = await tool.execute("show-4", { toolUseId: "u-3", byteRange: [5, 3] }, undefined);
    const errText = (r.content[0] as { text: string }).text;
    expect(errText).toContain("ERROR");
  });
});
