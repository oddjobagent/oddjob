import { describe, expect, test } from "bun:test";

import { deepRedact, redactString, redactStringified } from "./redact.ts";

describe("redactString", () => {
  test("replaces vendor token shapes with [REDACTED]", () => {
    expect(redactString("token=ghp_aaaaaaaaaaaaaaaaaaaa here")).toBe("token=[REDACTED] here");
    expect(redactString("Bearer sk-ant-abcdefghijabcdefghij1234")).toBe("Bearer [REDACTED]");
    expect(redactString("xoxb-1111111111-2222222222-abcdefghijkl")).toBe("[REDACTED]");
  });

  test("leaves non-token strings unchanged", () => {
    expect(redactString("nothing to redact here")).toBe("nothing to redact here");
  });
});

describe("deepRedact", () => {
  test("walks nested objects + arrays", () => {
    const result = deepRedact({
      args: {
        token: "ghp_aaaaaaaaaaaaaaaaaaaa",
        nested: { auth: "Bearer sk-ant-1234567890abcdefghij" },
        list: ["safe", "xoxb-1111111111-2222222222-abcdefghijkl"],
        n: 42,
        b: true,
        nul: null,
      },
    });
    expect(result).toEqual({
      args: {
        token: "[REDACTED]",
        nested: { auth: "Bearer [REDACTED]" },
        list: ["safe", "[REDACTED]"],
        n: 42,
        b: true,
        nul: null,
      },
    });
  });

  test("returns primitives untouched", () => {
    expect(deepRedact(42)).toBe(42);
    expect(deepRedact(null)).toBeNull();
    expect(deepRedact(undefined)).toBeUndefined();
  });

  test("redacts a top-level string", () => {
    expect(deepRedact("ghp_aaaaaaaaaaaaaaaaaaaa")).toBe("[REDACTED]");
  });

  test("breaks reference cycles", () => {
    const a: Record<string, unknown> = { name: "ghp_aaaaaaaaaaaaaaaaaaaa" };
    a.self = a;
    const result = deepRedact(a) as { name: string; self: unknown };
    expect(result.name).toBe("[REDACTED]");
    expect(result.self).toBe("[CYCLIC]");
  });

  test("drops function-valued props (no toJSON smuggling)", () => {
    const value = {
      name: "safe",
      toJSON: () => ({ leak: "ghp_aaaaaaaaaaaaaaaaaaaa" }),
    };
    const result = deepRedact(value) as Record<string, unknown>;
    expect(result.toJSON).toBeUndefined();
    expect(result.name).toBe("safe");
  });

  test("converts bigint to '<value>n' string (preserves info, JSON-safe)", () => {
    const result = deepRedact({ count: 100n, list: [1n, 2n] }) as {
      count: unknown;
      list: unknown[];
    };
    expect(result.count).toBe("100n");
    expect(result.list).toEqual(["1n", "2n"]);
  });

  test("top-level bigint converts to string", () => {
    // The generic preserves the input type, but deepRedact actually returns
    // a string for bigint input — cast to unknown to satisfy the matcher.
    expect(deepRedact(42n) as unknown).toBe("42n");
  });
});

describe("redactStringified", () => {
  test("scrubs tokens that surface AFTER toJSON expansion", () => {
    // The classic deepRedact bypass: a custom toJSON returns a token-bearing
    // shape that JSON.stringify then serialises. redactStringified runs the
    // serializer FIRST so the token shape ends up in the scrubbed string.
    const value = {
      toJSON: () => ({ leak: "ghp_aaaaaaaaaaaaaaaaaaaa" }),
    };
    const out = redactStringified(value);
    expect(out).not.toBeNull();
    expect(out).not.toContain("ghp_aaaaaaaa");
    expect(out).toContain("[REDACTED]");
  });

  test("returns null for nullish input", () => {
    expect(redactStringified(undefined)).toBeNull();
    expect(redactStringified(null)).toBeNull();
  });

  test("survives reference cycles via deepRedact fallback", () => {
    const a: Record<string, unknown> = { name: "sk-ant-abcdefghij1234567890" };
    a.self = a;
    const out = redactStringified(a);
    expect(out).not.toBeNull();
    expect(out).not.toContain("sk-ant-");
    expect(out).toContain("[REDACTED]");
  });

  test("survives bigint values (deepRedact fallback path)", () => {
    // JSON.stringify throws on the first BigInt; the catch path runs through
    // deepRedact which converts it to "<n>n" string, then re-stringifies.
    const out = redactStringified({ count: 100n, name: "ok" });
    expect(out).not.toBeNull();
    expect(out).toContain('"count":"100n"');
    expect(out).toContain('"name":"ok"');
  });
});
