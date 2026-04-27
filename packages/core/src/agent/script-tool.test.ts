import { describe, expect, test } from "bun:test";

import type { Blueprint } from "../types/blueprint.ts";
import type { EnvironmentSession, ExecOptions, ExecResult } from "../providers/environment.ts";
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
  test("relative script path rebases onto sessionScriptsRoot, NOT blueprintDir", async () => {
    // Regression: previously script-tool resolved against blueprintDir (host
    // path) and shoved that into bun run inside the session, which failed
    // inside docker because the host path doesn't exist there.
    const calls: RunCall[] = [];
    const session = makeStubSession("/work", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ parse: "scripts/parse.ts" }),
      environment: session,
      blueprintDir: "/Users/op/projects/myagent",
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
      blueprintDir: "/Users/op/projects/myagent",
      sessionScriptsRoot: "/Users/op/projects/myagent",
    });
    await tools[0]!.execute("call-1", {});
    expect(calls[0]!.command).toBe("bun run '/Users/op/projects/myagent/scripts/parse.ts'");
  });

  test("custom sessionWorkdir override (e.g. /srv/app) is honored end-to-end", async () => {
    const calls: RunCall[] = [];
    const session = makeStubSession("/srv/app", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ parse: "scripts/parse.ts" }),
      environment: session,
      blueprintDir: "/Users/op/projects/myagent",
      sessionScriptsRoot: "/srv/app",
    });
    await tools[0]!.execute("call-1", {});
    expect(calls[0]!.command).toBe("bun run '/srv/app/scripts/parse.ts'");
  });

  test("nested relative path (scripts/sub/foo.ts) is rebased correctly", async () => {
    const calls: RunCall[] = [];
    const session = makeStubSession("/work", calls);
    const tools = buildScriptTools({
      blueprint: makeBlueprint({ foo: "scripts/sub/foo.ts" }),
      environment: session,
      blueprintDir: "/Users/op/projects/myagent",
      sessionScriptsRoot: "/work",
    });
    await tools[0]!.execute("call-1", {});
    expect(calls[0]!.command).toBe("bun run '/work/scripts/sub/foo.ts'");
  });
});
