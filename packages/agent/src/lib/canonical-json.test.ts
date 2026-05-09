import { describe, expect, it } from "bun:test";

import { canonicalJsonStringify } from "./canonical-json.ts";

describe("canonicalJsonStringify", () => {
  it("sorts object keys", () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produces same output for differently-ordered args", () => {
    const a = canonicalJsonStringify({ x: 1, y: { p: "a", q: "b" } });
    const b = canonicalJsonStringify({ y: { q: "b", p: "a" }, x: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined keys, like JSON.stringify", () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("turns NaN/Infinity into null", () => {
    expect(canonicalJsonStringify({ x: NaN, y: Infinity })).toBe('{"x":null,"y":null}');
  });

  it("throws on circular references", () => {
    const o: { self?: unknown } = {};
    o.self = o;
    expect(() => canonicalJsonStringify(o)).toThrow(/circular/);
  });

  it("handles nested mixed structures", () => {
    expect(canonicalJsonStringify({ list: [{ b: 2, a: 1 }, "x"] })).toBe(
      '{"list":[{"a":1,"b":2},"x"]}',
    );
  });
});
