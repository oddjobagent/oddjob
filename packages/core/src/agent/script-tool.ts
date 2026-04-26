import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { TSchema } from "typebox";
import { Type } from "typebox";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { Blueprint } from "../types/blueprint.ts";
import type { LogEntry } from "../providers/logging.ts";
import type { SandboxSession } from "../providers/sandbox.ts";

export interface ScriptToolOptions {
  blueprint: Blueprint;
  sandbox: SandboxSession;
  blueprintDir: string;
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
    const abs = isAbsolute(scriptPath) ? scriptPath : resolve(opts.blueprintDir, scriptPath);
    tools.push(makeScriptTool(toolName, abs, opts));
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
  scriptAbsPath: string,
  opts: ScriptToolOptions,
): AgentTool<TSchema, ScriptToolDetails> {
  const { schema, description } = loadSchemaSidecar(scriptAbsPath);
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
      const cmd = `bun run ${quoteShell(scriptAbsPath)}`;
      const r = await opts.sandbox.exec(cmd, { stdin: stdinJson, signal });
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
