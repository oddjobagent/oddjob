import type { TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "../../providers/logging.ts";
import type { SandboxSession } from "../../providers/sandbox.ts";
import { buildCodingTool, isCodingBuiltin } from "./coding-tools-adapter.ts";
import { createDatetimeTool } from "./datetime.ts";
import { createJavascriptReplTool } from "./javascript_repl.ts";
import { createPythonReplTool } from "./python_repl.ts";
import { createWebFetchTool } from "./web_fetch.ts";
import { createWebSearchTool } from "./web_search.ts";

export interface EngineConfig {
  builtinTools?: BuiltinToolsConfig;
}

export interface BuiltinToolsConfig {
  webSearch?: WebSearchConfig;
  webFetch?: WebFetchConfig;
  pythonRepl?: { timeoutMs?: number };
  javascriptRepl?: { timeoutMs?: number };
}

export interface WebSearchConfig {
  provider: "brave" | "tavily" | "searxng";
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

export interface WebFetchConfig {
  maxBodyMb?: number;
  privateIpsAllowed?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}

export interface BuildBuiltinToolsOptions {
  allowlist: readonly string[];
  sandbox: SandboxSession;
  blueprintDir: string;
  engine?: EngineConfig;
  onLog?: (entry: LogEntry) => void;
}

export const BUILTIN_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "web_fetch",
  "web_search",
  "python_repl",
  "javascript_repl",
  "datetime",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export function isBuiltinToolName(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

export function buildBuiltinTools(opts: BuildBuiltinToolsOptions): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];
  const cwd = opts.blueprintDir;
  const builtinCfg = opts.engine?.builtinTools;
  for (const name of opts.allowlist) {
    if (!isBuiltinToolName(name)) continue;
    if (isCodingBuiltin(name)) {
      tools.push(buildCodingTool(name, { cwd }));
      continue;
    }
    if (name === "web_fetch") {
      tools.push(
        createWebFetchTool({ config: builtinCfg?.webFetch, onLog: opts.onLog }) as AgentTool<TSchema>,
      );
      continue;
    }
    if (name === "web_search") {
      tools.push(
        createWebSearchTool({
          config: builtinCfg?.webSearch,
          onLog: opts.onLog,
        }) as AgentTool<TSchema>,
      );
      continue;
    }
    if (name === "javascript_repl") {
      tools.push(
        createJavascriptReplTool({
          defaultTimeoutMs: builtinCfg?.javascriptRepl?.timeoutMs,
          onLog: opts.onLog,
        }) as AgentTool<TSchema>,
      );
      continue;
    }
    if (name === "python_repl") {
      tools.push(
        createPythonReplTool({
          defaultTimeoutMs: builtinCfg?.pythonRepl?.timeoutMs,
          onLog: opts.onLog,
        }) as AgentTool<TSchema>,
      );
      continue;
    }
    if (name === "datetime") {
      tools.push(createDatetimeTool() as AgentTool<TSchema>);
      continue;
    }
  }
  return tools;
}
