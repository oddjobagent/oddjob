import { describe, expect, test } from "bun:test";
import { createJavascriptReplTool } from "./javascript_repl.ts";

describe("createJavascriptReplTool", () => {
  test("evaluates arithmetic and prints", async () => {
    const tool = createJavascriptReplTool();
    const r = await tool.execute(
      "c1",
      { code: "console.log('hi'); console.log(1 + 2);" },
      undefined,
    );
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("hi");
    expect(text).toContain("3");
    expect(r.details.exitCode).toBe(0);
  }, 30_000);

  test("supports top-level await", async () => {
    const tool = createJavascriptReplTool();
    const r = await tool.execute(
      "c2",
      { code: "const v = await Promise.resolve(42); console.log(v);" },
      undefined,
    );
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("42");
  }, 30_000);

  test("captures errors as non-zero exit", async () => {
    const tool = createJavascriptReplTool();
    const r = await tool.execute(
      "c3",
      { code: "throw new Error('boom')" },
      undefined,
    );
    expect(r.details.exitCode).not.toBe(0);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("boom");
  }, 30_000);

  test("infinite loop killed by timeout", async () => {
    const tool = createJavascriptReplTool({ defaultTimeoutMs: 500 });
    const r = await tool.execute(
      "c4",
      { code: "while(true){}" },
      undefined,
    );
    expect(r.details.exitCode).not.toBe(0);
  }, 30_000);
});
