import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SandboxProcessProvider } from "../../../../../packages/providers/sandbox-process/src/provider.ts";

import { buildBuiltinTools } from "./index.ts";

let dir: string;
let provider: SandboxProcessProvider;
let session: Awaited<ReturnType<SandboxProcessProvider["spawn"]>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-env-iso-"));
  provider = new SandboxProcessProvider();
  await provider.connect();
  session = await provider.spawn({ workdir: dir });
});

afterAll(async () => {
  await session.kill();
  await provider.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("built-in tools route through the environment session", () => {
  test("bash echo runs inside the session workdir, not the host process.cwd", async () => {
    const [bash] = buildBuiltinTools({
      allowlist: ["bash"],
      environment: session,
      blueprintDir: dir,
    });
    expect(bash).toBeDefined();
    const result = await bash!.execute("call-1", { command: "pwd" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text.trim()).toContain(dir);
    expect(text.trim()).not.toBe(process.cwd());
  });

  test("write tool persists into the session workdir", async () => {
    const [write] = buildBuiltinTools({
      allowlist: ["write"],
      environment: session,
      blueprintDir: dir,
    });
    expect(write).toBeDefined();
    const target = join(dir, "isolated.txt");
    await write!.execute("call-2", { path: target, content: "isolation-marker" });
    const back = await session.readFile(target);
    expect(back).toBe("isolation-marker");
  });

  test("javascript_repl + python_repl factories take environment, not host bun", async () => {
    const tools = buildBuiltinTools({
      allowlist: ["javascript_repl", "python_repl"],
      environment: session,
      blueprintDir: dir,
    });
    expect(tools.map((t) => t.name).toSorted()).toEqual(["javascript_repl", "python_repl"]);
  });

  test("grep is session-routed (custom impl, not pi-coding-agent host rg)", async () => {
    await session.writeFile(`${dir}/grep-fixture.txt`, "alpha\nbeta\nMARKER-needle\ngamma\n");
    const [grep] = buildBuiltinTools({
      allowlist: ["grep"],
      environment: session,
      blueprintDir: dir,
    });
    expect(grep).toBeDefined();
    const result = await grep!.execute("g1", { pattern: "MARKER-needle", path: dir }, undefined);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("MARKER-needle");
    expect(text).toContain(dir);
  });
});
