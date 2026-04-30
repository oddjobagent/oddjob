import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import { buildInternalTool, INTERNAL_TOOL_NAMES, isInternalToolName } from "./index.ts";

const NOOP_SESSION = {
  sessionWorkdir: "/tmp",
  exec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, truncated: false }),
  writeFile: async () => undefined,
  readFile: async () => "",
  kill: async () => undefined,
};

describe("buildInternalTool", () => {
  test("returns undefined for unknown names", () => {
    const t = buildInternalTool("definitely-not-a-tool", {
      environment: NOOP_SESSION,
      blueprintDir: "/tmp",
    });
    expect(t).toBeUndefined();
  });

  test("instantiates each coding tool with correct name", () => {
    const names = ["bash", "read", "write", "edit", "grep", "find", "ls"] as const;
    for (const name of names) {
      const t = buildInternalTool(name, { environment: NOOP_SESSION, blueprintDir: "/tmp" });
      expect(t?.name).toBe(name);
    }
  });

  test("bash tool actually runs a command end-to-end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oddjob-internal-bash-"));
    const provider = new ProcessEnvironmentProvider();
    await provider.connect();
    const session = await provider.spawn({ workdir: dir });
    try {
      const bash = buildInternalTool("bash", {
        environment: session,
        blueprintDir: dir,
      });
      expect(bash).toBeDefined();
      const result = await bash!.execute("call-1", { command: "echo hello-internal" });
      const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      expect(text).toContain("hello-internal");
    } finally {
      await session.kill();
      await provider.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("isInternalToolName matches the export list", () => {
    for (const name of INTERNAL_TOOL_NAMES) {
      expect(isInternalToolName(name)).toBe(true);
    }
    expect(isInternalToolName("definitely-not")).toBe(false);
    expect(isInternalToolName("web_fetch")).toBe(false);
    expect(isInternalToolName("web_search")).toBe(false);
  });
});
