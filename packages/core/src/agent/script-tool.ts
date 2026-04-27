import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

import type { TSchema } from "typebox";
import { Type } from "typebox";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { Blueprint } from "../types/blueprint.ts";
import type { LogEntry } from "../providers/logging.ts";
import type { EnvironmentSession } from "../providers/environment.ts";

export interface ScriptToolOptions {
  blueprint: Blueprint;
  environment: EnvironmentSession;
  /**
   * Host directory the script paths in `blueprint.scripts` resolve against
   * for HOST-SIDE operations (sidecar schema lookup, existence checks).
   */
  blueprintDir: string;
  /**
   * Path INSIDE the session that maps to `blueprintDir` (`session.sessionWorkdir`
   * for the common case where the runtime bind-mounts the blueprint dir as
   * the workdir). Relative `blueprint.scripts` entries are rebased onto this
   * so `bun run …` runs against the in-session path, not the host path —
   * which would not exist inside a container or remote VM.
   *
   * For trusted / local-strict tiers `sessionScriptsRoot === blueprintDir`
   * and the rebase is a no-op. For env-docker the bind-mount makes the
   * blueprint dir visible at `/work` so `<host>/scripts/x.ts` becomes
   * `/work/scripts/x.ts`. env-daytona has no bind-mount so absolute host
   * paths still won't resolve there — caller should not invoke script tools
   * on remote-vm tier without first uploading the script body (TODO v1.1).
   */
  sessionScriptsRoot: string;
  onLog?: (entry: LogEntry) => void;
}

interface ScriptToolDetails {
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  stderr: string;
}

const FreeFormSchema = Type.Object({}, { additionalProperties: true });
type FreeFormParams = Record<string, unknown>;

export function buildScriptTools(opts: ScriptToolOptions): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];
  for (const [toolName, scriptPath] of Object.entries(opts.blueprint.scripts)) {
    // Codex round-3: absolute paths are unreachable here — `blueprint/
    // validate.ts:36` rejects them at parse time. We resolve relative paths
    // against TWO roots:
    //   - `blueprintDir` (host) for the sidecar JSON schema lookup at
    //     build time, since sidecars live next to the script on disk.
    //   - `sessionScriptsRoot` (session) for the runtime `bun run …`
    //     invocation, since that runs inside the session and the host path
    //     would not exist there for container / remote-vm tiers.
    // posix.join is intentional — sessionWorkdir is always Unix-shaped (no
    // Windows sandboxes today).
    const hostAbs = resolve(opts.blueprintDir, scriptPath);
    const sessionAbs = posix.join(opts.sessionScriptsRoot, scriptPath);
    tools.push(makeScriptTool(toolName, hostAbs, sessionAbs, opts));
  }
  return tools;
}

function loadSchemaSidecar(scriptAbsPath: string): {
  schema: TSchema;
  description: string;
} {
  const sidecar = scriptAbsPath.replace(/\.[^./]+$/, ".schema.json");
  if (!existsSync(sidecar)) {
    return {
      schema: FreeFormSchema,
      description: "Bundled script. Reads JSON args from stdin, writes result to stdout.",
    };
  }
  try {
    const raw = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    return {
      schema: raw as unknown as TSchema,
      description:
        (raw.description as string | undefined) ??
        (raw.title as string | undefined) ??
        "Bundled script.",
    };
  } catch {
    return {
      schema: FreeFormSchema,
      description: `Bundled script (failed to load ${sidecar}).`,
    };
  }
}

function makeScriptTool(
  toolName: string,
  hostAbsPath: string,
  sessionAbsPath: string,
  opts: ScriptToolOptions,
): AgentTool<TSchema, ScriptToolDetails> {
  // Sidecar JSON schema is read at build time from the HOST filesystem.
  const { schema, description } = loadSchemaSidecar(hostAbsPath);
  const tool: AgentTool<TSchema, ScriptToolDetails> = {
    name: toolName,
    label: toolName,
    description,
    parameters: schema,
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<ScriptToolDetails>> {
      if (signal?.aborted) {
        return {
          content: [{ type: "text", text: "aborted" }],
          details: { exitCode: -1, durationMs: 0, truncated: false, stderr: "aborted" },
          terminate: true,
        };
      }
      const stdinJson = JSON.stringify((params ?? {}) as FreeFormParams);
      // 15i-3 codex follow-up: invoke against the SESSION-side abs path so
      // the script resolves inside containers / remote VMs (the host abs
      // path doesn't exist there).
      const cmd = `bun run ${quoteShell(sessionAbsPath)}`;
      const r = await opts.environment.exec(cmd, { stdin: stdinJson, signal });
      opts.onLog?.({
        timestamp: Date.now(),
        level: r.exitCode === 0 ? "info" : "error",
        message: `script tool ${toolName} exit=${r.exitCode}`,
        meta: { durationMs: r.durationMs, truncated: r.truncated },
      });
      const ok = r.exitCode === 0;
      const text = ok ? r.stdout : r.stderr || r.stdout || `script exit ${r.exitCode}`;
      const result: AgentToolResult<ScriptToolDetails> = {
        content: [{ type: "text", text }],
        details: {
          exitCode: r.exitCode,
          durationMs: r.durationMs,
          truncated: r.truncated,
          stderr: r.stderr,
        },
      };
      return result;
    },
  };
  return tool;
}

function quoteShell(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
