import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { buildBuiltinTools, BUILTIN_TOOL_NAMES, isBuiltinToolName } from "./index.ts";

const NOOP_SESSION = {
  sessionWorkdir: "/tmp",
  exec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, truncated: false }),
  writeFile: async () => undefined,
  readFile: async () => "",
  kill: async () => undefined,
};

describe("buildBuiltinTools", () => {
  test("empty allowlist returns no tools", () => {
    const tools = buildBuiltinTools({
      allowlist: [],
      environment: NOOP_SESSION,
      blueprintDir: "/tmp",
    });
    expect(tools).toEqual([]);
  });

  test("ignores unknown names silently (validation catches them earlier)", () => {
    const tools = buildBuiltinTools({
      allowlist: ["definitely-not-a-tool", "bash"],
      environment: NOOP_SESSION,
      blueprintDir: "/tmp",
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("bash");
  });

  test("instantiates each pi-coding-agent tool with correct name", () => {
    const codingNames = ["bash", "read", "write", "edit", "grep", "find", "ls"] as const;
    const tools = buildBuiltinTools({
      allowlist: codingNames,
      environment: NOOP_SESSION,
      blueprintDir: "/tmp",
    });
    expect(tools.map((t) => t.name).sort()).toEqual([...codingNames].sort());
  });

  test("bash tool actually runs a command end-to-end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oddjob-builtin-bash-"));
    const provider = new ProcessEnvironmentProvider();
    await provider.connect();
    const session = await provider.spawn({ workdir: dir });
    try {
      const [bash] = buildBuiltinTools({
        allowlist: ["bash"],
        environment: session,
        blueprintDir: dir,
      });
      expect(bash).toBeDefined();
      const result = await bash!.execute("call-1", { command: "echo hello-builtin" });
      const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      expect(text).toContain("hello-builtin");
    } finally {
      await session.kill();
      await provider.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("isBuiltinToolName matches the export list", () => {
    for (const name of BUILTIN_TOOL_NAMES) {
      expect(isBuiltinToolName(name)).toBe(true);
    }
    expect(isBuiltinToolName("definitely-not")).toBe(false);
  });
});
