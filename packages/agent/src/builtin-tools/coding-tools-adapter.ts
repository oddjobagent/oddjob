import { type Static, Type } from "typebox";
import type { TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import {
  createBashTool,
  createEditTool,
  createFindTool,
  // NOTE: createGrepTool deliberately NOT imported. pi-coding-agent's grep
  // shells out to host `rg` regardless of the pluggable Operations contract,
  // which leaks out of the environment. We use createSessionGrepTool below.
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";

import type { EnvironmentSession } from "@oddjob/core";
import type { BuiltinToolName } from "./index.ts";

export interface CodingToolsAdapterOptions {
  cwd: string;
  /**
   * Environment session that owns the tool's filesystem + shell. pi-coding-agent's
   * pluggable Operations interfaces are wired to delegate run/readFile/writeFile
   * through the session instead of the host process. Tool name + JSON schema stay
   * identical to the host-shell version.
   */
  environment: EnvironmentSession;
}

const FACTORIES = {
  bash: (opts: CodingToolsAdapterOptions) =>
    createBashTool(opts.cwd, { operations: makeBashOps(opts.environment) }),
  read: (opts: CodingToolsAdapterOptions) =>
    createReadTool(opts.cwd, { operations: makeReadOps(opts.environment) }),
  write: (opts: CodingToolsAdapterOptions) =>
    createWriteTool(opts.cwd, { operations: makeWriteOps(opts.environment) }),
  edit: (opts: CodingToolsAdapterOptions) =>
    createEditTool(opts.cwd, { operations: makeEditOps(opts.environment) }),
  grep: (opts: CodingToolsAdapterOptions) => createSessionGrepTool(opts.cwd, opts.environment),
  find: (opts: CodingToolsAdapterOptions) =>
    createFindTool(opts.cwd, { operations: makeFindOps(opts.environment) }),
  ls: (opts: CodingToolsAdapterOptions) =>
    createLsTool(opts.cwd, { operations: makeLsOps(opts.environment) }),
} as const;

export type CodingBuiltinName = keyof typeof FACTORIES;

export function isCodingBuiltin(name: BuiltinToolName): name is CodingBuiltinName {
  return name in FACTORIES;
}

export function buildCodingTool(
  name: CodingBuiltinName,
  opts: CodingToolsAdapterOptions,
): AgentTool<TSchema> {
  return FACTORIES[name](opts) as unknown as AgentTool<TSchema>;
}

// Operations adapters bridge pi-coding-agent's host-IO contracts onto the
// EnvironmentSession's primitives. Each adapter shells out to a portable
// shell builtin / coreutil so it works under seatbelt / bwrap / docker /
// daytona equally well.

function makeBashOps(env: EnvironmentSession) {
  return {
    async exec(
      command: string,
      cwd: string,
      options: {
        onData: (data: Buffer) => void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
      },
    ): Promise<{ exitCode: number | null }> {
      // pi-coding-agent's bash schema declares `timeout` in SECONDS; our
      // EnvironmentSession.exec takes timeoutMs. Convert.
      const timeoutMs =
        options.timeout !== undefined && options.timeout > 0 ? options.timeout * 1000 : undefined;
      const result = await env.exec(command, {
        cwd,
        timeoutMs,
        signal: options.signal,
        env: options.env as Record<string, string> | undefined,
      });
      if (result.stdout) options.onData(Buffer.from(result.stdout));
      if (result.stderr) options.onData(Buffer.from(result.stderr));
      return { exitCode: result.exitCode };
    },
  };
}

function makeReadOps(env: EnvironmentSession) {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      const text = await env.readFile(absolutePath);
      return Buffer.from(text, "utf8");
    },
    async access(absolutePath: string): Promise<void> {
      const r = await env.exec(`test -r ${shellQuote(absolutePath)}`);
      if (r.exitCode !== 0) throw new Error(`not readable: ${absolutePath}`);
    },
  };
}

function makeWriteOps(env: EnvironmentSession) {
  return {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await env.writeFile(absolutePath, content);
    },
    async mkdir(dir: string): Promise<void> {
      const r = await env.exec(`mkdir -p ${shellQuote(dir)}`);
      if (r.exitCode !== 0) throw new Error(`mkdir failed: ${dir}: ${r.stderr.trim()}`);
    },
  };
}

function makeEditOps(env: EnvironmentSession) {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      const text = await env.readFile(absolutePath);
      return Buffer.from(text, "utf8");
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await env.writeFile(absolutePath, content);
    },
    async access(absolutePath: string): Promise<void> {
      const r = await env.exec(
        `test -r ${shellQuote(absolutePath)} && test -w ${shellQuote(absolutePath)}`,
      );
      if (r.exitCode !== 0) throw new Error(`not r/w: ${absolutePath}`);
    },
  };
}

// Session-routed grep. We do NOT delegate to pi-coding-agent's grep tool
// because it always shells out to host `rg` regardless of the pluggable
// Operations contract — meaning container/remote environments would either
// fail or scan host paths. Schema mirrors pi-coding-agent's so the agent
// prompt + downstream consumers see the same shape.
const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as literal string instead of regex (default: false)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
});

interface GrepDetails {
  exitCode: number;
  matchCount: number;
  truncated: boolean;
}

function createSessionGrepTool(
  cwd: string,
  env: EnvironmentSession,
): AgentTool<typeof grepSchema, GrepDetails> {
  return {
    name: "grep",
    label: "grep",
    description:
      "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Runs inside the run's environment via `rg` (or `grep -rn` fallback).",
    parameters: grepSchema,
    async execute(
      _id,
      args: Static<typeof grepSchema>,
      signal,
    ): Promise<AgentToolResult<GrepDetails>> {
      const limit = args.limit && args.limit > 0 ? args.limit : 100;
      const searchPath = args.path && args.path.length > 0 ? args.path : cwd;
      // Prefer ripgrep when present; fall back to grep -rn.
      const hasRg = await env.exec("command -v rg >/dev/null 2>&1");
      const useRg = hasRg.exitCode === 0;
      const flags: string[] = [];
      if (useRg) {
        flags.push("--line-number", "--color=never", "--hidden", "--no-messages");
        if (args.ignoreCase) flags.push("--ignore-case");
        if (args.literal) flags.push("--fixed-strings");
        if (args.glob) flags.push("--glob", shellQuote(args.glob));
        if (args.context && args.context > 0) flags.push(`-C${Math.floor(args.context)}`);
        // `--` separator so a pattern beginning with `-` isn't parsed as an rg option.
        flags.push("--");
        flags.push(shellQuote(args.pattern));
        flags.push(shellQuote(searchPath));
        const cmd = `rg ${flags.join(" ")} | head -n ${limit + 1}`;
        const r = await env.exec(cmd, { signal });
        const lines = r.stdout ? r.stdout.split("\n").filter((l) => l.length > 0) : [];
        const truncated = lines.length > limit;
        const out = lines.slice(0, limit).join("\n");
        return {
          content: [{ type: "text", text: out || "(no matches)" }],
          details: {
            exitCode: r.exitCode,
            matchCount: Math.min(lines.length, limit),
            truncated,
          },
        };
      }
      // Fallback: grep -rn. Ignores `glob`/`context` for simplicity; agents
      // should rely on rg-equipped environments for full functionality.
      const grepFlags: string[] = ["-rn", "--color=never"];
      if (args.ignoreCase) grepFlags.push("-i");
      if (args.literal) grepFlags.push("-F");
      if (args.context && args.context > 0) grepFlags.push(`-C${Math.floor(args.context)}`);
      const cmd = `grep ${grepFlags.join(" ")} -- ${shellQuote(args.pattern)} ${shellQuote(searchPath)} | head -n ${limit + 1}`;
      const r = await env.exec(cmd, { signal });
      const lines = r.stdout ? r.stdout.split("\n").filter((l) => l.length > 0) : [];
      const truncated = lines.length > limit;
      const out = lines.slice(0, limit).join("\n");
      return {
        content: [{ type: "text", text: out || "(no matches)" }],
        details: { exitCode: r.exitCode, matchCount: Math.min(lines.length, limit), truncated },
      };
    },
  };
}

function makeFindOps(env: EnvironmentSession) {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      const r = await env.exec(`test -e ${shellQuote(absolutePath)}`);
      return r.exitCode === 0;
    },
    async glob(
      pattern: string,
      cwd: string,
      options: { ignore: string[]; limit: number },
    ): Promise<string[]> {
      const ignoreArgs = options.ignore
        .map((p) => `-not -path ${shellQuote(`*/${p}/*`)}`)
        .join(" ");
      const cmd = `find ${shellQuote(cwd)} -name ${shellQuote(pattern)} ${ignoreArgs} | head -n ${options.limit}`;
      const r = await env.exec(cmd);
      if (!r.stdout) return [];
      return r.stdout.split("\n").filter((line) => line.length > 0);
    },
  };
}

function makeLsOps(env: EnvironmentSession) {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      const r = await env.exec(`test -e ${shellQuote(absolutePath)}`);
      return r.exitCode === 0;
    },
    async stat(absolutePath: string): Promise<{ isDirectory: () => boolean }> {
      const r = await env.exec(`test -d ${shellQuote(absolutePath)}`);
      if (r.exitCode === 0) return { isDirectory: () => true };
      const exists = await env.exec(`test -e ${shellQuote(absolutePath)}`);
      if (exists.exitCode !== 0) throw new Error(`no such path: ${absolutePath}`);
      return { isDirectory: () => false };
    },
    async readdir(absolutePath: string): Promise<string[]> {
      const r = await env.exec(`ls -1 ${shellQuote(absolutePath)}`);
      if (!r.stdout) return [];
      return r.stdout.split("\n").filter((line) => line.length > 0);
    },
  };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
