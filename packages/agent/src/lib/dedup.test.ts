// Phase 3.3 — tool-call dedup. Tests cover allowlist gating, identical-
// args cache hits, error-bypass, mutation-invalidates-cache, and the
// truncation-overflow-rehome on a dedup hit.

import { describe, expect, test } from "bun:test";

import { type Static, Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import {
  DEDUP_ALLOWLIST,
  hashToolArgs,
  makeDedupCache,
  shouldInvalidateCacheFor,
  withDedup,
} from "./dedup.ts";
import { makeTruncateStore } from "./truncate-result.ts";

const readSchema = Type.Object({ path: Type.String() });
const bashSchema = Type.Object({ command: Type.String() });

function fakeReadTool(returns: string): AgentTool<typeof readSchema> {
  let calls = 0;
  const tool: AgentTool<typeof readSchema> & { calls: () => number } = {
    name: "read",
    label: "read",
    description: "fake read",
    parameters: readSchema,
    async execute(_id: string, _args: Static<typeof readSchema>): Promise<AgentToolResult<unknown>> {
      calls++;
      return {
        content: [{ type: "text", text: returns }],
        details: { calls },
      };
    },
    calls: () => calls,
  };
  return tool as AgentTool<typeof readSchema>;
}

function fakeBashTool(): AgentTool<typeof bashSchema> {
  let calls = 0;
  return {
    name: "bash",
    label: "bash",
    description: "fake bash",
    parameters: bashSchema,
    async execute(): Promise<AgentToolResult<unknown>> {
      calls++;
      return { content: [{ type: "text", text: `ran ${calls}` }], details: { calls } };
    },
  } as AgentTool<typeof bashSchema>;
}

describe("DEDUP_ALLOWLIST", () => {
  test("contains exactly the four read-only tools", () => {
    expect([...DEDUP_ALLOWLIST].sort()).toEqual(["find", "grep", "ls", "read"]);
  });
});

describe("hashToolArgs", () => {
  test("is stable across key reordering (canonical JSON)", () => {
    expect(hashToolArgs({ a: 1, b: 2 })).toBe(hashToolArgs({ b: 2, a: 1 }));
  });
  test("differs on different values", () => {
    expect(hashToolArgs({ a: 1 })).not.toBe(hashToolArgs({ a: 2 }));
  });
});

describe("withDedup — allowlist gating", () => {
  test("returns the inner tool unchanged for non-allowlisted names", () => {
    const cache = makeDedupCache();
    const bash = fakeBashTool();
    const wrapped = withDedup(bash, { cache });
    expect(wrapped).toBe(bash); // identical reference — no-op for non-allowlisted
  });

  test("caches identical-args calls and serves dedup hit on repeat", async () => {
    const cache = makeDedupCache();
    const read = fakeReadTool("file contents");
    const wrapped = withDedup(read, { cache });
    const a = await wrapped.execute("call_1", { path: "x.txt" }, undefined);
    const b = await wrapped.execute("call_2", { path: "x.txt" }, undefined);
    // First text block of dedup hit carries the marker
    const aBlock = a.content[0] as { text: string };
    const bBlock = b.content[0] as { text: string };
    expect(aBlock.text).toBe("file contents");
    expect(bBlock.text).toContain("[duplicate call");
    expect(bBlock.text).toContain('original tool_use_id="call_1"');
    expect(bBlock.text).toContain("file contents");
    expect(cache.size()).toBe(1);
  });

  test("misses cache on different args", async () => {
    const cache = makeDedupCache();
    const read = fakeReadTool("file contents");
    const wrapped = withDedup(read, { cache });
    await wrapped.execute("call_1", { path: "a.txt" }, undefined);
    const r = await wrapped.execute("call_2", { path: "b.txt" }, undefined);
    expect((r.content[0] as { text: string }).text).not.toContain("[duplicate");
    expect(cache.size()).toBe(2);
  });

  test("does not cache error-shaped results", async () => {
    const cache = makeDedupCache();
    const errorTool: AgentTool<typeof readSchema> = {
      name: "read",
      label: "read",
      description: "fake read",
      parameters: readSchema,
      async execute(): Promise<AgentToolResult<unknown>> {
        return { content: [{ type: "text", text: "ERROR: not found" }], details: {} };
      },
    } as AgentTool<typeof readSchema>;
    const wrapped = withDedup(errorTool, { cache });
    await wrapped.execute("call_1", { path: "missing.txt" }, undefined);
    expect(cache.size()).toBe(0);
  });

  test("re-stashes overflow under new toolUseId on cache hit (codex round-20 #2)", async () => {
    const cache = makeDedupCache();
    const store = makeTruncateStore();
    const read = fakeReadTool("body");
    const wrapped = withDedup(read, { cache, truncateStore: store });
    // Simulate the inner truncation having stashed overflow under call_1
    store.set("call_1", "FULL OVERFLOW BODY 1234567890");
    await wrapped.execute("call_1", { path: "big.txt" }, undefined);
    // Second call hits cache; dedup wrapper should re-stash under call_2
    await wrapped.execute("call_2", { path: "big.txt" }, undefined);
    const stashed = store.get("call_2");
    expect(stashed).toBeDefined();
    expect(stashed?.fullText).toBe("FULL OVERFLOW BODY 1234567890");
  });

  test("dedup-hit recorder is fired with the right ids", async () => {
    const cache = makeDedupCache();
    const read = fakeReadTool("contents");
    const hits: Array<{ toolName: string; toolUseId: string; originalToolUseId: string }> = [];
    const wrapped = withDedup(read, { cache, recordHit: (info) => hits.push(info) });
    await wrapped.execute("first", { path: "x" }, undefined);
    await wrapped.execute("second", { path: "x" }, undefined);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      toolName: "read",
      toolUseId: "second",
      originalToolUseId: "first",
    });
  });
});

describe("shouldInvalidateCacheFor", () => {
  test("returns true for non-allowlisted tools (mutating)", () => {
    expect(shouldInvalidateCacheFor("bash")).toBe(true);
    expect(shouldInvalidateCacheFor("write")).toBe(true);
    expect(shouldInvalidateCacheFor("edit")).toBe(true);
    expect(shouldInvalidateCacheFor("python")).toBe(true);
    expect(shouldInvalidateCacheFor("javascript")).toBe(true);
    expect(shouldInvalidateCacheFor("web_fetch")).toBe(true);
    expect(shouldInvalidateCacheFor("task")).toBe(true);
    expect(shouldInvalidateCacheFor("plugin_specific")).toBe(true);
  });
  test("returns false for allowlisted (read-only) tools", () => {
    expect(shouldInvalidateCacheFor("read")).toBe(false);
    expect(shouldInvalidateCacheFor("grep")).toBe(false);
    expect(shouldInvalidateCacheFor("find")).toBe(false);
    expect(shouldInvalidateCacheFor("ls")).toBe(false);
  });
});

describe("stepIdForToolUseId mapping (codex round-23 R-003)", () => {
  test("dedup cache stores the EXECUTING call's step_id, not a shared mutable", async () => {
    const cache = makeDedupCache();
    // Simulate parallel-dispatch: stepId map is populated by hypothetical
    // beforeToolCall hooks for two reads simultaneously, but the FIRST
    // call's execute() finishes second (out of order).
    const stepIds = new Map<string, string>();
    stepIds.set("call_a", "stp_aaa");
    stepIds.set("call_b", "stp_bbb");
    const hits: Array<{ originalStepId?: string }> = [];
    const read = fakeReadTool("body");
    const wrapped = withDedup(read, {
      cache,
      stepIdForToolUseId: (id) => stepIds.get(id),
      recordHit: (info) => hits.push(info),
    });
    // First call writes cache with call_a's step_id
    await wrapped.execute("call_a", { path: "x" }, undefined);
    // Second call hits cache; recorded original_step_id should be stp_aaa
    await wrapped.execute("call_b", { path: "x" }, undefined);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.originalStepId).toBe("stp_aaa");
  });
});
