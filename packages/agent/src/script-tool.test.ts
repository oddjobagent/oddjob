import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Blueprint } from "@oddjob/core";
import type { EnvironmentSession, ExecOptions, ExecResult } from "@oddjob/core";
import { buildScriptTools } from "./script-tool.ts";

interface RunCall {
  command: string;
  options?: ExecOptions;
}

function makeStubSession(sessionWorkdir: string, calls: RunCall[]): EnvironmentSession {
  return {
    sessionWorkdir,
    async exec(command, options) {
      calls.push({ command, options });
      return {
        exitCode: 0,
        stdout: "{}",
        stderr: "",
        durationMs: 1,
        truncated: false,
      } satisfies ExecResult;
    },
    async writeFile() {},
    async readFile() {
      return "";
    },
    async kill() {},
  };
}

function makeBlueprint(scripts: Record<string, string>): Blueprint {
  return {
    id: "test",
    version: "1",
    contentHash: "h",
    path: "/tmp/test/blueprint.toml",
    name: "test",
    description: "",
    systemPrompt: "",
    tools: [],
    skills: [],
    scripts,
    connectors: {},
    secrets: [],
    failOnToolError: false,
    toolPolicies: {},
  } as unknown as Blueprint;
}

describe("buildScriptTools host vs session path resolution (15i-3 codex follow-up)", () => {
  // Real on-disk script bodies are needed by the upload-on-first-call path
  // (host != session). For host == session tests they're still read by the
  // sidecar-schema lookup, so we materialize a tempdir for both.
  let hostDir: string;
  let scriptBody: string;
  beforeAll(async () => {
    hostDir = await mkdtemp(join(tmpdir(), "oddjob-script-tool-test-"));
    await mkdir(join(hostDir, "scripts", "sub"), { recursive: true });
    scriptBody = "console.log(JSON.stringify({ ok: true }))";
    await writeFile(join(hostDir, "scripts", "parse.ts"), scriptBody);
    await writeFile(join(hostDir, "scripts", "sub", "foo.ts"), scriptBody);
  });
  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(hostDir, { recursive: true, force: true });
  });

  test("relative script path rebases onto sessionScriptsRoot, NOT blueprintDir", async () => {
    // Regression: previously script-tool resolved against blueprintDir (host
    // path) and shoved that into bun run inside the session, which failed
    // inside docker because the host path doesn't exist there.
    const calls: RunCall[] = [];
    const session = makeStubSession("/work", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ parse: "scripts/parse.ts" }),
      environment: session,
      blueprintDir: hostDir,
      sessionScriptsRoot: "/work",
    });
    expect(tools).toHaveLength(1);
    await tools[0]!.execute("call-1", {});
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("bun run '/work/scripts/parse.ts'");
    expect(calls[0]!.command).not.toContain("/Users/op/projects/myagent");
  });

  test("trusted tier (host == session) — sidecar path passes through unchanged", async () => {
    const calls: RunCall[] = [];
    const session = makeStubSession("/Users/op/projects/myagent", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ parse: "scripts/parse.ts" }),
      environment: session,
      blueprintDir: hostDir,
      sessionScriptsRoot: hostDir,
    });
    await tools[0]!.execute("call-1", {});
    expect(calls[0]!.command).toBe(`bun run '${hostDir}/scripts/parse.ts'`);
  });

  test("custom sessionWorkdir override (e.g. /srv/app) is honored end-to-end", async () => {
    const calls: RunCall[] = [];
    const session = makeStubSession("/srv/app", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ parse: "scripts/parse.ts" }),
      environment: session,
      blueprintDir: hostDir,
      sessionScriptsRoot: "/srv/app",
    });
    await tools[0]!.execute("call-1", {});
    expect(calls[0]!.command).toBe("bun run '/srv/app/scripts/parse.ts'");
  });

  test("uploads script body to session on first call when host != session (env-daytona path)", async () => {
    const calls: RunCall[] = [];
    const uploads: { path: string; content: string }[] = [];
    const session: EnvironmentSession = {
      sessionWorkdir: "/home/daytona/work",
      async exec(command, options) {
        calls.push({ command, options });
        return { exitCode: 0, stdout: "{}", stderr: "", durationMs: 1, truncated: false };
      },
      async writeFile(path, content) {
        uploads.push({
          path,
          content: typeof content === "string" ? content : new TextDecoder().decode(content),
        });
      },
      async readFile() {
        return "";
      },
      async kill() {},
    };
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ parse: "scripts/parse.ts" }),
      environment: session,
      blueprintDir: hostDir,
      sessionScriptsRoot: "/home/daytona/work",
    });
    await tools[0]!.execute("call-1", {});
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path).toBe("/home/daytona/work/scripts/parse.ts");
    expect(uploads[0]!.content).toBe(scriptBody);
    // Second call must NOT re-upload — the per-tool flag cached it.
    await tools[0]!.execute("call-2", {});
    expect(uploads).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  test("nested relative path (scripts/sub/foo.ts) is rebased correctly", async () => {
    const calls: RunCall[] = [];
    const session = makeStubSession("/work", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ foo: "scripts/sub/foo.ts" }),
      environment: session,
      blueprintDir: hostDir,
      sessionScriptsRoot: "/work",
    });
    await tools[0]!.execute("call-1", {});
    expect(calls[0]!.command).toBe("bun run '/work/scripts/sub/foo.ts'");
  });
});
