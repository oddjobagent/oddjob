import { describe, expect, test } from "bun:test";

import {
  assertSerial,
  type Context,
  defineRun,
  IPC_CALL_KINDS,
  type IpcCall,
  type IpcResponse,
  isRunDefinition,
  ODDJOB_RUN_MARKER,
  PermanentError,
  RetryableError,
  type RunDefinition,
} from "./index.ts";

describe("@oddjob/sdk B2.2 — defineRun", () => {
  test("returns a RunDefinition with the expected shape", () => {
    const def = defineRun(
      { inputSchema: { type: "object" }, outputSchema: { type: "object" } },
      async (_ctx) => ({ ok: true }),
    );
    expect(def[ODDJOB_RUN_MARKER]).toBe(true);
    expect(typeof def.run).toBe("function");
    expect(def.inputSchema).toEqual({ type: "object" });
    expect(def.outputSchema).toEqual({ type: "object" });
    expect(isRunDefinition(def)).toBe(true);
    expect(isRunDefinition({ run: () => 1 })).toBe(false);
    expect(isRunDefinition(null)).toBe(false);
  });

  test("schemas are optional", () => {
    const def = defineRun({}, async () => undefined);
    expect(def.inputSchema).toBeUndefined();
    expect(def.outputSchema).toBeUndefined();
    expect(isRunDefinition(def)).toBe(true);
  });
});

describe("@oddjob/sdk B2.2 — errors", () => {
  test("RetryableError is instanceof Error AND RetryableError", () => {
    const err = new RetryableError("transient", { max: 3, backoffMs: 500 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RetryableError);
    expect(err.kind).toBe("retryable");
    expect(err.max).toBe(3);
    expect(err.backoffMs).toBe(500);
    expect(err.name).toBe("RetryableError");
  });

  test("PermanentError is instanceof Error AND PermanentError", () => {
    const err = new PermanentError("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PermanentError);
    expect(err.kind).toBe("permanent");
    expect(err.name).toBe("PermanentError");
    expect(err).not.toBeInstanceOf(RetryableError);
  });
});

describe("@oddjob/sdk B2.2 — IpcCall discriminated union", () => {
  test("narrowing works on `kind`", () => {
    const calls: IpcCall[] = [
      { id: 1, kind: "fork", args: { blueprintRef: "ns/x", inputs: {} } },
      { id: 2, kind: "sleep", args: { ms: 100 } },
      { id: 3, kind: "now", args: {} },
      { id: 4, kind: "memory_get", args: { key: "k" } },
    ];
    let forkCount = 0;
    let nowCount = 0;
    for (const c of calls) {
      if (c.kind === "fork") {
        // narrowed: c.args.blueprintRef must exist
        expect(c.args.blueprintRef).toBe("ns/x");
        forkCount += 1;
      } else if (c.kind === "now") {
        nowCount += 1;
      }
    }
    expect(forkCount).toBe(1);
    expect(nowCount).toBe(1);
  });

  test("IPC_CALL_KINDS matches the SQL CHECK constraint", () => {
    // Same set + same length as the run_events CHECK in 0012_run_events.sql.
    const expected = [
      "fork",
      "mcp",
      "tool",
      "sleep",
      "approval",
      "runAgent",
      "notify",
      "now",
      "uuid",
      "random",
      "memory_get",
      "memory_set",
      "scratch_get",
      "scratch_set",
      "waitForRun",
    ] as const;
    expect([...IPC_CALL_KINDS]).toEqual([...expected]);
  });

  test("IpcResponse narrows on `ok`", () => {
    const responses: IpcResponse<string>[] = [
      { id: 1, ok: true, result: "hi" },
      { id: 2, ok: false, error: { kind: "timeout", message: "boom", retryable: true } },
    ];
    let okCount = 0;
    let errCount = 0;
    for (const r of responses) {
      if (r.ok) {
        expect(r.result).toBe("hi");
        okCount += 1;
      } else {
        expect(r.error.kind).toBe("timeout");
        expect(r.error.retryable).toBe(true);
        errCount += 1;
      }
    }
    expect(okCount).toBe(1);
    expect(errCount).toBe(1);
  });
});

describe("@oddjob/sdk B2.2 — Context type instantiation", () => {
  // Proves the surface compiles with explicit generic args. This is a
  // type-only smoke test; runtime behaviour is mocked. Generic methods
  // (fork/tool/runAgent/mcp.call/memory.get/scratch.get) are typed as
  // `<T>() => Promise<T>` — variance forbids assigning a function with a
  // concrete return type. We cast through `unknown` (the standard
  // pattern for mocking generics) to keep the surface honest.
  test("mock Context<TInputs> can be constructed", async () => {
    interface Inputs {
      url: string;
    }
    const anyAsync = (async () => undefined) as unknown as <T>() => Promise<T>;
    const anyAsyncWithArgs = (async () => undefined) as unknown as <T>(
      ...args: unknown[]
    ) => Promise<T>;
    const ctx: Context<Inputs> = {
      inputs: { url: "https://example.com" },
      totalCostUsd: 0,
      RetryableError,
      PermanentError,
      memory: {
        async set() {},
        get: anyAsyncWithArgs,
      },
      scratch: {
        async set() {},
        get: anyAsyncWithArgs,
      },
      fork: anyAsyncWithArgs,
      mcp() {
        return { call: anyAsyncWithArgs };
      },
      tool: anyAsyncWithArgs,
      async sleep() {},
      runAgent: anyAsync,
      async requestApproval() {
        return { approved: false, reason: "mock" };
      },
      async notify() {},
      async now() {
        return new Date(0);
      },
      async uuid() {
        return "00000000-0000-0000-0000-000000000000";
      },
      async random() {
        return 0.5;
      },
    };
    expect(ctx.inputs.url).toBe("https://example.com");
    expect(await ctx.now()).toEqual(new Date(0));
    expect(await ctx.random()).toBe(0.5);
    expect(ctx.totalCostUsd).toBe(0);

    // RunDefinition can be invoked with this mock ctx.
    const def: RunDefinition<Inputs, { ok: boolean }> = defineRun({}, async (c) => ({
      ok: c.inputs.url.startsWith("https://"),
    }));
    const out = await def.run(ctx);
    expect(out.ok).toBe(true);
  });
});

describe("@oddjob/sdk B2.2 — assertSerial dispatcher guard", () => {
  test("rejects concurrent ctx.* calls", () => {
    const guard = assertSerial();
    guard.begin("ctx.fork");
    expect(() => guard.begin("ctx.fork")).toThrow(/concurrent ctx\.\* calls/);
    guard.end();
    // After end, a new call is allowed.
    expect(() => guard.begin("ctx.tool")).not.toThrow();
    guard.end();
  });

  test("error message names both call sites", () => {
    const guard = assertSerial();
    guard.begin("ctx.fork");
    let msg = "";
    try {
      guard.begin("ctx.tool");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("ctx.fork");
    expect(msg).toContain("ctx.tool");
    expect(msg).toContain("Promise.all");
  });
});
