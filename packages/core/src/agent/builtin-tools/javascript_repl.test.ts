import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SandboxProcessProvider } from "../../../../../packages/providers/sandbox-process/src/provider.ts";

import { createJavascriptReplTool } from "./javascript_repl.ts";

let dir: string;
let provider: SandboxProcessProvider;
let session: Awaited<ReturnType<SandboxProcessProvider["spawn"]>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-jsrepl-"));
  provider = new SandboxProcessProvider();
  await provider.connect();
  session = await provider.spawn({ workdir: dir });
});

afterAll(async () => {
  await session.kill();
  await provider.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("createJavascriptReplTool", () => {
  test("evaluates arithmetic and prints", async () => {
    const tool = createJavascriptReplTool({ environment: session });
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
    const tool = createJavascriptReplTool({ environment: session });
    const r = await tool.execute(
      "c2",
      { code: "const v = await Promise.resolve(42); console.log(v);" },
      undefined,
    );
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("42");
  }, 30_000);

  test("captures errors as non-zero exit", async () => {
    const tool = createJavascriptReplTool({ environment: session });
    const r = await tool.execute("c3", { code: "throw new Error('boom')" }, undefined);
    expect(r.details.exitCode).not.toBe(0);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("boom");
  }, 30_000);

  test("infinite loop killed by timeout", async () => {
    const tool = createJavascriptReplTool({ environment: session, defaultTimeoutMs: 500 });
    const r = await tool.execute("c4", { code: "while(true){}" }, undefined);
    expect(r.details.exitCode).not.toBe(0);
  }, 30_000);
});
