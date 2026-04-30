import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { createPythonTool } from "./python.ts";

const haveSystemPython = (() => {
  try {
    const proc = Bun.spawnSync({
      cmd: ["python3", "--version"],
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
})();

let dir: string;
let provider: ProcessEnvironmentProvider;
let session: Awaited<ReturnType<ProcessEnvironmentProvider["spawn"]>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-pyrepl-"));
  provider = new ProcessEnvironmentProvider();
  await provider.connect();
  session = await provider.spawn({ workdir: dir });
});

afterAll(async () => {
  await session.kill();
  await provider.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!haveSystemPython)("createPythonTool", () => {
  test("evaluates arithmetic and prints", async () => {
    const tool = createPythonTool({ environment: session });
    const r = await tool.execute("c1", { code: "print(2 + 2)" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("4");
    expect(r.details.exitCode).toBe(0);
  }, 30_000);

  test("import + multiline", async () => {
    const tool = createPythonTool({ environment: session });
    const r = await tool.execute(
      "c2",
      { code: "import math\nprint(math.factorial(5))" },
      undefined,
    );
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("120");
  }, 30_000);

  test("syntax error returns non-zero exit", async () => {
    const tool = createPythonTool({ environment: session });
    const r = await tool.execute("c3", { code: "this is not python" }, undefined);
    expect(r.details.exitCode).not.toBe(0);
  }, 30_000);

  test("infinite loop killed by timeout", async () => {
    const tool = createPythonTool({ environment: session, defaultTimeoutMs: 500 });
    const r = await tool.execute("c4", { code: "while True:\n  pass" }, undefined);
    expect(r.details.exitCode).not.toBe(0);
  }, 30_000);
});

describe("createPythonTool — missing python", () => {
  test("returns helpful error when python bin not found", async () => {
    const tool = createPythonTool({
      environment: session,
      pythonBin: "/nonexistent/python-bin",
    });
    const r = await tool.execute("c5", { code: "print(1)" }, undefined);
    expect(r.details.exitCode).not.toBe(0);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text.toLowerCase()).toMatch(/not found|enoent|error|fail|nonexistent/);
  });
});
